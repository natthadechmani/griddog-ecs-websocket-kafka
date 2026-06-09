import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { datadogRum } from '@datadog/browser-rum';
import { api, formatPrice } from '../lib/api';
import { CartItem, cartTotal, clearCart, getCart } from '../lib/cart';

// UUID that also works over plain http on a non-localhost origin (the ALB),
// where crypto.randomUUID() is unavailable (it requires a secure context).
function uuid(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type Phase = 'form' | 'processing' | 'done';

export default function Checkout() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [result, setResult] = useState<{ transactionId: string; total: number } | null>(null);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => setItems(getCart()), []);
  // Clean up the socket if the user leaves mid-flight.
  useEffect(() => () => { socketRef.current?.disconnect(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const transactionId = uuid();
    const total = cartTotal(items);

    // Correlate this RUM session/view with the backend APM spans, which all tag
    // `checkout.transaction_id`. RUM does not auto-trace WebSocket frames, so we
    // emit custom actions around the socket lifecycle below.
    datadogRum.setGlobalContextProperty('checkout.transaction_id', transactionId);
    const subscribedAt = Date.now();

    try {
      // 1. Connect + subscribe to our transactionId BEFORE posting, so the room
      //    exists before the consumer emits (the 2s mock wait gives margin).
      const { socketUrl } = await api('/config');
      const socket = io(socketUrl, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('subscribe', { transactionId });
        datadogRum.addAction('checkout.socket.subscribe', {
          transactionId,
          socketUrl,
          transport: socket.io?.engine?.transport?.name,
        });
      });
      socket.on('connect_error', (err: Error) => {
        datadogRum.addAction('checkout.socket.connect_error', {
          transactionId,
          error: String(err?.message || err),
        });
      });
      socket.on('checkout:done', (msg: { transactionId: string }) => {
        if (msg.transactionId === transactionId) {
          // End-to-end realtime latency: subscribe → checkout:done over the socket.
          datadogRum.addAction('checkout.socket.done', {
            transactionId,
            realtimeLatencyMs: Date.now() - subscribedAt,
          });
          setPhase('done');
          socket.disconnect();
        }
      });

      // 2. Publish the checkout (returns 202 immediately). This fetch is already
      //    traced by RUM (allowedTracingUrls) and links to the backend APM trace.
      await api('/checkout', {
        method: 'POST',
        body: JSON.stringify({ transactionId, items, customer: { name, email } }),
      });

      clearCart();
      setResult({ transactionId, total });
      setPhase('processing');
    } catch (err) {
      socketRef.current?.disconnect();
      datadogRum.addAction('checkout.submit_error', {
        transactionId,
        error: String(err),
      });
      setError(String(err));
    }
  };

  if (phase === 'done' && result) {
    return (
      <div>
        <h1>Done ✅</h1>
        <p>Order for {formatPrice(result.total)} confirmed.</p>
        <p style={{ color: '#666', fontSize: 14 }}>Transaction <code>{result.transactionId}</code></p>
        <p>(No payment was processed — this is a demo.)</p>
        <Link href="/"><a>← Back to store</a></Link>
      </div>
    );
  }

  if (phase === 'processing' && result) {
    return (
      <div>
        <h1>Processing… ⏳</h1>
        <p>Your order ({formatPrice(result.total)}) is being processed.</p>
        <p style={{ color: '#666', fontSize: 14 }}>Transaction <code>{result.transactionId}</code></p>
        <p style={{ color: '#999' }}>Waiting for confirmation…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <h1>Checkout</h1>
        <p>Your cart is empty. <Link href="/"><a>Browse merch →</a></Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1>Checkout</h1>
      <p>Total due: <strong>{formatPrice(cartTotal(items))}</strong></p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
        <input placeholder="Full name" value={name} required onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" style={{ padding: 10, background: '#632ca6', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>
          Place order
        </button>
      </form>
    </div>
  );
}
