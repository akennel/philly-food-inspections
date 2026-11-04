/** Batch-geocode every facility in ./data that doesn't have coordinates yet, then rebuild data/index.json. */
import { geocodeBatch } from '../lib/geocode';
import { rebuildIndex } from '../lib/ingest';
import { FsKV } from '../lib/kv';
import type { Facility } from '../lib/types';

const kv = new FsKV(process.argv[2] ?? 'data');
const keys = await kv.list('facility/');
const todo: Facility[] = [];
for (const k of keys) {
  const f = await kv.get<Facility>(k);
  if (f && f.lat === undefined && f.geocode !== 'nomatch') todo.push(f);
}
console.log(`${keys.length} facilities, ${todo.length} need geocoding`);

for (let i = 0; i < todo.length; i += 1000) {
  const chunk = todo.slice(i, i + 1000);
  const res = await geocodeBatch(chunk.map((f) => ({ id: f.id, street: f.street, city: f.city, state: f.state, zip: f.zip })));
  let hits = 0;
  for (const f of chunk) {
    const g = res.get(f.id);
    const next: Facility = g ? { ...f, ...g, geocode: 'match' } : { ...f, geocode: 'nomatch' };
    if (g) hits++;
    await kv.set(`facility/${f.id}`, next);
  }
  console.log(`  ${i + chunk.length}/${todo.length} (${hits}/${chunk.length} matched)`);
}

const index = await rebuildIndex(kv);
console.log(`Index rebuilt: ${index.length} facilities, ${index.filter((e) => e.y !== undefined).length} on the map.`);
