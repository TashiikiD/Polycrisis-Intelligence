# App Data Fallbacks

Day 10 dashboard uses API-first fetch with defensive fallback to analytics artifacts and local samples.

## Stress Ledger / WSSI Snapshot
1. `/api/v1/wssi`
2. `/wssi/current`
3. `../../../output/analytics/wssi-latest.json`
4. `data/wssi-fallback.json`

## Correlation Heatmap
1. `/api/v1/correlations`
2. `/correlations`
3. `../../../output/analytics/correlations.json`
4. `../../../../output/analytics/correlations.json`
5. `/output/analytics/correlations.json`
6. `data/correlations-fallback.json`

## WSSI Timeline History
1. `/api/v1/wssi/history?days=90`
2. `/wssi/history?days=90`
3. `../../../output/analytics/wssi-history.json`
4. `../../../../output/analytics/wssi-history.json`
5. `/output/analytics/wssi-history.json`
6. `data/wssi-history-fallback.json`

## Alerts (Timeline Annotations)
1. `/api/v1/alerts`
2. `/alerts`
3. `../../../output/analytics/alerts.json`
4. `../../../../output/analytics/alerts.json`
5. `/output/analytics/alerts.json`
6. `data/alerts-fallback.json`

Returned normalized models:
- `annotations`: timeline markers
- `records`: alert register rows/drawer

## Network Graph
1. `/api/v1/network`
2. `/network`
3. `../../../output/analytics/network.json`
4. `../../../../output/analytics/network.json`
5. `/output/analytics/network.json`
6. `data/network-fallback.json`

## Pattern Matcher
1. `/api/v1/patterns`
2. `/patterns`
3. `../../../output/analytics/patterns.json`
4. `../../../../output/analytics/patterns.json`
5. `/output/analytics/patterns.json`
6. `data/patterns-fallback.json`

## Notes
- Frontend normalizes all sources into shared models:
  - `DashboardSnapshot`
  - `CorrelationSnapshot`
  - `WssiTimelineSnapshot`
  - `NetworkSnapshot`
  - `PatternSnapshot`
  - `AlertRecord`
  - `TimelineAnnotation`
- Theme detail mini-trends use `momentum_30d` proxy by design (Day 7).
- Heatmap pair click shows pair statistics and theme stress context; true dual-theme history overlay is deferred.
- Network node placement uses source `x/y` hints when present; missing hints use deterministic ring fallback.
- Pattern radar uses diagnostic proxy axes from current payload fields and is explicitly labeled as proxy.
- App client forwards `X-API-Key` when present in local storage (`wssi_api_key` / `api_key`).
- Free tier is hard-gated in app shell to WSSI summary + Stress Ledger top 5 rows only.

## Day 11 Fragility Brief Export Dependencies

PDF export runs fully client-side in `dashboard/v2/app`:

1. Render model assembly:
   - `js/utils/report-model.js`
   - consumes last-good normalized snapshots from app orchestration state
2. Export pipeline:
   - `js/utils/report-exporter.js`
   - renders offscreen report DOM in `#fragilityBriefRenderHost`
   - converts DOM to PDF via local vendor libs:
     - `vendor/html2canvas.min.js`
     - `vendor/jspdf.umd.min.js`

## Day 11 Degradation Rules

1. If one or more datasets are stale/unavailable, export still proceeds using last-good snapshots and section stale badges.
2. If no last-good WSSI snapshot exists yet, export stays disabled.
3. If PDF vendor libs are unavailable at runtime, exporter opens print fallback using `css/report.css`.
4. Free tier export is intentionally limited and shows upgrade placeholders for full sections/appendix.

## Day 11.5 Server Archive Dependencies

Archive and publish workflows rely on API endpoints in `wssi-api`:

1. `POST /api/v1/briefs/releases/publish` (requires `X-Brief-Publish-Token`)
2. `GET /api/v1/briefs/releases?limit=50`
3. `GET /api/v1/briefs/releases/{release_id}`
4. `GET /api/v1/briefs/releases/{release_id}/view?variant=free|paid`
5. `GET /api/v1/briefs/releases/{release_id}/model?variant=free|paid`

Local storage keys used by dashboard/archive pages:

- `wssi_brief_publish_token`: enables in-app publish button
- `wssi_api_key`: used for paid-tier archive access
- `wssi_tier` (or `tier`): tier badge context
- `wssi_api_base_url` (optional): absolute API base override for hosted static deployments

## Day 11.5 Archive Degradation Rules

1. Publish control remains hidden unless `wssi_brief_publish_token` exists in local storage.
2. Archive page is still browsable without API key (free variant links only).
3. Paid links appear only when API resolves caller to paid tier.
4. Missing or invalid paid access returns upgrade-required responses from API (`402/403`).
