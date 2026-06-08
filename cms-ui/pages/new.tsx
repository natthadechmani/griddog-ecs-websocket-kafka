import { useRouter } from 'next/router';
import { useState } from 'react';
import { api } from '../lib/api';

export default function NewProduct() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', description: '', priceDollars: '', imageUrl: '', stock: '' });
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          price: Math.round(Number(form.priceDollars) * 100), // dollars -> cents
          imageUrl: form.imageUrl,
          stock: Number(form.stock) || 0,
        }),
      });
      router.push('/');
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>New product</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <input placeholder="Name" value={form.name} required onChange={set('name')} />
        <textarea placeholder="Description" value={form.description} onChange={set('description')} />
        <input placeholder="Price (USD, e.g. 24.99)" type="number" step="0.01" value={form.priceDollars} required onChange={set('priceDollars')} />
        <input placeholder="Image URL" value={form.imageUrl} onChange={set('imageUrl')} />
        <input placeholder="Stock" type="number" value={form.stock} onChange={set('stock')} />
        <button type="submit" style={{ padding: 10, background: '#632ca6', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>
          Create
        </button>
      </form>
    </div>
  );
}
