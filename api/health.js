import { handlePreflight, json } from '../lib/cors.js';
export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const ok = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
  json(res, ok ? 200 : 503, { status: ok ? 'ok' : 'error', version: '3.0.0' });
}
