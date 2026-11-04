import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TIER_LABEL } from '../lib/tier';
import type { Facility, IndexEntry, SearchResult, Tier } from '../lib/types';
import { fetchFacility, fetchIndex, liveSearch } from './api';
import { FacilityDetail } from './components/FacilityDetail';
import { MapView } from './components/MapView';
import { TierIcon } from './components/TierIcon';
import { isPlaceToEat, placeType, prettyStreet, relativeDate, searchLocal, toSearchable } from './util';

const TIERS: Tier[] = ['clean', 'minor', 'risk'];
const CHIP_LABEL: Record<Tier, string> = { clean: 'Clean', minor: 'Minor issues', risk: 'Risk factors', unknown: 'Not rated' };
const LIST_LIMIT = 60;

type Live =
  | { status: 'idle' }
  | { status: 'loading'; q: string }
  | { status: 'done'; q: string; results: SearchResult[] }
  | { status: 'error'; q: string; message: string };

const idFromPath = () => location.pathname.match(/^\/f\/([A-Fa-f0-9-]+)/)?.[1] ?? null;

export function App() {
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tiers, setTiers] = useState<Set<Tier>>(new Set([...TIERS, 'unknown']));
  const [eatOnly, setEatOnly] = useState(true);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(idFromPath);
  const [facility, setFacility] = useState<Facility | null>(null);
  const [facilityState, setFacilityState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [facilityError, setFacilityError] = useState('');
  const [live, setLive] = useState<Live>({ status: 'idle' });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchIndex()
      .then(setIndex)
      .catch((e) => setIndexError(String(e.message ?? e)));
  }, []);

  // URL <-> selection
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const path = id ? `/f/${id}` : '/';
    if (location.pathname !== path) history.pushState(null, '', path);
  }, []);
  useEffect(() => {
    const onPop = () => setSelectedId(idFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Load the selected facility (the API pulls it from the city's site if we don't have it yet).
  useEffect(() => {
    if (!selectedId) {
      setFacility(null);
      return;
    }
    let cancelled = false;
    setFacilityState('loading');
    fetchFacility(selectedId)
      .then((f) => {
        if (cancelled) return;
        setFacility(f);
        setFacilityState('idle');
        listRef.current?.scrollTo({ top: 0 });
        // A place loaded on demand joins the map right away.
        setIndex((prev) => {
          if (!prev || prev.some((e) => e.i === f.id)) return prev;
          const last = f.inspections[0];
          if (!last) return prev;
          return [...prev, { i: f.id, n: f.name, a: f.street, z: f.zip, y: f.lat, x: f.lng, d: last.date, t: last.tier, r: last.violations.filter((v) => v.risk).length, g: last.violations.filter((v) => !v.risk).length, e: f.estType }];
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setFacilityError(String(e.message ?? e));
        setFacilityState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const searchable = useMemo(() => (index ?? []).map(toSearchable), [index]);
  const q = query.trim();
  const tierOk = (e: IndexEntry) => tiers.has(e.t);

  const mapPoints = useMemo(
    () => (index ?? []).filter((e) => tierOk(e) && (q ? true : !eatOnly || isPlaceToEat(e.e))),
    [index, tiers, eatOnly, q],
  );
  const matches = useMemo(() => (q ? searchLocal(searchable, q, 500).filter(tierOk) : null), [searchable, q, tiers]);
  const shownOnMap = matches ?? mapPoints;

  const inView = useMemo(() => {
    if (matches) return matches.slice(0, LIST_LIMIT);
    const visible = bounds
      ? mapPoints.filter((e) => e.y !== undefined && bounds.contains([e.y, e.x!]))
      : mapPoints;
    return [...visible].sort((a, b) => b.d.localeCompare(a.d)).slice(0, LIST_LIMIT);
  }, [matches, mapPoints, bounds]);

  // Ask the city's site when we don't have a match locally.
  const runLive = useCallback((term: string) => {
    setLive({ status: 'loading', q: term });
    liveSearch(term)
      .then((r) => setLive({ status: 'done', q: term, results: r.results }))
      .catch((e) => setLive({ status: 'error', q: term, message: String(e.message ?? e) }));
  }, []);
  useEffect(() => {
    if (q.length < 3 || (matches && matches.length >= 3)) {
      setLive({ status: 'idle' });
      return;
    }
    const t = setTimeout(() => runLive(q), 700);
    return () => clearTimeout(t);
  }, [q, matches?.length, runLive]);

  const known = useMemo(() => new Set((index ?? []).map((e) => e.i)), [index]);
  const liveExtra = live.status === 'done' ? live.results.filter((r) => !known.has(r.facilityId)) : [];

  const toggleTier = (t: Tier) =>
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      if (t === 'clean' || t === 'minor' || t === 'risk') next.add('unknown');
      return next;
    });

  const selectedPoint = useMemo(() => {
    if (facility && facility.id === selectedId) return { id: facility.id, lat: facility.lat, lng: facility.lng };
    const e = index?.find((x) => x.i === selectedId);
    return e ? { id: e.i, lat: e.y, lng: e.x } : null;
  }, [facility, selectedId, index]);

  const tierCounts = useMemo(() => {
    const c: Record<Tier, number> = { clean: 0, minor: 0, risk: 0, unknown: 0 };
    for (const e of matches ?? inViewAll(mapPoints, bounds)) c[e.t]++;
    return c;
  }, [matches, mapPoints, bounds]);

  return (
    <div className={`app ${selectedId ? 'has-detail' : ''}`}>
      <aside className="panel">
        <header className="masthead">
          <a className="wordmark" href="/" onClick={(e) => { e.preventDefault(); setQuery(''); select(null); }}>
            <span className="wordmark-mark" aria-hidden="true" />
            Philly Food Inspections
          </a>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.length >= 3) runLive(q); }}>
            <label htmlFor="q" className="visually-hidden">Search by name or address</label>
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
              <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              id="q"
              type="search"
              placeholder="Restaurant name or street address"
              autoComplete="off"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (selectedId) select(null); }}
            />
          </form>
          <div className="filters" role="group" aria-label="Filter by latest result">
            {TIERS.map((t) => (
              <button key={t} className={`chip chip-${t}`} aria-pressed={tiers.has(t)} title={TIER_LABEL[t]} onClick={() => toggleTier(t)}>
                <TierIcon tier={t} size={16} />
                <span>{CHIP_LABEL[t]}</span>
                <span className="chip-count">{tierCounts[t].toLocaleString()}</span>
              </button>
            ))}
          </div>
          {!q && (
            <label className="toggle">
              <input type="checkbox" checked={eatOnly} onChange={(e) => setEatOnly(e.target.checked)} />
              Restaurants, take-out and food trucks only
            </label>
          )}
        </header>

        <div className="panel-body" ref={listRef}>
          {selectedId ? (
            facilityState === 'loading' && facility?.id !== selectedId ? (
              <p className="status" aria-live="polite">Getting inspection reports from the city…</p>
            ) : facilityState === 'error' ? (
              <div className="status">
                <p>{facilityError}</p>
                <button className="link-button" onClick={() => select(null)}>Back to results</button>
              </div>
            ) : facility ? (
              <FacilityDetail facility={facility} onBack={() => select(null)} />
            ) : null
          ) : indexError ? (
            <p className="status">Couldn't load inspections: {indexError}</p>
          ) : !index ? (
            <p className="status" aria-live="polite">Loading inspections…</p>
          ) : (
            <>
              <h2 className="list-heading" aria-live="polite">
                {q
                  ? matches!.length
                    ? `${matches!.length.toLocaleString()} ${matches!.length === 1 ? 'place matches' : 'places match'} “${q}”`
                    : `Nothing saved matches “${q}”`
                  : index.length
                    ? 'Recently inspected in this area'
                    : 'No inspections saved yet'}
              </h2>
              {!q && index.length === 0 && (
                <p className="hint">Search for a place by name and its reports will be pulled from the city's records.</p>
              )}

              <ul className="results">
                {inView.map((e) => (
                  <li key={e.i}>
                    <button className="result" onClick={() => select(e.i)}>
                      <TierIcon tier={e.t} size={22} title={TIER_LABEL[e.t]} />
                      <span className="result-main">
                        <span className="result-name">{e.n}</span>
                        <span className="result-addr">{prettyStreet(e.a)}</span>
                      </span>
                      <span className="result-side">
                        <span className="result-date">{relativeDate(e.d)}</span>
                        <span className="result-type">{placeType(e.e)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!q && inView.length === LIST_LIMIT && <p className="hint">Zoom in to see more places.</p>}
              {!q && index.length > 0 && inView.length === 0 && <p className="hint">No inspected places in this part of the map. Zoom out or turn a filter back on.</p>}

              {q.length >= 3 && (
                <section className="live" aria-live="polite">
                  {live.status === 'loading' && <p className="status">Checking the city's records for “{live.q}”…</p>}
                  {live.status === 'error' && (
                    <p className="status">
                      The city's inspection site didn't respond. <button className="link-button" onClick={() => runLive(q)}>Try again</button>
                    </p>
                  )}
                  {live.status === 'done' && liveExtra.length > 0 && (
                    <>
                      <h3 className="list-heading">More in the city's records</h3>
                      <ul className="results">
                        {liveExtra.map((r) => (
                          <li key={r.facilityId}>
                            <button className="result is-remote" onClick={() => select(r.facilityId)}>
                              <span className="remote-dot" aria-hidden="true" />
                              <span className="result-main">
                                <span className="result-name">{r.name}</span>
                                <span className="result-addr">{prettyStreet(r.street)}</span>
                              </span>
                              <span className="result-side">
                                <span className="result-date">{r.lastDate ? relativeDate(r.lastDate) : ''}</span>
                                <span className="result-type">Tap to load</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {live.status === 'done' && liveExtra.length === 0 && matches!.length === 0 && (
                    <p className="status">No places in the city's records match “{live.q}”. Try fewer words, or just the street number and name.</p>
                  )}
                  {live.status === 'idle' && matches!.length >= 3 && (
                    <button className="link-button" onClick={() => runLive(q)}>Not here? Search the city's records</button>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="panel-foot">
          Reports from the Philadelphia Department of Public Health. Each one is a snapshot of a single visit.
        </footer>
      </aside>

      <MapView points={shownOnMap} selected={selectedPoint} onSelect={select} onBoundsChange={setBounds} />
    </div>
  );
}

function inViewAll(points: IndexEntry[], bounds: L.LatLngBounds | null) {
  return bounds ? points.filter((e) => e.y !== undefined && bounds.contains([e.y, e.x!])) : points;
}

