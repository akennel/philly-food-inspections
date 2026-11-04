/**
 * Backfill inspections into ./data (local JSON files), newest day first.
 * Safe to stop and restart: finished days are skipped.
 *
 *   npm run backfill                      # last 3 years
 *   npm run backfill -- --from 2025-01-01 --to 2025-12-31
 *   npm run backfill -- --concurrency 2 --interval 400
 *
 * Then: npm run geocode && npm run upload
 */
import { HttpClient } from '../lib/http';
import { addDays, crawlDay, phillyToday, yearsAgo, type DayMarker } from '../lib/ingest';
import { FsKV, KEYS } from '../lib/kv';

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const today = phillyToday();
const to = arg('to', addDays(today, -1))!;
const from = arg('from', yearsAgo(today, 3))!;
const dataDir = arg('data', 'data')!;
const http = new HttpClient({
  concurrency: Number(arg('concurrency', '2')),
  minIntervalMs: Number(arg('interval', '400')),
  timeoutMs: 30_000,
  retries: 4,
  userAgent: 'PhillyFoodInspectionsMap/1.0 (backfill)',
});
const kv = new FsKV(dataDir);

const days: string[] = [];
for (let d = to; d >= from; d = addDays(d, -1)) days.push(d);

let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(1);
  stop = true;
  console.log('\nFinishing the current day, then stopping (Ctrl-C again to quit now)…');
});

console.log(`Backfilling ${days.length} days (${from} → ${to}) into ./${dataDir}`);
const t0 = Date.now();
let processed = 0;
let inspections = 0;
for (const date of days) {
  if (stop) break;
  const m = await kv.get<DayMarker>(KEYS.day(date));
  if (m?.complete) {
    processed++;
    continue;
  }
  try {
    const r = await crawlDay({ http, kv, geocode: false, log: (s) => console.warn(`  ${s}`) }, date);
    inspections += r.added;
    processed++;
    const rate = (Date.now() - t0) / Math.max(1, processed);
    const etaMin = Math.round(((days.length - processed) * rate) / 60000);
    console.log(
      `${date}  ${String(r.found).padStart(3)} found  ${String(r.added).padStart(3)} new  ${r.failed ? `${r.failed} failed  ` : ''}` +
        `[${processed}/${days.length}, ~${etaMin} min left]`,
    );
  } catch (e) {
    console.error(`${date}  ERROR ${e} (will retry on next run)`);
  }
}
console.log(`\nDone: ${inspections} inspections stored, ${http.requests} requests in ${Math.round((Date.now() - t0) / 60000)} min.`);
console.log('Next: npm run geocode && npm run upload');
