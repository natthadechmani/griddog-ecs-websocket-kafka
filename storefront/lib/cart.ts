// Minimal localStorage-backed cart for the demo.
export type CartItem = {
  productId: string;
  name: string;
  price: number; // cents
  qty: number;
};

const KEY = 'griddog_cart';

export function getCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function addToCart(item: CartItem) {
  const cart = getCart();
  const existing = cart.find((c) => c.productId === item.productId);
  if (existing) {
    existing.qty += item.qty;
  } else {
    cart.push(item);
  }
  saveCart(cart);
}

export function setQty(productId: string, qty: number) {
  const cart = getCart()
    .map((c) => (c.productId === productId ? { ...c, qty } : c))
    .filter((c) => c.qty > 0);
  saveCart(cart);
}

export function removeFromCart(productId: string) {
  saveCart(getCart().filter((c) => c.productId !== productId));
}

export function clearCart() {
  saveCart([]);
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}
