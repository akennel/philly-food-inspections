import type { Config } from '@netlify/functions';
import { openStore } from '../../lib/blobs';
import { KEYS } from '../../lib/kv';

/** Compact list of every stored facility (powers the map and instant search). */
export default async () => {
  const body = (await openStore().get(KEYS.index, { type: 'text' })) ?? '[]';
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
};

export const config: Config = { path: '/api/index' };
