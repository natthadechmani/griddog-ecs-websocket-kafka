// API calls go through the catch-all runtime proxy at pages/api/[...path].ts,
// which forwards to CMS_API_URL (read per-request). We intentionally do NOT use
// rewrites() here: Next.js 10 evaluates rewrites at build time, which would bake
// the destination URL into the build instead of reading it at runtime.
module.exports = {};
