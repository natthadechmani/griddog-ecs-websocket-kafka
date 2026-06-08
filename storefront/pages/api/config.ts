import type { NextApiRequest, NextApiResponse } from 'next';

// Runtime config for the browser. Read at request time (not baked at build),
// so the same image works locally and on ECS by changing SOCKET_URL.
// This exact route takes precedence over the catch-all [...path].ts proxy.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json({ socketUrl: process.env.SOCKET_URL || 'http://localhost:4000' });
}
