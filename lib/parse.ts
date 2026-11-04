/**
 * Dependency-free parsers for philadelphia-pa.healthinspections.us pages.
 * Kept free of DOM/cheerio so they run the same in Node, Netlify Functions and a browser.
 */
import { isRiskItem, tierFor } from './tier';
import type { GridItem, Inspection, ItemStatus, Observation, SearchResult } from './types';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', deg: '°', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
};

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip tags, keep line breaks from <br>, collapse whitespace. */
export function htmlToText(s: string): string {
  return decode(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const oneLine = (s: string) => htmlToText(s).replace(/\s+/g, ' ').trim();

/** MM/DD/YYYY -> YYYY-MM-DD */
export function isoDate(us: string | undefined): string | undefined {
  const m = us?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return undefined;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Text of every innermost <td> (cells that don't contain another table/td), in document order. */
export function innerCells(html: string): string[] {
  const out: string[] = [];
  const re = /<td\b[^>]*>((?:(?!<td\b|<\/td>|<table\b)[\s\S])*)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(oneLine(m[1]));
  return out;
}

const STATUS_RE = /^(IN|OUT|N\/O|N\/A)$/i;
const ITEM_RE = /^\d{1,2}\+?$/;

function afterLabel(cells: string[], label: string, exclude?: RegExp): string | undefined {
  const c = cells.find((x) => x.toLowerCase().startsWith(label.toLowerCase()) && !exclude?.test(x));
  if (c === undefined) return undefined;
  const v = c.slice(label.length).trim();
  return v || undefined;
}

function valueAfterCell(cells: string[], label: string): string | undefined {
  const i = cells.findIndex((x) => x.toLowerCase() === label.toLowerCase());
  return i >= 0 ? cells[i + 1] : undefined;
}

const num = (s: string | undefined) => {
  const n = parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

export interface ParsedReport extends Inspection {
  name?: string;
  /** Street + zip as printed on the report, e.g. "4315 N 5TH ST 19140" */
  address?: string;
  phone?: string;
  estType?: string;
  /** How many grid rows we read (any status). 0 means the template was unrecognised. */
  gridItemsSeen: number;
}

/** Parse the full inspection report (_report_full.cfm). */
export function parseReport(html: string, inspectionId: string): ParsedReport {
  const cells = innerCells(html);

  const riskCount = num(valueAfterCell(cells, 'No. of Risk Factor/Intervention Violations'));
  const repeatRiskCount = num(valueAfterCell(cells, 'No. of Repeat Risk Factor/Intervention Violations'));
  const corrections = num(valueAfterCell(cells, 'Number of Corrections'));
  const date = isoDate(valueAfterCell(cells, 'Date')) ?? '';
  const timeIn = valueAfterCell(cells, 'Time In');
  const timeOut = valueAfterCell(cells, 'Time Out');

  const name = afterLabel(cells, 'Food Facility', /^Food Facility Inspection Report/i);
  const address = afterLabel(cells, 'Address');
  const phone = afterLabel(cells, 'Telephone');
  const estType = afterLabel(cells, 'Establishment Type');
  const purpose = afterLabel(cells, 'Purpose of Inspection');
  const type = afterLabel(cells, 'Inspection Type');

  // Compliance grid: [n][status][description][COS][R]
  const seen = new Set<string>();
  const violations: GridItem[] = [];
  for (let i = 0; i < cells.length - 2; i++) {
    if (!ITEM_RE.test(cells[i]) || !STATUS_RE.test(cells[i + 1])) continue;
    const n = cells[i];
    if (seen.has(n)) continue;
    seen.add(n);
    const status = cells[i + 1].toUpperCase() as ItemStatus;
    if (status === 'OUT') {
      violations.push({
        n,
        status,
        desc: cells[i + 2] ?? '',
        cos: /x/i.test(cells[i + 3] ?? ''),
        repeat: /x/i.test(cells[i + 4] ?? ''),
        risk: isRiskItem(n),
      });
    }
    i += 2;
  }

  // Observations: [n][free text], appearing after "OBSERVATIONS AND CORRECTIVE ACTIONS" (may repeat per page).
  const observations: Observation[] = [];
  const obsKeys = new Set<string>();
  let inObs = false;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (/^OBSERVATIONS AND CORRECTIVE ACTIONS/i.test(c)) { inObs = true; continue; }
    if (/^FOODBORNE ILLNESS RISK FACTORS/i.test(c) || /^Food Facility Inspection Report$/i.test(c)) inObs = false;
    if (!inObs || !ITEM_RE.test(c)) continue;
    const raw = cells[i + 1] ?? '';
    if (!raw || STATUS_RE.test(raw)) continue;
    const codeMatch = raw.match(/^Violation of Code:\s*\[([^\]]+)\]\s*/i);
    const text = (codeMatch ? raw.slice(codeMatch[0].length) : raw)
      .replace(/\s*Corrected on Site:\s*/i, ' — Corrected on site: ')
      .trim();
    const key = `${c}|${text}`;
    if (obsKeys.has(key)) continue;
    obsKeys.add(key);
    observations.push({ n: c, code: codeMatch?.[1], text });
    i += 1;
  }

  return {
    id: inspectionId,
    date,
    purpose,
    type,
    timeIn,
    timeOut,
    riskCount,
    repeatRiskCount,
    corrections,
    violations,
    observations,
    tier: tierFor(violations, seen.size, riskCount),
    name,
    address,
    phone,
    estType,
    gridItemsSeen: seen.size,
  };
}

function splitCityLine(lines: string[]) {
  const last = lines[lines.length - 1] ?? '';
  const m = last.match(/^(.*?),\s*([A-Za-z]{2})\s+(\d{5})/);
  if (!m) return { street: lines.join(' '), city: 'Philadelphia', state: 'PA', zip: '' };
  return {
    street: lines.slice(0, -1).join(' ').trim(),
    city: m[1].trim().replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    state: m[2].toUpperCase(),
    zip: m[3],
  };
}

export interface ParsedSearch {
  total: number;
  results: SearchResult[];
}

/** Parse search.cfm results (20 per page). */
export function parseSearch(html: string): ParsedSearch {
  const total = num(html.match(/([\d,]+)\s*Facilities matched/i)?.[1]?.replace(/,/g, ''));
  const results: SearchResult[] = [];
  // Each result starts with a link to estab.cfm?facilityID=<id> (no inspectionID)
  const parts = html.split(/<a\s+href=["']estab\.cfm\?facilityID=(?=[^"'&]+["'])/i);
  for (const part of parts.slice(1)) {
    const facilityId = part.match(/^([^"']+)/)?.[1];
    if (!facilityId) continue;
    const name = oneLine(part.match(/<b>([\s\S]*?)<\/b>/i)?.[1] ?? '');
    const afterLink = part.slice(part.indexOf('</a>') + 4);
    const addrHtml = afterLink.split(/Last Inspection Date/i)[0];
    const lines = htmlToText(addrHtml).split('\n').map((l) => l.trim()).filter(Boolean);
    const insp = decode(part).match(/inspectionID=([A-F0-9-]+)(?:&inspType=(\w+))?[^>]*>\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    results.push({
      facilityId,
      name,
      ...splitCityLine(lines),
      inspectionId: insp?.[1],
      inspType: insp?.[2],
      lastDate: isoDate(insp?.[3]),
    });
  }
  return { total, results };
}

export interface ParsedEstablishment {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  inspections: { id: string; date: string }[];
}

/** Parse estab.cfm?facilityID=... ("Related Reports" lists every inspection). */
export function parseEstablishment(html: string): ParsedEstablishment {
  const demo = html.match(/<div id=["']demographic["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const name = oneLine(demo.match(/<b[^>]*>([\s\S]*?)<\/b>/i)?.[1] ?? '');
  const addrHtml = demo.match(/<i>([\s\S]*?)<a\b/i)?.[1] ?? '';
  const lines = htmlToText(addrHtml).split('\n').map((l) => l.trim()).filter(Boolean);

  const inspections: { id: string; date: string }[] = [];
  const seen = new Set<string>();
  const segs = decode(html).split(/Inspection Date:/i).slice(1);
  for (const seg of segs) {
    const date = isoDate(seg.match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0]);
    const id = seg.match(/_report_full\.cfm\?inspectionID=([A-F0-9-]+)/i)?.[1];
    if (date && id && !seen.has(id)) {
      seen.add(id);
      inspections.push({ id, date });
    }
  }
  inspections.sort((a, b) => b.date.localeCompare(a.date));
  return { name, ...splitCityLine(lines), inspections };
}
