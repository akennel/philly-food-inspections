/** Fetchers for philadelphia-pa.healthinspections.us */
import type { HttpClient } from './http';
import { parseEstablishment, parseReport, parseSearch, type ParsedReport } from './parse';
import { reportUrl, type SearchResult } from './types';

export const BASE = 'https://philadelphia-pa.healthinspections.us';
const PAGE_SIZE = 20;
/** The site never returns more than this many facilities for one query. */
export const RESULT_CAP = 100;

const isSearchPage = (h: string) => /<h3>\s*Facility\s*<\/h3>/i.test(h);
const isReportPage = (h: string) => /Food Facility Inspection Report/i.test(h);
const isEstabPage = (h: string) => /id=["']demographic["']/i.test(h);

const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

export interface SearchParams {
  /** Keyword (name or address) */
  kw?: string;
  field?: 'name' | 'address';
  zip?: string;
  /** YYYY-MM-DD, inclusive */
  from?: string;
  to?: string;
  start?: number;
}

/** Mirrors the GoSearch() URL the site's own form builds. */
export function searchUrl(p: SearchParams): string {
  const rel = p.field === 'address' ? 'F.address_full_facility' : 'F.organization_facility';
  const hasDates = Boolean(p.from && p.to);
  const q = [
    p.start && p.start > 1 ? `start=${p.start}` : '',
    '1=1',
    `sd=${hasDates ? usDate(p.from!) : ''}`,
    `ed=${hasDates ? usDate(p.to!) : ''}`,
    `kw1=${encodeURIComponent(p.kw ?? '')}`,
    'kw2=',
    `rel1=${rel}`,
    'rel2=F.organization_facility',
    `zc=${p.zip ?? ''}`,
    'facType=Any',
    `dtRng=${hasDates ? 'YES' : 'NO'}`,
    'pre=Contains',
    'subType=Any',
  ].filter(Boolean);
  return `${BASE}/philadelphia/search.cfm?${q.join('&')}`;
}

export async function search(http: HttpClient, p: SearchParams, maxPages = 5) {
  const first = parseSearch(await http.text(searchUrl({ ...p, start: 1 }), isSearchPage));
  const results = [...first.results];
  const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), maxPages);
  for (let page = 2; page <= pages; page++) {
    const r = parseSearch(await http.text(searchUrl({ ...p, start: (page - 1) * PAGE_SIZE + 1 }), isSearchPage));
    results.push(...r.results);
  }
  return { total: first.total, results: dedupe(results), capped: first.total >= RESULT_CAP };
}

function dedupe(rs: SearchResult[]) {
  const seen = new Set<string>();
  return rs.filter((r) => (seen.has(r.facilityId) ? false : (seen.add(r.facilityId), true)));
}

/** All food inspections on one day. One day is well under the 100-result cap (~70 on a busy weekday). */
export async function searchDay(http: HttpClient, date: string) {
  const r = await search(http, { from: date, to: date });
  if (r.capped) console.warn(`[philly] ${date} hit the ${RESULT_CAP}-result cap; some inspections may be missing`);
  return r.results.filter((x) => x.inspectionId && (!x.inspType || x.inspType === 'Food'));
}

export async function fetchReport(http: HttpClient, inspectionId: string): Promise<ParsedReport> {
  return parseReport(await http.text(reportUrl(inspectionId), isReportPage), inspectionId);
}

export async function fetchEstablishment(http: HttpClient, facilityId: string) {
  const html = await http.text(`${BASE}/philadelphia/estab.cfm?facilityID=${facilityId}`, isEstabPage);
  return parseEstablishment(html);
}
