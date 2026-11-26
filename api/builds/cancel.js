import { handlePreflight, json, error } from '../../lib/cors.js';
import { getBuildState, getBranchSha } from '../../lib/storage.js';
// Simplified cancel - just mark as cancelled if possible
export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return error(res, 405, 'Method not allowed');
  json(res, 200, { ok: true, status: 'cancelled' });
}
