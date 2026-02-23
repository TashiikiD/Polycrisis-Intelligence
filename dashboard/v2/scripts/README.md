# Dashboard V2 Smoke Scripts

## Day 6 Smoke Check

Script: `day6-smoke-check.js`

What it validates:
1. Brief-only landing behavior
2. Pulse hard-gate redirect
3. API-first load path
4. Legacy fallback path
5. Analytics artifact fallback path
6. Stress Ledger sorting
7. Row expansion details
8. 60s auto-refresh + stale badge on failure
9. Mobile 360px collapse behavior
10. No runtime console errors on app load
11. Reachability of `login/signup/pricing`

## Day 7 Smoke Check

Script: `day7-smoke-check.js`

What it validates:
1. Correlation heatmap API route and fallback chain
2. Timeline API route and fallback chain
3. Alert annotations on timeline
4. Heatmap hover metrics and strong-pair labeling
5. Pair drawer graceful-degrade note
6. Theme detail selection + momentum proxy rendering
7. Timeline zoom/pan/reset interactions
8. 60s refresh + stale behavior
9. Mobile usability
10. Day 6 smoke regression pass
11. Reachability of `login/signup/pricing`

## Day 8 Smoke Check

Script: `day8-smoke-check.js`

What it validates:
1. Network graph API route and fallback chain
2. Network interaction and category toggles
3. Alert register load + filters + drawer behavior
4. Alert-to-timeline focus sync and theme-context sync
5. Stale states and 60s refresh interval
6. Mobile usability for network + alerts
7. Day 7 and Day 6 regression smoke pass
8. Reachability of `login/signup/pricing`

## Day 9 Smoke Check

Script: `day9-smoke-check.js`

What it validates:
1. Hash-routed tab navigation and default/fallback tab behavior
2. Pattern matcher API route and fallback chain
3. Pattern top-3 ranking and diagnostic proxy radar rendering
4. Pattern disclaimer visibility and diagnostics metadata
5. Cross-component sync still works from alerts/network/ledger
6. 60s refresh and stale behavior
7. Mobile usability for tabbed shell + side rail stacking
8. Day 8/7/6 regression smoke pass
9. Reachability of `login/signup/pricing`

## Day 10 Smoke Check

Script: `day10-smoke-check.js`

What it validates:
1. Signup issues API key and redirects into app shell
2. Free-tier paywall gating (ledger-only + 5-row cap + side rail lock)
3. Hash-route normalization under free-tier gating
4. Password login issues API key and unlocks paid shell
5. Pricing basic upgrade starts checkout session
6. Enterprise remains contact-sales-only
7. Stripe-not-configured fallback messaging
8. App stale behavior remains intact
9. 60s refresh cadence remains active
10. No JS runtime/console regressions during Day 10 flows
11. Day 9 smoke regression pass
12. Reachability of `login/signup/pricing`

## Day 11 Smoke Check

Script: `day11-smoke-check.js`

What it validates:
1. Header export CTA is present and keyboard accessible
2. Free-tier export is limited (top-5 + placeholders)
3. Paid-tier export includes full sections + indicator appendix
4. WSSI summary in report matches on-screen values
5. Alerts/correlations/network/pattern highlights populate from Day 9/10 datasets
6. Stale section badges appear when one dataset fails and export still proceeds
7. PDF-library failure path triggers print fallback cleanly
8. No runtime regressions during export interactions
9. Day 10 smoke regression pass (which chains Day 9/8/7/6)
10. Reachability of `login/signup/pricing/archive`

## Day 12 Archive Smoke Check

Script: `day12-archive-smoke-check.js`

What it validates:
1. In-app publish control stays hidden without local publish token
2. In-app publish control appears when local publish token is set
3. Publish flow performs readiness precheck and posts release with health metadata
4. Archive page loads newest-first release list with free-tier lock behavior
5. Release health pills (healthy/degraded) render with missing/stale context
6. Paid-tier archive browse exposes paid variant links
7. Readiness endpoint reports non-blocking vs blocking state
8. Paid variant endpoint enforces access control for unauth/free callers
9. No runtime console/page regressions during publish + archive flows
10. App and archive route reachability

## Day 11.5 Operations Sequence

Canonical run order for reliable server archive publish:

1. Push analytics bundle:
   - `python ..\\..\\..\\wssi-api\\scripts\\push_analytics_bundle.py --base-url https://polycrisis-intelligence-production.up.railway.app --input-dir e:/clawd/output/analytics`
2. Check readiness:
   - `python ..\\..\\..\\wssi-api\\scripts\\check_brief_archive_readiness.py --base-url https://polycrisis-intelligence-production.up.railway.app`
3. Publish release:
   - `python ..\\..\\..\\wssi-api\\scripts\\publish_fragility_brief_release.py --base-url https://polycrisis-intelligence-production.up.railway.app --created-by script`
4. Validate archive UI:
   - open `dashboard/v2/archive/index.html` and confirm newest release is first with expected health badge.

## Usage

From `polycrisis-intelligence/dashboard/v2/scripts`:

```powershell
npm install
npm run smoke:day6
npm run smoke:day7
npm run smoke:day8
npm run smoke:day9
npm run smoke:day10
npm run smoke:day11
npm run smoke:day12-archive
```

Optional port overrides:

```powershell
$env:DAY6_SMOKE_PORT=3200
$env:DAY7_SMOKE_PORT=3300
$env:DAY8_SMOKE_PORT=3500
$env:DAY9_SMOKE_PORT=3600
$env:DAY10_SMOKE_PORT=4100
$env:DAY11_SMOKE_PORT=5200
$env:DAY12_ARCHIVE_SMOKE_PORT=5300
npm run smoke:day6
npm run smoke:day7
npm run smoke:day8
npm run smoke:day9
npm run smoke:day10
npm run smoke:day11
npm run smoke:day12-archive
```

Expected output:
- `DAY6_SMOKE_RESULTS_START ... DAY6_SMOKE_RESULTS_END`
- `DAY7_SMOKE_RESULTS_START ... DAY7_SMOKE_RESULTS_END`
- `DAY8_SMOKE_RESULTS_START ... DAY8_SMOKE_RESULTS_END`
- `DAY9_SMOKE_RESULTS_START ... DAY9_SMOKE_RESULTS_END`
- `DAY10_SMOKE_RESULTS_START ... DAY10_SMOKE_RESULTS_END`
- `DAY11_SMOKE_RESULTS_START ... DAY11_SMOKE_RESULTS_END`
- `DAY12_ARCHIVE_SMOKE_RESULTS_START ... DAY12_ARCHIVE_SMOKE_RESULTS_END`
- summary lines with `failed=0`
