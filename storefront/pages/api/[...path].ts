import type { NextApiRequest, NextApiResponse } from 'next';
import http from 'http';
import { URL } from 'url';
import tracer from 'dd-trace';

// Runtime proxy: forwards /api/* to the store-api at STORE_API_URL.
// Unlike next.config.js rewrites (which bake the destination at build time),
// this reads STORE_API_URL on every request, so the same image works in any
// environment (compose, ECS) just by changing the env var.
//
// The body is buffered (not streamed) so we can attach a preview to the trace
// span. Request bodies may contain PII — only use verbose tagging where that
// is acceptable; tag length is capped for Datadog limits.
export const config = { api: { bodyParser: false } };

const MAX_BODY_TAG_CHARS = 4000;

function readRequestBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks as unknown as readonly Uint8Array[])));
    req.on('error', reject);
  });
}

function forwardHeaders(req: NextApiRequest, target: URL, body: Buffer): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers['transfer-encoding'];
  delete headers['content-length'];
  headers.host = target.host;
  if (body.length > 0) {
    headers['content-length'] = String(body.byteLength);
  }
  return headers;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.STORE_API_URL || 'http://localhost:4000';
  const target = new URL(base);
  const segments = ([] as string[]).concat((req.query.path as string[]) || []);
  const path = '/' + segments.join('/');

  let body: Buffer;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Failed to read request body', detail: String(err) }));
    return;
  }

  const span = tracer.scope().active();
  const isCheckoutPost = path === '/checkout' && (req.method || '').toUpperCase() === 'POST';
  if (span) {
    span.setTag('component', 'storefront-bff-proxy');
    span.setTag('bff.ingress_api_path', '/api/' + segments.join('/'));
    span.setTag('bff.upstream_host', target.hostname);
    span.setTag('bff.upstream_path', path);
    span.setTag('bff.upstream_method', req.method || 'GET');
    if (isCheckoutPost) {
      span.setTag('checkout.request_body_bytes', body.length);
      if (body.length > 0) {
        const text = body.toString('utf8');
        const preview =
          text.length > MAX_BODY_TAG_CHARS
            ? text.slice(0, MAX_BODY_TAG_CHARS) + '…[truncated]'
            : text;
        span.setTag('checkout.request_body', preview);
        try {
          const parsed = JSON.parse(text) as { transactionId?: string };
          if (parsed.transactionId) {
            span.setTag('checkout.transaction_id', String(parsed.transactionId));
          }
        } catch {
          /* body not JSON */
        }
      }
    } else {
      span.setTag('bff.request_body_bytes', body.length);
      if (body.length > 0) {
        const text = body.toString('utf8');
        const preview =
          text.length > MAX_BODY_TAG_CHARS
            ? text.slice(0, MAX_BODY_TAG_CHARS) + '…[truncated]'
            : text;
        span.setTag('bff.request_body', preview);
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const proxyReq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        path,
        method: req.method,
        headers: forwardHeaders(req, target, body),
      },
      (proxyRes) => {
        span?.setTag('bff.upstream_http_status', proxyRes.statusCode ?? 0);
        res.statusCode = proxyRes.statusCode || 502;
        Object.entries(proxyRes.headers).forEach(([k, v]) => {
          if (v !== undefined) res.setHeader(k, v as string | string[]);
        });
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
        proxyRes.on('error', reject);
      },
    );

    proxyReq.on('error', (err) => {
      span?.setTag('error', true);
      span?.setTag('error.type', err.name);
      span?.setTag('error.message', err.message);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }));
      }
      reject(err);
    });

    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
}
