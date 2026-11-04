/** Status icon tier. `unknown` is a fallback for reports we couldn't read a grid from. */
export type Tier = 'clean' | 'minor' | 'risk' | 'unknown';

export type ItemStatus = 'IN' | 'OUT' | 'N/O' | 'N/A';

/** One line of the report's compliance grid. We only store OUT items. */
export interface GridItem {
  /** Item number as printed, e.g. "13" or "56+" */
  n: string;
  status: ItemStatus;
  desc: string;
  /** Corrected on site */
  cos: boolean;
  /** Repeat violation */
  repeat: boolean;
  /** Items 1–27 are foodborne-illness risk factors; 28+ are good retail practices */
  risk: boolean;
}

export interface Observation {
  /** Item number the observation refers to */
  n: string;
  /** Code citation, e.g. "46.281" */
  code?: string;
  text: string;
}

export interface Inspection {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  purpose?: string;
  type?: string;
  timeIn?: string;
  timeOut?: string;
  riskCount: number;
  repeatRiskCount: number;
  corrections: number;
  /** OUT items only */
  violations: GridItem[];
  observations: Observation[];
  tier: Tier;
}

export interface Facility {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  estType?: string;
  lat?: number;
  lng?: number;
  /** 'match' | 'nomatch' once we've tried */
  geocode?: 'match' | 'nomatch';
  /** Newest first */
  inspections: Inspection[];
  updatedAt: string;
}

/** Compact per-facility row served to the browser for the map + local search. */
export interface IndexEntry {
  i: string; // facility id
  n: string; // name
  a: string; // street
  z: string; // zip
  y?: number; // lat
  x?: number; // lng
  d: string; // last inspection date YYYY-MM-DD
  t: Tier; // last inspection tier
  r: number; // risk-factor OUT count (last inspection)
  g: number; // good-retail OUT count (last inspection)
  e?: string; // establishment type
}

/** A row from Philly's search results page. */
export interface SearchResult {
  facilityId: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lastDate?: string;
  inspectionId?: string;
  /** "Food" for food inspections; other types (e.g. "EE" childcare environmental) have no food report */
  inspType?: string;
}

export const reportUrl = (inspectionId: string) =>
  `https://philadelphia-pa.healthinspections.us/_templates/551/RetailFood/_report_full.cfm?inspectionID=${inspectionId}&domainID=551&userID=0`;
