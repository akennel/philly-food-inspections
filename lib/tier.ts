import type { Facility, GridItem, IndexEntry, Inspection, Tier } from './types';

/**
 * clean   – nothing marked OUT
 * minor   – only good-retail-practice items (28+) OUT
 * risk    – at least one foodborne-illness risk factor (1–27) OUT
 * unknown – no compliance grid could be read
 */
export function tierFor(violations: GridItem[], gridItemsSeen: number, headerRiskCount = 0): Tier {
  if (violations.some((v) => v.risk) || headerRiskCount > 0) return 'risk';
  if (violations.length > 0) return 'minor';
  return gridItemsSeen > 0 ? 'clean' : 'unknown';
}

export const isRiskItem = (n: string) => {
  const num = parseInt(n, 10);
  return Number.isFinite(num) && num >= 1 && num <= 27 && !n.includes('+');
};

export function toIndexEntry(f: Facility): IndexEntry | null {
  const last: Inspection | undefined = f.inspections[0];
  if (!last) return null;
  return {
    i: f.id,
    n: f.name,
    a: f.street,
    z: f.zip,
    y: f.lat,
    x: f.lng,
    d: last.date,
    t: last.tier,
    r: last.violations.filter((v) => v.risk).length,
    g: last.violations.filter((v) => !v.risk).length,
    e: f.estType,
  };
}

export const TIER_LABEL: Record<Tier, string> = {
  clean: 'No violations',
  minor: 'Minor issues',
  risk: 'Risk-factor violations',
  unknown: 'Not rated',
};
