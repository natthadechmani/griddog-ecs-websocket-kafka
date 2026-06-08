// API calls go through the catch-all runtime proxy at pages/api/[...path].ts,
// which forwards to STORE_API_URL (read per-request). We intentionally do NOT
// use rewrites() here: Next.js 10 evaluates rewrites at build time, which would
// bake the destination URL into the build instead of reading it at runtime.
//
// Next 10 uses webpack 4 and does NOT transpile node_modules by default, so the
// modern syntax (optional chaining) in @datadog/browser-rum fails to parse.
// next-transpile-modules runs Next's babel over those packages to fix it.
const withTM = require('next-transpile-modules')([
  '@datadog/browser-rum',
  '@datadog/browser-rum-core',
  '@datadog/browser-core',
]);

module.exports = withTM({});
