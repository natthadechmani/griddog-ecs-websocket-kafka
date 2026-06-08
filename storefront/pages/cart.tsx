import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatPrice } from '../lib/api';
import { CartItem, cartTotal, getCart, removeFromCart, setQty } from '../lib/cart';

export default function Cart() {
  const [items, setItems] = useState<CartItem[]>([]);

  const refresh = () => setItems(getCart());
  useEffect(refresh, []);

  if (items.length === 0) {
    return (
      <div>
        <h1>Your cart</h1>
        <p>Cart is empty. <Link href="/"><a>Browse merch →</a></Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1>Your cart</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>Item</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.productId} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td>{it.name}</td>
              <td>{formatPrice(it.price)}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  value={it.qty}
                  style={{ width: 56 }}
                  onChange={(e) => {
                    setQty(it.productId, Number(e.target.value));
                    refresh();
                  }}
                />
              </td>
              <td>{formatPrice(it.price * it.qty)}</td>
              <td>
                <button onClick={() => { removeFromCart(it.productId); refresh(); }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ textAlign: 'right' }}>Total: {formatPrice(cartTotal(items))}</h3>
      <div style={{ textAlign: 'right' }}>
        <Link href="/checkout">
          <a style={{ padding: '10px 16px', background: '#632ca6', color: '#fff', borderRadius: 4, textDecoration: 'none' }}>
            Checkout →
          </a>
        </Link>
      </div>
    </div>
  );
}
