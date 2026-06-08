import http from 'k6/http';
import { check } from 'k6';

// Steady-state load test for the products API (fair A/B between Datadog ON/OFF).
// Uses constant-arrival-rate: the SAME request rate is offered to both variants,
// regardless of how fast each responds, so latency deltas are apples-to-apples.
//x
// Run:
//   k6 run -e TARGET="http://<ALB-DNS>/api/products" -e RATE=70 -e DURATION=2m loadtest/products-load.js
//
// Env knobs:
//   TARGET    full URL to hit (required in practice)
//   RATE      requests per second (default 50)
//   DURATION  test length (default 2m)
//   MAX_VUS   cap on virtual users k6 may spin up to sustain RATE (default 500)

const TARGET = __ENV.TARGET || 'http://localhost:3000/api/products';
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '2m';
const PREALLOC_VUS = Number(__ENV.PREALLOC_VUS || Math.min(RATE * 2, 200));
const MAX_VUS = Number(__ENV.MAX_VUS || 500);

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PREALLOC_VUS,
      maxVUs: MAX_VUS,
    },
  },
  // Thresholds are advisory here — we mostly read the summary percentiles.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(TARGET);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body has products': (r) => typeof r.body === 'string' && r.body.length > 2,
  });
}
