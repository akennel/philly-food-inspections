import type { Config, Context } from '@netlify/functions';
import { blobsKV } from '../../lib/blobs';
import { HttpClient } from '../../lib/http';
import { loadFacility, patchIndex, phillyToday, yearsAgo } from '../../lib/ingest';
import { KEYS } from '../../lib/kv';
import type { Facility } from '../../lib/types';

const ID_RE = /^[A-F0-9-]{20,40}$/i;
const json = (data: unknown, status = 200, cache = 'public, max-age=300') =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

/**
 * GET /api/facility/:id
 * Returns the stored facility. If we don't have it yet (or ?refresh=1), pulls its full
 * 3-year history from Philadelphia's site, stores it, and adds it to the index.
 */
export default async (req: Request, context: Context) => {
  const id = context.params.id ?? '';
  if (!ID_RE.test(id)) return json({ error: 'Bad facility id' }, 400);

  const kv = blobsKV();
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  const stored = await kv.get<Facility>(KEYS.facility(id));
  if (stored && !refresh) return json(stored);

  const http = new HttpClient({
    concurrency: 4,
    minIntervalMs: 100,
    timeoutMs: 8000,
    retries: 1,
    userAgent: `PhillyFoodInspectionsMap/1.0 (+${process.env.URL ?? 'netlify'})`,
  });
  try {
    const f = await loadFacility(
      { http, kv, geocode: true, deadline: Date.now() + 7000 },
      id,
      yearsAgo(phillyToday(), 3),
    );
    if (!f) return json({ error: 'Not found' }, 404, 'no-store');
    await patchIndex(kv, [f]);
    return json(f, 200, 'no-store');
  } catch (e) {
    if (stored) return json(stored); // site is down; serve what we have
    return json({ error: `Could not load from Philadelphia's site: ${e}` }, 502, 'no-store');
  }
};

export const config: Config = { path: '/api/facility/:id' };
