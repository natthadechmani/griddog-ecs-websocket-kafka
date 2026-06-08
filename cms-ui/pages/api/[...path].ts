import type { NextApiRequest, NextApiResponse } from 'next';
import http from 'http';
import { URL } from 'url';

// Runtime proxy: forwards /api/* to the cms-api at CMS_API_URL.
// Reads CMS_API_URL on every request (not baked at build time), so the same
// image works in compose (http://cms-api:4001) and on ECS (http://localhost:4001,
// the sibling container in the same task).
export const config = { api: { bodyParser: false } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.CMS_API_URL || 'http://localhost:4001';
  const target = new URL(base);
  const segments = ([] as string[]).concat((req.query.path as string[]) || []);
  const path = '/' + segments.join('/');

  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 502;
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        if (v !== undefined) res.setHeader(k, v as string | string[]);
      });
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }));
  });

  req.pipe(proxyReq);
}
