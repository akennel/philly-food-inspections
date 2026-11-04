import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { IndexEntry, Tier } from '../../lib/types';

const PHILLY: L.LatLngTuple = [39.9937, -75.1452];
// Drawn in this order so red sits on top of amber on top of green.
const DRAW_ORDER: Tier[] = ['unknown', 'clean', 'minor', 'risk'];

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const radiusFor = (zoom: number) => (zoom >= 16 ? 7 : zoom >= 14 ? 5.5 : zoom >= 12 ? 4 : 3);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  points: IndexEntry[];
  selected?: { id: string; lat?: number; lng?: number } | null;
  onSelect: (id: string) => void;
  onBoundsChange: (b: L.LatLngBounds) => void;
}

export function MapView({ points, selected, onSelect, onBoundsChange }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef<L.CircleMarker[]>([]);
  const highlight = useRef<L.CircleMarker | null>(null);
  const cb = useRef({ onSelect, onBoundsChange });
  cb.current = { onSelect, onBoundsChange };

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, preferCanvas: true, minZoom: 10, maxZoom: 19 }).setView(PHILLY, 12);
    L.control.zoom({ position: 'topright' }).addTo(m);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('moveend', () => cb.current.onBoundsChange(m.getBounds()));
    m.on('zoomend', () => {
      const r = radiusFor(m.getZoom());
      for (const mk of markers.current) mk.setRadius(r);
    });
    map.current = m;
    cb.current.onBoundsChange(m.getBounds());
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Redraw points when the filtered set changes.
  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    const colors: Record<Tier, string> = {
      clean: cssVar('--clean'),
      minor: cssVar('--minor'),
      risk: cssVar('--risk'),
      unknown: cssVar('--unknown'),
    };
    const r = radiusFor(m.getZoom());
    const next: L.CircleMarker[] = [];
    const sorted = points
      .filter((p) => p.y !== undefined && p.x !== undefined)
      .sort((a, b) => DRAW_ORDER.indexOf(a.t) - DRAW_ORDER.indexOf(b.t));
    for (const p of sorted) {
      const mk = L.circleMarker([p.y!, p.x!], {
        radius: r,
        color: '#fff',
        weight: 1,
        fillColor: colors[p.t],
        fillOpacity: 0.92,
      });
      mk.on('click', () => cb.current.onSelect(p.i));
      mk.on('mouseover', () => mk.bindTooltip(p.n, { direction: 'top', offset: [0, -4] }).openTooltip());
      mk.addTo(lg);
      next.push(mk);
    }
    markers.current = next;
  }, [points]);

  // Highlight + pan to the selected place.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    highlight.current?.remove();
    highlight.current = null;
    if (!selected || selected.lat === undefined || selected.lng === undefined) return;
    const ll: L.LatLngTuple = [selected.lat, selected.lng];
    highlight.current = L.circleMarker(ll, {
      radius: 13,
      color: cssVar('--gold'),
      weight: 4,
      fill: false,
      interactive: false,
    }).addTo(m);
    const zoom = Math.max(m.getZoom(), 16);
    if (!m.getBounds().pad(-0.2).contains(ll) || m.getZoom() < 15) {
      if (reducedMotion()) m.setView(ll, zoom);
      else m.flyTo(ll, zoom, { duration: 0.8 });
    }
  }, [selected?.id, selected?.lat, selected?.lng]);

  return <div ref={el} className="map" role="region" aria-label="Map of inspected places" />;
}
