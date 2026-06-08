import type { AppProps } from 'next/app';
import Link from 'next/link';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Link href="/">
          <a style={{ fontSize: 20, fontWeight: 700, color: '#632ca6', textDecoration: 'none' }}>
            🐶 gridDog CMS
          </a>
        </Link>
        <Link href="/new">
          <a style={{ color: '#632ca6' }}>+ New product</a>
        </Link>
      </header>
      <Component {...pageProps} />
    </div>
  );
}
