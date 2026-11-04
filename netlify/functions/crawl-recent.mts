import type { Config } from '@netlify/functions';
import { blobsKV } from '../../lib/blobs';
import { HttpClient } from '../../lib/http';
import { addDays, crawlDay, patchIndex, phillyToday, type DayMarker } from '../../lib/ingest';
import { KEYS } from '../../lib/kv';
import type { Facility } from '../../lib/types';

/** How far back to re-check for late-entered reports */
const LOOKBACK_DAYS = 10;
/** Older days are re-checked at most this often */
const RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly: pick up new inspections. Today and yesterday every run; days 2–10 back
 * once a day (reports are sometimes entered late). Scheduled functions get ~30s,
 * so work stops at a deadline and the next run continues where this one left off.
 */
export default async () => {
  const started = Date.now();
  const deadline = started + 20_000;
  const kv = blobsKV();
  const http = new HttpClient({
    concurrency: 3,
    minIntervalMs: 150,
    timeoutMs: 8000,
    retries: 1,
    userAgent: `PhillyFoodInspectionsMap/1.0 (+${process.env.URL ?? 'netlify'})`,
  });
  const log = (m: string) => console.log(`[crawl] ${m}`);
  const today = phillyToday();
  const touched: Facility[] = [];

  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    if (Date.now() > deadline) break;
    const date = addDays(today, -back);
    if (back >= 2) {
      const m = await kv.get<DayMarker>(KEYS.day(date));
      if (m?.complete && Date.now() - Date.parse(m.checkedAt) < RECHECK_MS) continue;
    }
    try {
      const r = await crawlDay({ http, kv, geocode: true, deadline, log }, date);
      touched.push(...r.facilities);
      log(`${date}: ${r.found} found, ${r.added} added, ${r.failed} failed, ${r.skipped} deferred`);
    } catch (e) {
      log(`${date}: ${e}`);
    }
  }
  await patchIndex(kv, touched);
  log(`done in ${Date.now() - started}ms, ${http.requests} requests, ${touched.length} facilities updated`);
};

export const config: Config = { schedule: '@hourly' };
