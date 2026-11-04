import { getStore, type Store } from '@netlify/blobs';
import type { KV } from './kv';

export const STORE_NAME = 'inspections';

/**
 * Inside Netlify Functions this picks up credentials automatically.
 * From a local script, set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN.
 */
export function openStore(): Store {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  return siteID && token
    ? getStore({ name: STORE_NAME, siteID, token, consistency: 'strong' })
    : getStore({ name: STORE_NAME, consistency: 'strong' });
}

export function blobsKV(store: Store = openStore()): KV {
  return {
    async get<T>(key: string) {
      return ((await store.get(key, { type: 'json' })) as T | null) ?? null;
    },
    async set(key: string, value: unknown) {
      await store.setJSON(key, value);
    },
    async list(prefix: string) {
      const keys: string[] = [];
      for await (const page of store.list({ prefix, paginate: true })) keys.push(...page.blobs.map((b) => b.key));
      return keys;
    },
  };
}
