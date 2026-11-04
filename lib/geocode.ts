/** US Census geocoder (free, no key). https://geocoding.geo.census.gov */
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations';
const BENCHMARK = 'Public_AR_Current';

export interface GeoInput {
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}
export interface GeoResult {
  lat: number;
  lng: number;
}

const SUFFIX = 'ST|AVE|AV|RD|BLVD|DR|LN|PL|PKWY|HWY|PIKE|WAY|CT|TER|SQ|CIR|ALY|WALK|PLZ|ROW|STREET|AVENUE|ROAD|BOULEVARD|DRIVE|LANE';

/**
 * Philly's records pad ordinals ("S 07th ST") and append unit/notes after the street
 * ("2275 Bridge ST BLDG 38 5401 Tacony St…"). The Census geocoder misses both, so trim to
 * "<number> <name> <suffix>" when that pattern is present.
 */
export function cleanStreet(street: string): string {
  const s = street.replace(/\b0+(\d+(?:st|nd|rd|th))\b/gi, '$1').replace(/\s+/g, ' ').trim();
  const m = s.match(new RegExp(`^(\\d+[A-Z]?(?:-\\d+)?\\s+(?:[NSEW]\\s+)?[\\w.' ]+?\\s(?:${SUFFIX})\\b\\.?)`, 'i'));
  return m ? m[1] : s;
}

export async function geocodeOne(a: Omit<GeoInput, 'id'>): Promise<GeoResult | null> {
  const address = `${cleanStreet(a.street)}, ${a.city || 'Philadelphia'}, ${a.state || 'PA'} ${a.zip}`.trim();
  const url = `${CENSUS}/onelineaddress?address=${encodeURIComponent(address)}&benchmark=${BENCHMARK}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: { addressMatches?: { coordinates: { x: number; y: number } }[] };
  };
  const c = json.result?.addressMatches?.[0]?.coordinates;
  return c ? { lat: c.y, lng: c.x } : null;
}

const csvField = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;

/** Minimal CSV line parser (quoted fields, "" escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse the batch response: id, input, Match|No_Match|Tie, Exact|Non_Exact, matched, "lon,lat", tigerId, side */
export function parseBatchResponse(csv: string): Map<string, GeoResult | null> {
  const out = new Map<string, GeoResult | null>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const id = f[0];
    if (f[2] === 'Match' && f[5]) {
      const [lng, lat] = f[5].split(',').map(Number);
      out.set(id, Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);
    } else out.set(id, null);
  }
  return out;
}

/** Batch geocode up to 10,000 addresses per request (we send 1,000 at a time). */
export async function geocodeBatch(rows: GeoInput[], chunk = 1000): Promise<Map<string, GeoResult | null>> {
  const all = new Map<string, GeoResult | null>();
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const csv = part
      .map((r) => [r.id, cleanStreet(r.street), r.city || 'Philadelphia', r.state || 'PA', r.zip].map(csvField).join(','))
      .join('\n');
    const fd = new FormData();
    fd.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');
    fd.append('benchmark', BENCHMARK);
    const res = await fetch(`${CENSUS}/addressbatch`, { method: 'POST', body: fd, signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`Census batch HTTP ${res.status}`);
    for (const [k, v] of parseBatchResponse(await res.text())) all.set(k, v);
  }
  return all;
}
