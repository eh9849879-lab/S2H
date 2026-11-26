import { handlePreflight, json, error } from '../../lib/cors.js';
import { getBuildState } from '../../lib/storage.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return error(res, 405, 'Method not allowed');

  const { buildId } = req.query;
  if (!buildId) return error(res, 400, 'buildId required');

  const state = await getBuildState(buildId);
  if (!state) return error(res, 404, 'Build not found');

  json(res, 200, state);
}
