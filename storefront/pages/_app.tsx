import type { AppProps } from 'next/app';
import { datadogRum } from "@datadog/browser-rum";
import Link from 'next/link';

datadogRum.init({
    applicationId: '1bb7e5ed-2eee-441e-aa1e-34f2b2dfcf87',
    clientToken: 'pub88028c144f55d7073a494c24a229fd3f',
    site: 'datadoghq.com',
    service: 'griddog-storefront',
    env: 'ecs-dev',				// e.g. 'prod', 'staging-1', 'dev'
    version: '3.0.0',	// e.g. '1.0.0'
    sessionSampleRate: 100,			// capture 100% of sessions
    sessionReplaySampleRate: 100,	// capture 20% of sessions with replay
    trackResources: true,			// Enable Resource tracking
    trackUserInteractions: true,	// Enable Action tracking
    trackLongTasks: true,			// Enable Long Tasks tracking

    // ----- Recommended Options -----
    allowedTracingUrls: [
      (url) => url.startsWith("http://localhost:3000") ||
               url.startsWith("http://griddog-alb-74035986.ap-southeast-1.elb.amazonaws.com"),
    ]
    // defaultPrivacyLevel: 'mask-user-input',	// 'mask-user-input' | 'allow' | 'mask'
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Link href="/">
          <a style={{ fontSize: 22, fontWeight: 700, color: '#632ca6', textDecoration: 'none' }}>
            🐶 gridDog Merch
          </a>
        </Link>
        <Link href="/cart">
          <a style={{ color: '#632ca6' }}>Cart →</a>
        </Link>
      </header>
      <Component {...pageProps} />
    </div>
  );
}
