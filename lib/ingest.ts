/** Crawl + merge logic shared by the scheduled function, the on-demand lookup and the backfill script. */
import { geocodeOne } from './geocode';
import { mapLimit, type HttpClient } from './http';
import { KEYS, type KV } from './kv';
import type { ParsedReport } from './parse';
import { fetchEstablishment, fetchReport, searchDay } from './philly';
import { toIndexEntry } from './tier';
import type { Facility, IndexEntry, Inspection, SearchResult } from './types';

export interface DayMarker {
  date: string;
  /** Inspection ids already stored */
  done: string[];
  total: number;
  complete: boolean;
  checkedAt: string;
}

export interface IngestOptions {
  http: HttpClient;
  kv: KV;
  /** Geocode new facilities one at a time (fine for small batches; the backfill batch-geocodes instead) */
  geocode?: boolean;
  /** Epoch ms; stop starting new report fetches after this */
  deadline?: number;
  log?: (msg: string) => void;
}

/** Strip parse-only fields so only inspection data is stored. */
export function toInspection(r: ParsedReport): Inspection {
  const { name: _n, address: _a, phone: _p, estType: _e, gridItemsSeen: _g, ...insp } = r;
  return insp;
}

export function mergeInspection(f: Facility, insp: Inspection): Facility {
  const others = f.inspections.filter((x) => x.id !== insp.id);
  const inspections = [...others, insp].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { ...f, inspections, updatedAt: new Date().toISOString() };
}

function newFacility(id: string, base: Pick<Facility, 'name' | 'street' | 'city' | 'state' | 'zip'>): Facility {
  return { id, ...base, inspections: [], updatedAt: new Date().toISOString() };
}

async function maybeGeocode(f: Facility, enabled: boolean | undefined, log: (m: string) => void) {
  if (!enabled || f.lat !== undefined || f.geocode === 'nomatch') return f;
  try {
    const g = await geocodeOne(f);
    return g ? { ...f, ...g, geocode: 'match' as const } : { ...f, geocode: 'nomatch' as const };
  } catch (e) {
    log(`geocode failed for ${f.id}: ${e}`);
    return f;
  }
}

/** Store parsed reports for search results, grouped by facility. Returns the updated facilities. */
export async function storeReports(
  opts: IngestOptions,
  items: { result: SearchResult; report: ParsedReport }[],
): Promise<Facility[]> {
  const log = opts.log ?? (() => {});
  const byFacility = new Map<string, { result: SearchResult; report: ParsedReport }[]>();
  for (const it of items) {
    const list = byFacility.get(it.result.facilityId) ?? [];
    list.push(it);
    byFacility.set(it.result.facilityId, list);
  }
  const updated: Facility[] = [];
  for (const [id, list] of byFacility) {
    const r0 = list[0].result;
    let f = (await opts.kv.get<Facility>(KEYS.facility(id))) ?? newFacility(id, r0);
    // Search results carry the cleanest name/address; keep them current.
    f = { ...f, name: r0.name || f.name, street: r0.street || f.street, city: r0.city || f.city, state: r0.state || f.state, zip: r0.zip || f.zip };
    for (const { report } of list) {
      f = mergeInspection(f, toInspection(report));
      if (report.estType) f.estType = report.estType;
      if (report.phone) f.phone = report.phone;
    }
    f = await maybeGeocode(f, opts.geocode, log);
    await opts.kv.set(KEYS.facility(id), f);
    updated.push(f);
  }
  return updated;
}

/** Crawl one day: search, fetch any reports not stored yet, store them. Resumable via the day marker. */
export async function crawlDay(opts: IngestOptions, date: string) {
  const log = opts.log ?? (() => {});
  const results = await searchDay(opts.http, date);
  const marker = (await opts.kv.get<DayMarker>(KEYS.day(date))) ?? {
    date, done: [], total: 0, complete: false, checkedAt: '',
  };
  const done = new Set(marker.done);
  const todo = results.filter((r) => !done.has(r.inspectionId!));

  const { results: fetched, errors, skipped } = await mapLimit(
    todo,
    opts.http.opts.concurrency,
    async (result) => ({ result, report: await fetchReport(opts.http, result.inspectionId!) }),
    opts.deadline,
  );
  for (const e of errors) log(`report ${e.item.inspectionId} (${e.item.name}) failed: ${e.error}`);

  const facilities = await storeReports(opts, fetched);
  for (const f of fetched) done.add(f.result.inspectionId!);

  const next: DayMarker = {
    date,
    done: [...done],
    total: results.length,
    complete: results.every((r) => done.has(r.inspectionId!)),
    checkedAt: new Date().toISOString(),
  };
  await opts.kv.set(KEYS.day(date), next);
  return { date, found: results.length, added: fetched.length, failed: errors.length, skipped: skipped.length, complete: next.complete, facilities };
}

/** On-demand: load (or refresh) one facility's full history straight from the site. */
export async function loadFacility(opts: IngestOptions, facilityId: string, sinceDate: string): Promise<Facility | null> {
  const est = await fetchEstablishment(opts.http, facilityId);
  if (!est.name && est.inspections.length === 0) return null;
  let f = (await opts.kv.get<Facility>(KEYS.facility(facilityId))) ?? newFacility(facilityId, est);
  f = { ...f, name: est.name || f.name, street: est.street || f.street, city: est.city || f.city, state: est.state || f.state, zip: est.zip || f.zip };
  const have = new Set(f.inspections.map((i) => i.id));
  const todo = est.inspections.filter((i) => i.date >= sinceDate && !have.has(i.id));
  const { results } = await mapLimit(todo, opts.http.opts.concurrency, (i) => fetchReport(opts.http, i.id), opts.deadline);
  for (const r of results.sort((a, b) => a.date.localeCompare(b.date))) {
    f = mergeInspection(f, toInspection(r));
    if (r.estType) f.estType = r.estType;
    if (r.phone) f.phone = r.phone;
  }
  f = { ...(await maybeGeocode(f, opts.geocode, opts.log ?? (() => {}))), updatedAt: new Date().toISOString() };
  await opts.kv.set(KEYS.facility(facilityId), f);
  return f;
}

/** Replace/insert index rows for the given facilities. */
export async function patchIndex(kv: KV, facilities: Facility[]) {
  if (!facilities.length) return;
  const index = (await kv.get<IndexEntry[]>(KEYS.index)) ?? [];
  const byId = new Map(index.map((e) => [e.i, e]));
  for (const f of facilities) {
    const e = toIndexEntry(f);
    if (e) byId.set(e.i, e);
  }
  await kv.set(KEYS.index, [...byId.values()]);
}

/** Rebuild the index from every stored facility. */
export async function rebuildIndex(kv: KV, concurrency = 16): Promise<IndexEntry[]> {
  const keys = await kv.list('facility/');
  const { results } = await mapLimit(keys, concurrency, (k) => kv.get<Facility>(k));
  const index = results.map((f) => (f ? toIndexEntry(f) : null)).filter((e): e is IndexEntry => !!e);
  await kv.set(KEYS.index, index);
  return index;
}

/** Date helpers in Philadelphia time. */
export function phillyToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const yearsAgo = (iso: string, y: number) => `${Number(iso.slice(0, 4)) - y}${iso.slice(4)}`;
