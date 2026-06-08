const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://store-api:4000';
const txn = 'e2e-' + Date.now();

(async () => {
  const socket = io(BASE, { transports: ['websocket', 'polling'] });
  let done = false;

  socket.on('connect', () => {
    console.log('socket connected', socket.id);
    socket.emit('subscribe', { transactionId: txn });
  });
  socket.on('checkout:done', (msg) => {
    console.log('RECEIVED checkout:done ->', JSON.stringify(msg));
    if (msg.transactionId === txn) {
      done = true;
      console.log('TXN:' + txn);
      socket.disconnect();
      process.exit(0);
    }
  });

  await new Promise((r) => setTimeout(r, 1000)); // let subscribe land

  const t0 = Date.now();
  const res = await fetch(BASE + '/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionId: txn,
      items: [{ productId: 'x', name: 'Hoodie', price: 4999, qty: 2 }],
      customer: { name: 'E2E', email: 'e2e@x.com' },
    }),
  });
  console.log('POST /checkout ->', res.status, JSON.stringify(await res.json()));

  setTimeout(() => {
    if (!done) { console.error('TIMEOUT: no checkout:done after 10s'); process.exit(1); }
  }, 10000);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
