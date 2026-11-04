import type { IndexEntry } from '../lib/types';

const ABBREV: [RegExp, string][] = [
  [/\bstreet\b/g, 'st'],
  [/\bavenue\b/g, 'ave'],
  [/\broad\b/g, 'rd'],
  [/\bboulevard\b/g, 'blvd'],
  [/\bnorth\b/g, 'n'],
  [/\bsouth\b/g, 's'],
  [/\beast\b/g, 'e'],
  [/\bwest\b/g, 'w'],
  [/\b0+(\d)/g, '$1'], // "07th" -> "7th"
];

export function normalize(s: string): string {
  let out = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  out = out.replace(/[’'`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
  for (const [re, rep] of ABBREV) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
}

export interface Searchable {
  e: IndexEntry;
  name: string;
  hay: string;
}

export const toSearchable = (e: IndexEntry): Searchable => {
  const name = normalize(e.n);
  return { e, name, hay: `${name} ${normalize(e.a)} ${e.z}` };
};

/** Every query word must appear; name-prefix matches rank first, then most recent. */
export function searchLocal(items: Searchable[], query: string, limit = 60): IndexEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(' ');
  const hits = items.filter((it) => words.every((w) => it.hay.includes(w)));
  const score = (it: Searchable) => (it.name.startsWith(q) ? 0 : it.name.includes(q) ? 1 : 2);
  return hits
    .sort((a, b) => score(a) - score(b) || b.e.d.localeCompare(a.e.d))
    .slice(0, limit)
    .map((it) => it.e);
}

/** "Preparing and Serving: Eat-In" -> "Restaurant" etc. */
export function placeType(estType?: string): string {
  if (!estType) return '';
  const map: Record<string, string> = {
    'Preparing and Serving: Eat-In': 'Restaurant',
    'Preparing and Serving: Take Out Only': 'Take-out',
    'Restaurant: Take Out Only': 'Take-out',
    'Preparing and Serving: Grocery Store': 'Grocery with prepared food',
    'Food Vendor: Mobile Food Vendor': 'Food truck or cart',
    'Pre-Packaged Only': 'Packaged food only',
  };
  if (map[estType]) return map[estType];
  if (estType.startsWith('Caterer/Commissary')) return 'Caterer or commissary';
  const after = estType.split(':').pop()!.trim();
  return after.charAt(0).toUpperCase() + after.slice(1);
}

/** Places someone would eat at: restaurants, take-out, food trucks, grocery prepared-food counters. */
export const isPlaceToEat = (estType?: string) =>
  !estType || /^Preparing and Serving|^Restaurant|Mobile Food Vendor|Caterer On-Site/i.test(estType);

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const formatDate = (iso: string) => (iso ? DATE_FMT.format(new Date(`${iso}T00:00:00Z`)) : '');

export function relativeDate(iso: string, now = new Date()): string {
  if (!iso) return '';
  const days = Math.round((now.getTime() - new Date(`${iso}T12:00:00`).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? 'A year ago' : `${years} years ago`;
}

/** Title-case the city's ALL-CAPS street suffixes: "6800 Dicks AVE" -> "6800 Dicks Ave" */
export const prettyStreet = (s: string) =>
  s.replace(/\b0+(\d+(?:st|nd|rd|th))\b/gi, '$1').replace(/\b([A-Z]{2,})\b/g, (w) => (w.length <= 4 && !/^(NE|NW|SE|SW)$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w));

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
