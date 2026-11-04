import type { Config } from '@netlify/functions';
import { HttpClient } from '../../lib/http';
import { search } from '../../lib/philly';
import type { SearchResult } from '../../lib/types';

/**
 * GET /api/live-search?q=...
 * Searches Philadelphia's site directly (by name and by address) for places we haven't stored.
 * Results are lightweight; the client calls /api/facility/:id to load one.
 */
export default async (req: Request) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 3 || q.length > 80) {
    return Response.json({ error: 'Query must be 3–80 characters' }, { status: 400 });
  }
  const http = new HttpClient({
    concurrency: 2,
    minIntervalMs: 50,
    timeoutMs: 8000,
    retries: 1,
    userAgent: `PhillyFoodInspectionsMap/1.0 (+${process.env.URL ?? 'netlify'})`,
  });
  try {
    const [byName, byAddress] = await Promise.all([
      search(http, { kw: q, field: 'name' }, 1),
      /\d/.test(q) ? search(http, { kw: q, field: 'address' }, 1) : Promise.resolve({ results: [] as SearchResult[], total: 0 }),
    ]);
    const seen = new Set<string>();
    const results = [...byName.results, ...byAddress.results].filter((r) =>
      seen.has(r.facilityId) ? false : (seen.add(r.facilityId), true),
    );
    return Response.json(
      { results, total: byName.total + byAddress.total },
      { headers: { 'Cache-Control': 'public, max-age=900' } },
    );
  } catch (e) {
    return Response.json({ error: `Philadelphia's site didn't respond: ${e}` }, { status: 502 });
  }
};

export const config: Config = { path: '/api/live-search' };
