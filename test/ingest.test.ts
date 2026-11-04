import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../lib/http';
import { addDays, crawlDay, loadFacility, patchIndex, phillyToday, rebuildIndex, yearsAgo, type DayMarker } from '../lib/ingest';
import { FsKV, KEYS } from '../lib/kv';
import type { Facility, IndexEntry } from '../lib/types';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const http = () => new HttpClient({ concurrency: 2, minIntervalMs: 0, retries: 1 });

/** Fake the site: search -> fixture, reports -> fixture, estab -> fixture. */
function mockSite(opts: { failReport?: string } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    let body = '';
    if (url.includes('search.cfm')) body = fixture('search.html').replace('72 Facilities', '3 Facilities');
    else if (url.includes('_report_full.cfm')) body = opts.failReport && url.includes(opts.failReport) ? 'oops' : fixture('report.html');
    else if (url.includes('estab.cfm')) body = fixture('estab.html');
    return new Response(body, { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('crawlDay', () => {
  it('stores food inspections, skips non-food, and is resumable', async () => {
    const kv = new FsKV(mkdtempSync(join(tmpdir(), 'pfi-')));
    const calls = mockSite({ failReport: '58C44FF2' });

    const r1 = await crawlDay({ http: http(), kv }, '2026-11-02');
    expect(r1.found).toBe(2); // the EE inspection is excluded
    expect(r1.added).toBe(1);
    expect(r1.failed).toBe(1);
    expect(r1.complete).toBe(false);
    expect(calls.some((c) => c.includes('562601'))).toBe(false);

    const f = await kv.get<Facility>(KEYS.facility('6BD93D98-1404-4676-90A6-3D975227D374'));
    expect(f).toMatchObject({ name: 'ACCA Food Market', street: '6800 Dicks AVE', zip: '19142', estType: 'Preparing and Serving: Eat-In' });
    expect(f!.inspections).toHaveLength(1);
    expect(f!.inspections[0]).toMatchObject({ id: '27473D62-0607-E5E5-16B6EDA29717613D', tier: 'risk' });
    expect(f!.inspections[0]).not.toHaveProperty('gridItemsSeen');

    // Second run only fetches the report that failed
    calls.length = 0;
    mockSite();
    const r2 = await crawlDay({ http: http(), kv }, '2026-11-02');
    expect(r2.added).toBe(1);
    expect(r2.complete).toBe(true);
    const m = await kv.get<DayMarker>(KEYS.day('2026-11-02'));
    expect(m!.done).toHaveLength(2);
  });
});

describe('loadFacility + index', () => {
  it('pulls history from the establishment page and indexes it', async () => {
    const kv = new FsKV(mkdtempSync(join(tmpdir(), 'pfi-')));
    mockSite();
    const f = await loadFacility({ http: http(), kv }, '7F61E2AA-092E-4D87-BFE8-4DC2A8F17597', '2024-01-01');
    expect(f!.name).toBe('20th Street Pizza');
    expect(f!.inspections.map((i) => i.id)).toEqual(['6E4EFA4F-B1D9-5991-0AA642D841B1429E', 'A7FE845E-9845-C98F-BDECD9938413F33C']);

    await patchIndex(kv, [f!]);
    let index = (await kv.get<IndexEntry[]>(KEYS.index))!;
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ n: '20th Street Pizza', t: 'risk', r: 3, g: 1 });

    index = await rebuildIndex(kv);
    expect(index).toHaveLength(1);
  });

  it('respects the since-date cutoff', async () => {
    const kv = new FsKV(mkdtempSync(join(tmpdir(), 'pfi-')));
    mockSite();
    const f = await loadFacility({ http: http(), kv }, 'X', '2026-01-01');
    expect(f!.inspections).toHaveLength(1);
  });
});

describe('dates', () => {
  it('handles Philly-local today and offsets', () => {
    expect(phillyToday(new Date('2026-11-04T03:30:00Z'))).toBe('2026-11-03'); // 10:30pm ET
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(yearsAgo('2026-11-03', 3)).toBe('2023-11-03');
  });
});
