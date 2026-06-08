// All calls go through the same-origin /api proxy (see next.config.js).
export async function api(path: string, options?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  // DELETE/PUT may return JSON; tolerate empty bodies.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
