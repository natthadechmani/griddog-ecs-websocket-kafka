import http from 'k6/http';
import { check } from 'k6';

// Ramp test: step the offered request rate up until latency blows up or errors
// appear. The last step where p95 stays sane and http_req_failed ~ 0 is your
// sustainable ceiling (R_max). Use ~70% of that as RATE in products-load.js.
//
// Run:
//   k6 run -e TARGET="http://<ALB-DNS>/api/products" loadtest/products-ramp.js
//
// Tune the top of the ramp with MAX_RATE if you never hit a knee (or hit your
// laptop's uplink limit before the service's).

const TARGET = __ENV.TARGET || 'http://localhost:3000/api/products';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 1500,
      // stages: [
      //   { target: 10, duration: '30s' },
      //   { target: 50, duration: '30s' },
      //   { target: 100, duration: '30s' },
      //   { target: 200, duration: '30s' },
      //   { target: 400, duration: '30s' },
      //   { target: 800, duration: '30s' },
      //   { target: Number(__ENV.MAX_RATE || 1500), duration: '30s' },
      // ],
      stages: [
        { target: 10,  duration: '45s' },
        { target: 25,  duration: '45s' },
        { target: 50,  duration: '45s' },
        { target: 75,  duration: '45s' },
        { target: 100, duration: '45s' },
        { target: 150, duration: '45s' },
      ],
    },
  },
  thresholds: {
    // Don't abort — we WANT to push past the knee to see where it breaks.
    http_req_failed: ['rate<0.50'],
    http_req_duration: ['p(95)<3000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(TARGET);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
