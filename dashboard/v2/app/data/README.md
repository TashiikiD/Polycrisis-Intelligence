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
