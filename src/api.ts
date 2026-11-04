import type { Facility, IndexEntry, SearchResult } from '../lib/types';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const fetchIndex = () => getJSON<IndexEntry[]>('/api/index');

export const fetchFacility = (id: string) => getJSON<Facility>(`/api/facility/${encodeURIComponent(id)}`);

export const liveSearch = (q: string) =>
  getJSON<{ results: SearchResult[]; total: number }>(`/api/live-search?q=${encodeURIComponent(q)}`);
