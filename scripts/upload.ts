/**
 * Copy ./data into the site's Netlify Blobs store.
 * Needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (a personal access token) in the environment.
 *
 *   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... npm run upload
 */
import { blobsKV } from '../lib/blobs';
import { mapLimit } from '../lib/http';
import { rebuildIndex } from '../lib/ingest';
import { FsKV, KEYS } from '../lib/kv';

if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_AUTH_TOKEN) {
  console.error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN first (see README).');
  process.exit(1);
}

const local = new FsKV(process.argv[2] ?? 'data');
const remote = blobsKV();

const keys = [...(await local.list('facility/')), ...(await local.list('day/'))];
console.log(`Uploading ${keys.length} records…`);
let n = 0;
const { errors } = await mapLimit(keys, 8, async (k) => {
  await remote.set(k, await local.get(k));
  if (++n % 500 === 0) console.log(`  ${n}/${keys.length}`);
});
for (const e of errors) console.error(`  failed ${e.item}: ${e.error}`);

// Index goes last so the site never points at facilities that aren't uploaded yet.
const index = await rebuildIndex(local);
await remote.set(KEYS.index, index);
console.log(`Done. ${keys.length - errors.length} records + index (${index.length} facilities).`);
