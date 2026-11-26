import { handlePreflight, json } from '../../lib/cors.js';
import { cleanupStaleBranches } from '../../lib/storage.js';
export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const result = await cleanupStaleBranches();
  json(res, 200, { ok: true, ...result });
}
