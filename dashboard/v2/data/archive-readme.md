# 5-Year Event Archive

**REAL EVENTS ONLY** — No synthetic data. All events sourced from verified providers.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Pages (Static)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Dashboard  │  │  sql.js     │  │  Compressed Chunks  │ │
│  │  (JS/HTML)  │──│  (SQLite)   │──│  (.json.gz)         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                    │             │
│         └────────────────┴────────────────────┘             │
│                          │                                  │
│                   IndexedDB (Persistence)                   │
└─────────────────────────────────────────────────────────────┘
```

## Data Sources (All Real)

### Historical Archive (5-Year Backfill)

| Source | Type | Retention | Status | Rate Limit |
|--------|------|-----------|--------|------------|
| **USGS** | Seismic | 1 year | ✅ Implemented | 1 req/sec |
| **GDACS** | Disasters | 2 years | ✅ Implemented | 1 req/2sec |
| **OFAC** | Sanctions | 5 years | 🔄 Ready | 1/day |
| **UCDP** | Conflict | 5 years | ⏳ Pending API | TBD |
| **ACLED** | Conflict | 5 years | ⏳ Needs API key | TBD |

### Live Feeds (Auto-Updated)

| Source | Type | Frequency | Status | Rate Limit | Cron |
|--------|------|-----------|--------|------------|------|
| **EONET** | Natural Events | Hourly | ✅ Implemented | 1 req/5sec | `0 * * * *` |
| **USGS** | Seismic | Hourly | ✅ Implemented | 1 req/sec | `15 * * * *` |
| **CISA** | Cyber Advisories | Daily | ✅ Implemented | 1 req/5min | `30 6 * * *` |
| **GDACS** | Disaster Alerts | Daily | ✅ Implemented | 1 req/30sec | `0 7 * * *` |

### Implemented Fetchers

**USGS Earthquakes**
- Source: USGS Earthquake Hazards Program
- Filter: Magnitude ≥ 4.5 (significant events), ≥ 2.5 (live feed)
- Fields: magnitude, depth, location, time, tsunami alert
- Severity: critical (≥7), high (≥6), medium (≥5), low

**GDACS Disasters**
- Source: Global Disaster Alert and Coordination System
- Types: floods, storms, earthquakes, wildfires, droughts, tsunamis
- Severity: color-coded (red=critical, orange=high, yellow=medium, green=low)

**NASA EONET** (Live Feed)
- Source: NASA Earth Observatory Natural Event Tracker
- Types: wildfires, severe storms, floods, earthquakes, volcanoes, droughts
- Coverage: Global, near real-time
- Fields: event categories, geometry (coordinates over time), magnitude when available
- Severity: Based on magnitude (acres for fires, wind speed for storms) + category defaults

**CISA Cyber Advisories** (Live Feed)
- Source: Cybersecurity & Infrastructure Security Agency
- Focus: ICS/OT security advisories, Known Exploited Vulnerabilities (KEV)
- Types: ICS advisories, medical advisories, KEV catalog updates
- Severity: critical (KEV), high (RCE), medium (standard advisories)

## Components

| File | Purpose |
|------|---------|
| `archive-schema.sql` | SQLite schema for events, aggregations, chunks |
| `event-archive.js` | Main archive manager class |
| `historical-fetcher.js` | **Historical data fetcher** (5-year backfill) |
| `live-feed.js` | **Live feed fetcher** (hourly/daily updates) |
| `chunks/*.json.gz` | Compressed monthly historical data |
| `live/*.json.gz` | Compressed daily live feed data |

## Fetching Real Events

### Historical Archive (5-Year Backfill)

Use `historical-fetcher.js` for one-time large backfills:

```bash
cd dashboard/v2/scripts

# Fetch 1 year of USGS earthquakes
node historical-fetcher.js

# Or programmatically:
const { HistoricalFetcher } = require('./historical-fetcher');

const fetcher = new HistoricalFetcher({
    sources: ['usgs', 'gdacs'],
    startDate: '2025-01-01',
    endDate: '2026-02-13',
    outputDir: './chunks/'
});

await fetcher.fetchAll();
await fetcher.exportChunks();
```

### Live Feeds (Auto-Updated)

Use `live-feed.js` for frequent incremental updates:

```bash
cd dashboard/v2/scripts

# Fetch recent EONET events (last 7 days)
node live-feed.js --source eonet --days-back 7

# Fetch all live sources
node live-feed.js --source all --output-dir ../data/live/

# Or programmatically:
const { LiveFeedFetcher } = require('./live-feed');

const fetcher = new LiveFeedFetcher({
    sources: ['eonet', 'usgs', 'cisa', 'gdacs'],
    daysBack: 7,
    outputDir: '../data/live/'
});

await fetcher.fetchAll();
await fetcher.exportChunks();
```

**Automated Updates (Cron):**

| Job | Schedule | Description |
|-----|----------|-------------|
| EONET | Hourly (`0 * * * *`) | Natural events (wildfires, storms, floods) |
| USGS | Hourly (`15 * * * *`) | Recent earthquakes (mag 2.5+) |
| CISA | Daily 6:30 AM | Cyber advisories (ICS/OT focus) |
| GDACS | Daily 7:00 AM | Disaster alerts |

**Output Structure:**
```
data/
├── chunks/           # Monthly historical chunks
│   ├── events-2026-01.json.gz
│   └── events-2026-02.json.gz
└── live/             # Daily live feed chunks
    ├── live-2026-02-12.json.gz
    └── live-2026-02-13.json.gz
```

### Rate Limits (Built-in)

| Source | Limit | Rationale |
|--------|-------|-----------|
| USGS | 1 req/sec | Polite usage (API allows ~10/sec) |
| GDACS | 1 req/2sec | Respect public RSS feed |
| OFAC | 1/day | CSV download, rarely changes |
| **EONET** | **1 req/5sec** | NASA public API courtesy |
| **CISA** | **1 req/5min** | RSS feed, daily updates sufficient |

## Event Schema (Real Data)

Every event includes:

```javascript
{
  id: "usgs-usb000abcd",
  source: "usgs",                    // Origin system
  source_id: "usb000abcd",           // Original ID
  source_url: "https://earthquake.usgs.gov/...",
  fetched_at: "2026-02-13T09:45:00Z", // When we retrieved it
  
  event_type: "earthquake",          // normalized type
  title: "M 5.6 - 10km N of...",
  description: "Magnitude 5.6 earthquake at...",
  
  date: "2026-02-13",
  timestamp: 1739442300000,
  
  latitude: 34.0522,
  longitude: -118.2437,
  
  severity: "high",                  // critical|high|medium|low
  
  source_metadata: {                 // Provider-specific
    magType: "mb",
    sig: 560,
    tsunami: 0,
    alert: null
  }
}
```

## Tiered Access

| Tier | History | Features |
|------|---------|----------|
| **Free** | 30 days | Basic timeline, current events |
| **Premium** | 5 years | Full timeline, exports, API access |
| **Enterprise** | 10 years | All features + custom integrations |

## Chunk Format

Monthly compressed JSON:

```json
{
  "chunk_id": "2026-02",
  "year": 2026,
  "month": 2,
  "generated_at": "2026-02-13T09:45:00Z",
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "event_count": 1847,
  "source_breakdown": {
    "usgs": 612,
    "gdacs": 89,
    "ofac": 1146
  },
  "events": [...]
}
```

## Policy: No Synthetic Data

⚠️ **NEVER** generate fake events. Reasons:
1. Risk of conflation with real events
2. Misleading users if not clearly labeled  
3. Undermines trust in platform
4. Real data available from sources above

**Audit Requirements:**
- `source` — Must be valid provider
- `source_id` — Original ID from provider
- `source_url` — Link to original record
- `fetched_at` — Timestamp of retrieval

## Database Schema

**events** — Core event data
- `event_id`, `source`, `source_type`
- `source_id` — Original ID from data provider
- `source_url` — Link to original record
- `fetched_at` — When we retrieved it
- `event_date`, `event_timestamp`
- `latitude`, `longitude`, `country_code`
- `severity`, `status`, `wssi_theme_id`
- `source_metadata` (JSON)

**daily_stats** — Pre-aggregated counts
- Date-based rollups for fast timeline rendering
- Source breakdowns (usgs, gdacs, ofac, ucdp, cisa)
- Severity counts and WSSI correlations

**archive_chunks** — Chunk metadata
- Loading status, checksums, compression info
- Source breakdown per chunk

## Paywall Integration

```javascript
try {
    await archive.loadChunk(2021, 6); // June 2021
} catch (e) {
    if (e.message === 'PAYWALL_REQUIRED') {
        showPaywallModal();
    }
}
```

## Performance

- **Chunk size**: ~50-200KB compressed per month
- **Load time**: ~100ms per chunk (async)
- **Query time**: ~10ms for 1000 events
- **Memory**: ~5MB for 1 year of data

## Adding New Sources

1. Add to `HISTORICAL_SOURCES` config
2. Implement `fetchSourceName()` method
3. Add parser with source attribution
4. Set appropriate rate limits
5. Test with small date range first

## Data Integrity

- SHA-256 checksums per chunk (planned)
- Source attribution on every event
- Fetched timestamps for audit trail
- Original source URLs for verification
