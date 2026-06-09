import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import tracer from 'dd-trace';

/**
 * Tracing syntax used in this file (dd-trace / TypeScript):
 *
 * ---------------------------------------------------------------------------
 * `tracer.scope().active()`  →  `Span | null | undefined`
 * ---------------------------------------------------------------------------
 * Returns whichever span is "current" for this execution context (often an
 * HTTP request span during the Socket.IO handshake). If nothing is traced,
 * it is empty.
 *
 *   active?.setTag('key', 'value')
 *
 * The `?.` is optional chaining: call `setTag` only if `active` is non-null.
 * If `active` is null/undefined, the expression short-circuits to `undefined`
 * and nothing throws.
 *
 * ---------------------------------------------------------------------------
 * `tracer.trace(operationName, options?, callback)`  →  creates a Span
 * ---------------------------------------------------------------------------
 * Starts a **new** span named `operationName`, runs `callback(span)` while
 * that span is active, then **finishes** the span when the callback returns
 * (for a synchronous callback like ours).
 *
 *   tracer.trace(
 *     'socket.io',                         // span "operation" / service entry
 *     { resource: 'subscribe' },           // Datadog resource name (grouping in UI)
 *     (span) => {                          // receives the new Span
 *       span?.setTag('checkout.transaction_id', tid);
 *       // ... sync work ...
 *     },                                   // span finishes after this returns
 *   );
 *
 * `span?.setTag(...)`: same optional chaining — skip if span is missing.
 *
 * ---------------------------------------------------------------------------
 * `socket.conn?.transport?.name`
 * ---------------------------------------------------------------------------
 * Nested optional chaining: if `conn` or `transport` is missing, the whole
 * expression is `undefined` (no throw).
 *
 * ---------------------------------------------------------------------------
 * `data?.transactionId` (optional property access)
 * ---------------------------------------------------------------------------
 * If `data` is null/undefined, the whole expression is `undefined`. If `data`
 * exists but has no `transactionId`, result is `undefined`. No throw.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same preview cap as HTTP checkout tagging (bff + CheckoutService). */
const MAX_CHECKOUT_BODY_TAG_CHARS = 4000;

function checkoutBodyPreview(data: unknown): string {
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length > MAX_CHECKOUT_BODY_TAG_CHARS
      ? s.slice(0, MAX_CHECKOUT_BODY_TAG_CHARS) + '…[truncated]'
      : s;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Wraps a socket.io v4 server attached directly to the Nest HTTP server
 * (we avoid @nestjs/platform-socket.io, which is pinned to socket.io v2 / old ws).
 * Browsers connect, then `subscribe` with their transactionId to join a room;
 * the checkout consumer emits `checkout:done` to that room once the order is
 * persisted.
 *
 * dd-trace rarely attaches a useful span to raw socket.io handlers, so we
 * create short `socket.io.*` spans and tags where it helps the checkout flow.
 */
@Injectable()
export class RealtimeService {
  private io: Server | undefined;

  init(httpServer: any) {
    this.io = new Server(httpServer, {
      cors: { origin: '*' },
      path: '/socket.io',
    });

    this.io.on('connection', (socket) => {
      // Create a real span for the connection (the raw socket handler usually has
      // no active span to enrich — see file header).
      tracer.trace('socket.io', { resource: 'connection' }, (span) => {
        span?.setTag('component', 'socket.io');
        span?.setTag('checkout.socket_id', socket.id);
        const transport = socket.conn?.transport?.name;
        if (transport) {
          span?.setTag('checkout.socket_transport', transport);
        }
      });

      socket.on('subscribe', (data: { transactionId?: string }) => {
        // tracer.trace('op', { resource }, (span) => { ... }) — see block comment at top of file.
        tracer.trace(
          'socket.io',
          { resource: 'subscribe' },
          (span) => {
            span?.setTag('component', 'socket.io');
            span?.setTag('checkout.socket_id', socket.id);
            const tid = data?.transactionId;
            if (tid) {
              span?.setTag('checkout.transaction_id', tid);
            }
            if (data !== undefined) {
              span?.setTag('checkout.request_body', checkoutBodyPreview(data));
            }
            if (data && data.transactionId) {
              socket.join(data.transactionId);
              // eslint-disable-next-line no-console
              console.log(`socket ${socket.id} subscribed txnId=${data.transactionId}`);
            }
          },
        );
      });
    });

    // eslint-disable-next-line no-console
    console.log('socket.io server initialized on /socket.io');
  }

  async emitDone(transactionId: string, payload: any) {
    if (!this.io) return;
    // Async callback: dd-trace finishes the span when the returned promise
    // resolves, so the 300ms delay is included in the emit span's duration.
    await tracer.trace(
      'socket.io',
      { resource: 'emit checkout:done' },
      async (span) => {
        span?.setTag('component', 'socket.io');
        span?.setTag('checkout.event', 'checkout:done');
        span?.setTag('checkout.transaction_id', transactionId);
        span?.setTag('checkout.response_body', checkoutBodyPreview(payload));

        await sleep(300);
        this.io!.to(transactionId).emit('checkout:done', payload);
      },
    );
  }
}
