# Philly Food Inspections

A friendlier way to look up Philadelphia restaurant health inspections: search by name or address, see the latest result as a simple icon, browse the map, and read every violation with the inspector's notes.

Data comes from the Philadelphia Department of Public Health's public inspection site, [philadelphia-pa.healthinspections.us](https://philadelphia-pa.healthinspections.us/philadelphia/). The city keeps three years of reports online.

## How the ratings work

Each inspection gets one of three icons, based on the city's own two-part checklist:

| Icon | Meaning |
| --- | --- |
| Green circle with a check | **Clean.** Nothing out of compliance. |
| Amber triangle | **Minor issues.** Only "good retail practice" items (28 and up: upkeep, cleanliness, labeling). |
| Red octagon | **Risk factors.** At least one of items 1–27, the practices linked to foodborne illness (hand washing, temperatures, contamination). |

A grey "?" appears only if a report couldn't be read.

## How it works

```
                    hourly                                  on demand
philadelphia-pa  ─────────────►  crawl-recent  ──┐   ┌──  /api/facility/:id   (loads a place we don't have yet)
.healthinspections.us            (scheduled fn)  │   │    /api/live-search    (searches the city's site directly)
        ▲                                        ▼   ▼
        │ one-time backfill            Netlify Blobs: facility/<id>, day/<date>, index
        └──── npm run backfill ──► ./data ──► npm run upload ──┘
                                                       │
                                        /api/index ────┴──► React app (map + search)
```

- **Search** is a plain GET to `search.cfm` with a date range. The site returns at most 100 results per query, so crawls go one day at a time (a busy weekday is about 70).
- **Reports** (`_report_full.cfm?inspectionID=…`) are HTML. `lib/parse.ts` reads the header counts, the 56-item IN/OUT grid (with "corrected on site" and "repeat" flags) and the inspector's observations.
- **Childcare environmental inspections** (`inspType=EE`) are skipped. They aren't food inspections and have no food report.
- **Geocoding** uses the free US Census geocoder. Philly's addresses get cleaned first ("S 07th ST" → "S 7th ST", trailing unit notes dropped), which brings matches to about 96%. Mobile vendors with no fixed address show in search and lists but not on the map.
- **The scheduled crawl** checks today and yesterday every hour, and days 2–10 back once a day, because reports are sometimes entered late. Each run stops at a time budget, and the next run picks up where it left off.
- **On-demand loading:** if someone searches for a place we haven't stored, the app searches the city's site live. Tapping a result pulls that place's full 3-year history, stores it, and adds it to the map.

## Setup

### 1. Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this repo. Build settings come from `netlify.toml`.
2. Deploy. The site works right away. It starts empty, fills hourly, and loads any place on demand.

### 2. Backfill three years (run once, locally)

The backfill makes roughly 80,000 polite requests (2 at a time, 400 ms apart), which takes about 8–10 hours. It writes to `./data` and is safe to stop and restart: finished days are skipped. A Mac that stays awake, or a Docker container on a NAS, works fine.

```bash
npm install
npm run backfill          # last 3 years, newest first (options: --from, --to, --concurrency, --interval)
npm run geocode           # batch-geocodes everything and builds data/index.json
```

Preview the local data before uploading. `npm run dev` serves `/api/*` from `./data`:

```bash
npm run dev
```

Then upload to the site's Blobs store. Get the **site ID** from Site configuration → General, and create a **personal access token** under User settings → Applications.

```bash
NETLIFY_SITE_ID=xxxx NETLIFY_AUTH_TOKEN=xxxx npm run upload
```

## Development

```bash
npm test              # parser + crawl tests (fixtures in test/fixtures)
npm run typecheck
npm run dev           # app + local data API on http://localhost:5173
npx netlify dev       # app + the real functions (needs the Netlify CLI)
```

## Project layout

```
lib/            shared crawl code: parsers, HTTP client, storage, geocoding, tiers
netlify/functions/
  index.mts         GET /api/index           compact list of every place (map + instant search)
  facility.mts      GET /api/facility/:id    one place, loaded from the city on demand
  live-search.mts   GET /api/live-search?q=  search the city's site directly
  crawl-recent.mts  hourly scheduled crawl
scripts/        backfill, geocode, upload
src/            React app (Leaflet map, search, detail view)
test/           vitest tests and trimmed real-page fixtures
```

## Known limits

- The index is one JSON blob. Two writers updating it in the same instant (the hourly crawl and an on-demand load) could drop one update; the next crawl or `npm run upload` repairs it.
- The site's header count of "risk factor violations" sometimes counts each citation, so it can run one higher than the number of grid items marked OUT. The app shows grid items.
- Every report is a snapshot of one visit, as the city notes. Problems are often fixed on the spot, and the app shows those as "Fixed during the visit".
