import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatPrice } from '../lib/api';

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');

  const load = () => api('/products').then(setProducts).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await api(`/products/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <h1>Products</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>Name</th>
            <th>Price</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td>{p.name}</td>
              <td>{formatPrice(p.price)}</td>
              <td>{p.stock}</td>
              <td style={{ textAlign: 'right' }}>
                <Link href={`/${p.id}`}><a style={{ marginRight: 12 }}>Edit</a></Link>
                <button onClick={() => remove(p.id, p.name)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {products.length === 0 && !error && <p>No products yet. <Link href="/new"><a>Add one →</a></Link></p>}
    </div>
  );
}
