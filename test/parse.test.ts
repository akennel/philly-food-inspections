import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanStreet, parseBatchResponse } from '../lib/geocode';
import { isoDate, parseEstablishment, parseReport, parseSearch } from '../lib/parse';
import { searchUrl } from '../lib/philly';
import { tierFor } from '../lib/tier';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('parseReport', () => {
  const r = parseReport(fixture('report.html'), 'ID1');

  it('reads the header block', () => {
    expect(r.date).toBe('2025-11-21');
    expect(r.riskCount).toBe(3);
    expect(r.repeatRiskCount).toBe(1);
    expect(r.corrections).toBe(2);
    expect(r.timeIn).toBe('11:45 AM');
    expect(r.timeOut).toBe('02:00 PM');
  });

  it('reads facility details (not the page title)', () => {
    expect(r.name).toBe('Mr. Platano');
    expect(r.address).toBe('4315 N 5TH ST 19140');
    expect(r.phone).toBe('(267) 444-9383');
    expect(r.estType).toBe('Preparing and Serving: Eat-In');
    expect(r.purpose).toBe('Reinspection');
    expect(r.type).toBe('Reinspection');
  });

  it('keeps only OUT grid items, with COS/repeat/risk flags', () => {
    expect(r.gridItemsSeen).toBe(8);
    expect(r.violations.map((v) => v.n)).toEqual(['1', '13', '20', '35']);
    expect(r.violations[0]).toMatchObject({ cos: true, repeat: false, risk: true });
    expect(r.violations[2]).toMatchObject({ n: '20', cos: false, repeat: true, risk: true });
    expect(r.violations[3]).toMatchObject({ n: '35', risk: false });
    expect(r.violations[1].desc).toBe('Food separated & protected');
  });

  it('collects observations across pages, deduped, with code citations', () => {
    expect(r.observations.map((o) => o.n)).toEqual(['1', '13', '20', '35']);
    expect(r.observations[0].code).toBe('46.103');
    expect(r.observations[0].text).toBe('No certified person on site. — Corrected on site: Application will be sent. Corrected On-Site.');
    expect(r.observations[2].code).toBe('46.385(a)(2)');
  });

  it('assigns the risk tier', () => {
    expect(r.tier).toBe('risk');
  });
});

describe('tierFor', () => {
  const v = (n: string, risk: boolean) => ({ n, status: 'OUT' as const, desc: '', cos: false, repeat: false, risk });
  it('ranks risk > minor > clean > unknown', () => {
    expect(tierFor([v('5', true), v('40', false)], 56)).toBe('risk');
    expect(tierFor([v('40', false)], 56)).toBe('minor');
    expect(tierFor([], 56)).toBe('clean');
    expect(tierFor([], 0)).toBe('unknown');
    expect(tierFor([], 56, 2)).toBe('risk');
  });
});

describe('parseSearch', () => {
  const s = parseSearch(fixture('search.html'));
  it('reads total and each result', () => {
    expect(s.total).toBe(72);
    expect(s.results).toHaveLength(3);
    expect(s.results[0]).toEqual({
      facilityId: '6BD93D98-1404-4676-90A6-3D975227D374',
      name: 'ACCA Food Market',
      street: '6800 Dicks AVE',
      city: 'Philadelphia',
      state: 'PA',
      zip: '19142',
      inspectionId: '27473D62-0607-E5E5-16B6EDA29717613D',
      inspType: 'Food',
      lastDate: '2026-11-02',
    });
  });
  it('flags non-food inspection types and decodes names', () => {
    expect(s.results[1]).toMatchObject({ inspectionId: '562601', inspType: 'EE', city: 'Philadelphia' });
    expect(s.results[2].name).toBe('"Gate 1 Grill" - Aramark at Penn Athletics');
    expect(s.results[2].street).toBe('235 S 33rd ST 3200 Walnut St.');
  });
});

describe('parseEstablishment', () => {
  it('reads name, address and every report (newest first)', () => {
    const e = parseEstablishment(fixture('estab.html'));
    expect(e).toMatchObject({ name: '20th Street Pizza', street: '108 S 20th St', city: 'Philadelphia', zip: '19103' });
    expect(e.inspections).toEqual([
      { id: '6E4EFA4F-B1D9-5991-0AA642D841B1429E', date: '2026-01-29' },
      { id: 'A7FE845E-9845-C98F-BDECD9938413F33C', date: '2025-03-18' },
    ]);
  });
});

describe('helpers', () => {
  it('isoDate', () => {
    expect(isoDate('1/5/2026')).toBe('2026-01-05');
    expect(isoDate('nope')).toBeUndefined();
  });

  it('searchUrl matches the site form', () => {
    expect(searchUrl({ from: '2026-11-02', to: '2026-11-02', start: 21 })).toBe(
      'https://philadelphia-pa.healthinspections.us/philadelphia/search.cfm?start=21&1=1&sd=11/02/2026&ed=11/02/2026&kw1=&kw2=&rel1=F.organization_facility&rel2=F.organization_facility&zc=&facType=Any&dtRng=YES&pre=Contains&subType=Any',
    );
    expect(searchUrl({ kw: 'pat & joe', field: 'address' })).toContain('kw1=pat%20%26%20joe&kw2=&rel1=F.address_full_facility');
    expect(searchUrl({ kw: 'x' })).toContain('dtRng=NO');
  });

  it('cleans Philly street strings for geocoding', () => {
    expect(cleanStreet('325 S 07th ST')).toBe('325 S 7th ST');
    expect(cleanStreet('795 S 03rd ST')).toBe('795 S 3rd ST');
    expect(cleanStreet('2275 Bridge ST BLDG 38 5401 Tacony St, Phila, 19137')).toBe('2275 Bridge ST');
    expect(cleanStreet('1700 Washington AVE L&I License 0979290')).toBe('1700 Washington AVE');
    expect(cleanStreet('1126 Arch St A2 1126 - 1136 Reading Terminal')).toBe('1126 Arch St');
    expect(cleanStreet('2308 Cecil B. Moore AVE')).toBe('2308 Cecil B. Moore AVE');
    expect(cleanStreet('6601 N Broad ST')).toBe('6601 N Broad ST');
    expect(cleanStreet('Non-Permanent Location')).toBe('Non-Permanent Location');
  });

  it('parses Census batch output', () => {
    const csv =
      '"a1","6800 Dicks AVE, Philadelphia, PA, 19142","Match","Exact","6800 DICKS AVE, PHILADELPHIA, PA, 19142","-75.231614484538,39.916894126037","131409325","L"\n' +
      '"a2","Nowhere","No_Match"\n';
    const m = parseBatchResponse(csv);
    expect(m.get('a1')).toEqual({ lat: 39.916894126037, lng: -75.231614484538 });
    expect(m.get('a2')).toBeNull();
  });
});
