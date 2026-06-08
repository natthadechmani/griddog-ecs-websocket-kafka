import { useEffect, useState } from 'react';
import { api, formatPrice } from '../lib/api';
import { addToCart } from '../lib/cart';

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  stock: number;
};

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/products')
      .then(setProducts)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1>Datadog Merch</h1>
      {error && <p style={{ color: 'crimson' }}>Failed to load products: {error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {products.map((p) => (
          <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
            <img
              src={p.imageUrl || 'https://via.placeholder.com/200'}
              alt={p.name}
              style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 4 }}
            />
            <h3 style={{ margin: '12px 0 4px' }}>{p.name}</h3>
            <p style={{ color: '#666', fontSize: 14, minHeight: 40 }}>{p.description}</p>
            <strong>{formatPrice(p.price)}</strong>
            <button
              onClick={() => {
                addToCart({ productId: p.id, name: p.name, price: p.price, qty: 1 });
                alert(`Added ${p.name} to cart`);
              }}
              style={{ display: 'block', width: '100%', marginTop: 8, padding: 8, background: '#632ca6', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}
            >
              Add to cart
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
