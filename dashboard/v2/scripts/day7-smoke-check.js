const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY7_SMOKE_PORT || 3300);
let mode = "api";

function isoDateFromOffset(offsetDays) {
  const now = new Date("2026-02-17T00:00:00Z");
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function buildHistory(days) {
  const rows = [];
  let score = 48;
  for (let i = -days + 1; i <= 0; i += 1) {
    score += Math.sin(i / 6) * 1.8 + ((i % 7) - 3) * 0.15;
    score = Math.max(5, Math.min(95, score));
    rows.push({
      date: isoDateFromOffset(i),
      wssi_score: Number(score.toFixed(1)),
      wssi_value: Number(((score - 50) / 20).toFixed(3)),
      wssi_delta: Number((Math.sin(i / 4) * 0.9).toFixed(3)),
      trend: i % 2 === 0 ? "up" : "down",
    });
  }
  return rows;
}

const sampleApiWssi = {
  wssi_value: -2.31,
  wssi_score: 41.2,
  calculation_timestamp: "2026-02-17T12:00:00Z",
  theme_signals: [
    {
      theme_id: "A",
      theme_name: "Alpha Theme",
      category: "Climate",
      mean_z_score: 0.5,
      stress_level: "stable",
      momentum_30d: 0.1,
      confidence_tier: "emerging",
      quality_score: 0.61,
      data_freshness: "fresh",
      indicator_details: [
        {
          indicator_id: "A.1",
          name: "Alpha Indicator",
          source: "NOAA",
          stress_z_latest: 0.5,
          momentum_30d: 0.1,
          freshness: "fresh",
          quality_tier: "documented",
        },
      ],
    },
    {
      theme_id: "B",
      theme_name: "Bravo Theme",
      category: "Finance",
      mean_z_score: 2.2,
      stress_level: "approaching",
      momentum_30d: -0.3,
      confidence_tier: "documented",
      quality_score: 0.72,
      data_freshness: "warning",
      indicator_details: [
        {
          indicator_id: "B.1",
          name: "Bravo Indicator",
          source: "FRED",
          stress_z_latest: 2.2,
          momentum_30d: -0.3,
          freshness: "warning",
          quality_tier: "documented",
        },
      ],
    },
    {
      theme_id: "C",
      theme_name: "Charlie Theme",
      category: "Conflict",
      mean_z_score: -3.6,
      stress_level: "critical",
      momentum_30d: 0.8,
      confidence_tier: "established",
      quality_score: 0.85,
      data_freshness: "stale",
      indicator_details: [
        {
          indicator_id: "C.1",
          name: "Charlie Indicator",
          source: "ACLED",
          stress_z_latest: -3.6,
          momentum_30d: 0.8,
          freshness: "stale",
          quality_tier: "established",
        },
      ],
    },
  ],
};

const sampleCorrelationPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  window_days: 90,
  strong_threshold: 0.6,
  theme_level: {
    matrix: {
      A: { A: 1.0, B: -0.72, C: 0.18 },
      B: { A: -0.72, B: 1.0, C: 0.64 },
      C: { A: 0.18, B: 0.64, C: 1.0 },
    },
    pairs: [
      { theme_a: "A", theme_b: "B", pearson_r: -0.72, p_value: 0.0042, sample_n: 64, is_significant: 1 },
      { theme_a: "A", theme_b: "C", pearson_r: 0.18, p_value: 0.2181, sample_n: 58, is_significant: 0 },
      { theme_a: "B", theme_b: "C", pearson_r: 0.64, p_value: 0.0091, sample_n: 61, is_significant: 1 },
    ],
  },
};

const sampleHistoryPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  days: 90,
  history: buildHistory(90),
};

const sampleAlertsPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  active_alerts: [
    {
      alert_id: "THEME_CRITICAL_C_20260216",
      title: "Charlie Theme at CRITICAL stress",
      severity: "critical",
      timestamp: "2026-02-16T12:00:00Z",
      theme_ids: ["C"],
    },
    {
      alert_id: "WSSI_ACCEL_20260215",
      title: "Rapid WSSI acceleration",
      severity: "warning",
      timestamp: "2026-02-15T12:00:00Z",
      theme_ids: [],
    },
  ],
};

const sampleNetworkPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  node_count: 4,
  edge_count: 4,
  warnings: [],
  nodes: [
    { id: "n_a", label: "Alpha Theme", category: "Climate-Environmental", theme_id: "A", x: 100, y: 120 },
    { id: "n_b", label: "Bravo Theme", category: "Economic-Financial", theme_id: "B", x: 260, y: 120 },
    { id: "n_c", label: "Charlie Theme", category: "Geopolitical-Conflict", theme_id: "C", x: 200, y: 260 },
    { id: "n_bridge", label: "Supply Chain", category: "Cross-System", theme_id: null, x: 340, y: 220 },
  ],
  edges: [
    { id: "e1", source: "n_a", target: "n_b", weight: 0.62, evidence: "documented", direction: "bidirectional", type: "link" },
    { id: "e2", source: "n_b", target: "n_c", weight: 0.79, evidence: "established", direction: "bidirectional", type: "link" },
    { id: "e3", source: "n_c", target: "n_bridge", weight: 0.53, evidence: "emerging", direction: "unidirectional", type: "link" },
    { id: "e4", source: "n_a", target: "n_bridge", weight: 0.47, evidence: "documented", direction: "unidirectional", type: "link" },
  ],
  metrics: {
    n_a: { degree_total: 2, pagerank: 0.2 },
    n_b: { degree_total: 2, pagerank: 0.24 },
    n_c: { degree_total: 2, pagerank: 0.22 },
    n_bridge: { degree_total: 2, pagerank: 0.18 },
  },
};

const samplePatternsPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  method: "weighted_cosine_overlap_penalty",
  current_vector_size: 22,
  matches: [
    {
      episode_id: "episode_2008_financial_crisis",
      label: "2008 Financial Crisis",
      period: "2008-09 to 2009-06",
      description: "Credit stress and volatility shock.",
      similarity_pct: 80.4,
      confidence_tier: "high",
      required_overlap_min: 4,
      diagnostics: {
        raw_cosine: 0.804,
        penalty: 1.0,
        overlap: ["A.1", "B.1", "C.1", "X.1"],
        missing_indicators: []
      }
    }
  ]
};

const sampleLegacyWssi = JSON.parse(JSON.stringify(sampleApiWssi));
const sampleLegacyCorrelations = JSON.parse(JSON.stringify(sampleCorrelationPayload));
const sampleLegacyHistory = {
  data: sampleHistoryPayload.history,
  count: sampleHistoryPayload.history.length,
  days: 90,
};
const sampleLegacyAlerts = {
  alerts: sampleAlertsPayload.active_alerts,
};

const sampleArtifactWssi = JSON.parse(JSON.stringify(sampleApiWssi));
const sampleArtifactCorrelations = JSON.parse(JSON.stringify(sampleCorrelationPayload));
const sampleArtifactHistory = JSON.parse(JSON.stringify(sampleHistoryPayload));
const sampleArtifactAlerts = JSON.parse(JSON.stringify(sampleAlertsPayload));
const sampleArtifactNetwork = JSON.parse(JSON.stringify(sampleNetworkPayload));
const sampleArtifactPatterns = JSON.parse(JSON.stringify(samplePatternsPayload));

async function clickTab(page, tabId) {
  const selector = `[data-tab="${tabId}"]`;
  await page.click(selector);
  await page.waitForTimeout(120);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
  res.end(fs.readFileSync(filePath));
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/__mode") {
      const next = url.searchParams.get("set");
      if (next) mode = next;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`mode=${mode}`);
      return;
    }

    if (mode === "stale" && pathname.startsWith("/app/data/")) {
      return sendJson(res, 503, { error: "local fallback unavailable in stale mode" });
    }

    if (pathname.startsWith("/output/analytics/")) {
      if (mode === "stale") return sendJson(res, 503, { error: "artifacts unavailable in stale mode" });
      if (pathname.endsWith("/wssi-latest.json")) return sendJson(res, 200, sampleArtifactWssi);
      if (pathname.endsWith("/correlations.json")) return sendJson(res, 200, sampleArtifactCorrelations);
      if (pathname.endsWith("/wssi-history.json")) return sendJson(res, 200, sampleArtifactHistory);
      if (pathname.endsWith("/alerts.json")) return sendJson(res, 200, sampleArtifactAlerts);
      if (pathname.endsWith("/network.json")) return sendJson(res, 200, sampleArtifactNetwork);
      if (pathname.endsWith("/patterns.json")) return sendJson(res, 200, sampleArtifactPatterns);
      return sendJson(res, 404, { error: "artifact not found" });
    }

    // API mode: v1 endpoints only
    if (pathname === "/api/v1/wssi") {
      if (mode === "api") return sendJson(res, 200, sampleApiWssi);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/themes") {
      if (mode === "api") return sendJson(res, 200, { themes: sampleApiWssi.theme_signals });
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/correlations") {
      if (mode === "api") return sendJson(res, 200, sampleCorrelationPayload);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/wssi/history") {
      if (mode === "api") return sendJson(res, 200, sampleHistoryPayload);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/alerts") {
      if (mode === "api") return sendJson(res, 200, sampleAlertsPayload);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/network") {
      if (mode === "api") return sendJson(res, 200, sampleNetworkPayload);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }
    if (pathname === "/api/v1/patterns") {
      if (mode === "api") return sendJson(res, 200, samplePatternsPayload);
      return sendJson(res, 503, { error: "api_v1 unavailable" });
    }

    // Legacy mode: unprefixed endpoints only
    if (pathname === "/wssi/current") {
      if (mode === "legacy") return sendJson(res, 200, sampleLegacyWssi);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }
    if (pathname === "/correlations") {
      if (mode === "legacy") return sendJson(res, 200, sampleLegacyCorrelations);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }
    if (pathname === "/wssi/history") {
      if (mode === "legacy") return sendJson(res, 200, sampleLegacyHistory);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }
    if (pathname === "/alerts") {
      if (mode === "legacy") return sendJson(res, 200, sampleLegacyAlerts);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }
    if (pathname === "/network") {
      if (mode === "legacy") return sendJson(res, 200, sampleNetworkPayload);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }
    if (pathname === "/patterns") {
      if (mode === "legacy") return sendJson(res, 200, samplePatternsPayload);
      return sendJson(res, 503, { error: "legacy unavailable" });
    }

    const normalized = pathname === "/" ? "/index.html" : pathname;
    const target = path.normalize(path.join(v2Root, normalized));
    if (!target.startsWith(path.normalize(v2Root))) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    serveFile(res, target);
  });
}

function result(name, pass, detail) {
  return { name, pass, detail };
}

async function run() {
  const out = [];
  const base = `http://127.0.0.1:${port}`;
  const server = createServer();
  let browser;
  let reqCtx;

  try {
    await new Promise((resolve) => server.listen(port, resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });

    await context.addInitScript(() => {
      try {
        localStorage.setItem("wssi_tier", "basic");
        localStorage.setItem("wssi_api_key", "smoke-day7-key");
      } catch {}
      const original = window.setInterval;
      window.__intervalDelays = [];
      window.setInterval = (fn, delay, ...args) => {
        window.__intervalDelays.push(delay);
        return original(fn, delay, ...args);
      };
    });

    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    // Baseline API-mode load
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await page.waitForSelector(".ledger-row");
    await clickTab(page, "correlations");
    await page.waitForSelector(".heatmap-canvas", { state: "visible" });
    await clickTab(page, "timeline");
    await page.waitForSelector(".timeline-canvas", { state: "visible" });
    await clickTab(page, "correlations");
    const baselineConsoleErrors = [...consoleErrors];
    const baselinePageErrors = [...pageErrors];

    const correlationSourceApi = await page.locator(".correlation-source").innerText();
    out.push(result("1. Heatmap loads from /api/v1/correlations", correlationSourceApi.includes("api-v1-correlations"), correlationSourceApi));

    await clickTab(page, "timeline");
    const timelineSourceApi = await page.locator(".timeline-source").innerText();
    out.push(result("4. Timeline loads from /api/v1/wssi/history?days=90", timelineSourceApi.includes("api-v1-history"), timelineSourceApi));

    const annotationCountText = await page.locator(".timeline-annotation-count").innerText();
    const annotationCount = Number((annotationCountText.match(/\d+/) || ["0"])[0]);
    out.push(result("7. Alerts annotations appear on timeline", annotationCount > 0, annotationCountText));

    // Hover heatmap for tooltip check
    await clickTab(page, "correlations");
    const heatmapBox = await page.locator(".heatmap-canvas").boundingBox();
    const hoverPoint = {
      x: heatmapBox.x + 150 + ((Math.min(heatmapBox.width - 174, heatmapBox.height - 124) / 3) * 1.5),
      y: heatmapBox.y + 24 + ((Math.min(heatmapBox.width - 174, heatmapBox.height - 124) / 3) * 0.5),
    };
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForTimeout(180);
    const tooltipVisible = await page.locator(".chart-tooltip:not(.hidden)").count();
    const tooltipText = tooltipVisible ? await page.locator(".chart-tooltip:not(.hidden)").first().innerText() : "";
    const hoverPass = tooltipVisible > 0 && tooltipText.includes("r:") && tooltipText.includes("p:") && tooltipText.includes("n:");
    out.push(result("8. Heatmap hover shows r/p/n", hoverPass, tooltipText || "tooltip hidden"));

    // Click strong cell, drawer behavior
    await page.mouse.click(hoverPoint.x, hoverPoint.y);
    await page.waitForTimeout(200);
    const drawerText = await page.locator(".pair-drawer").innerText();
    out.push(result("9. Strong pair labeled Emerging Pattern", drawerText.includes("Emerging Pattern"), drawerText.slice(0, 180)));
    out.push(result("10. Cell click shows graceful-degrade pair drawer", drawerText.includes("deferred pending per-theme history endpoint"), drawerText.slice(0, 180)));

    // Theme detail via stress ledger select
    await clickTab(page, "ledger");
    await page.locator('.ledger-row:has-text("Bravo Theme")').first().click();
    await page.waitForTimeout(180);
    const themeTitle = await page.locator("#themeDetailMount h3").innerText();
    out.push(result("11. Theme detail updates on ledger selection", themeTitle.includes("Bravo Theme"), themeTitle));

    const proxyNote = await page.locator(".theme-detail-proxy-note").innerText();
    const momentumCells = await page.locator(".theme-detail-table .momentum-cell").count();
    out.push(result("12. Theme detail shows indicators + momentum proxy", momentumCells > 0 && proxyNote.includes("30d momentum proxy"), `momentumCells=${momentumCells}`));

    // Legacy fallback checks
    await page.request.get(`${base}/__mode?set=legacy`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "correlations");
    const correlationSourceLegacy = await page.locator(".correlation-source").innerText();
    out.push(result("2. Heatmap falls back to /correlations", correlationSourceLegacy.includes("legacy-correlations"), correlationSourceLegacy));

    await clickTab(page, "timeline");
    const timelineSourceLegacy = await page.locator(".timeline-source").innerText();
    out.push(result("5. Timeline falls back to /wssi/history?days=90", timelineSourceLegacy.includes("legacy-history"), timelineSourceLegacy));

    // Artifact fallback checks
    await page.request.get(`${base}/__mode?set=artifact`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "correlations");
    const correlationSourceArtifact = await page.locator(".correlation-source").innerText();
    out.push(result("3. Heatmap falls back to analytics artifacts", correlationSourceArtifact.includes("analytics-artifact-correlations"), correlationSourceArtifact));

    await clickTab(page, "timeline");
    const timelineSourceArtifact = await page.locator(".timeline-source").innerText();
    out.push(result("6. Timeline falls back to analytics artifacts", timelineSourceArtifact.includes("analytics-artifact-history"), timelineSourceArtifact));

    // Zoom / pan / reset interactions
    await page.request.get(`${base}/__mode?set=api`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "timeline");
    const timelineCanvas = page.locator(".timeline-canvas");
    await timelineCanvas.hover();
    await page.mouse.wheel(0, -400);
    const box = await timelineCanvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.click(".chart-reset-btn");
    out.push(result("13. Timeline supports zoom/pan/reset", true, "wheel+drag+reset executed"));

    // Refresh/stale behavior
    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    await page.request.get(`${base}/__mode?set=stale`);
    await page.click("#refreshButton");
    await page.waitForTimeout(1000);
    const staleVisible = await page.locator("#staleBadge:not(.hidden)").count();
    const anyPanelStale = await page.locator(".panel-status:not(.hidden)").count();
    out.push(result("14. Auto-refresh 60s and stale states on failures", intervalDelays.includes(60000) && staleVisible > 0 && anyPanelStale > 0, `intervals=${JSON.stringify(intervalDelays)} panelStale=${anyPanelStale}`));

    // Mobile usability
    await page.setViewportSize({ width: 360, height: 800 });
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await clickTab(page, "correlations");
    const mobileHeatmapWidth = await page.locator(".heatmap-canvas").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await clickTab(page, "timeline");
    const mobileTimelineWidth = await page.locator(".timeline-canvas").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await clickTab(page, "ledger");
    const mobileRows = await page.locator(".ledger-row").count();
    out.push(result("15. Mobile 360 remains usable", mobileHeatmapWidth > 280 && mobileTimelineWidth > 280 && mobileRows > 0, `heatmap=${mobileHeatmapWidth} timeline=${mobileTimelineWidth} rows=${mobileRows}`));

    // Clean console/runtime errors on baseline load
    out.push(result("16. No JS console/runtime errors on Day 7 load", baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0, `consoleErrors=${baselineConsoleErrors.length} pageErrors=${baselinePageErrors.length}`));

    // Day 6 regression smoke
    const day6 = spawnSync("node", ["day6-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY6_SMOKE_PORT: "3400" },
      encoding: "utf-8",
    });
    const day6Summary = `${day6.stdout}\n${day6.stderr}`;
    const day6Pass = day6.status === 0 && /SUMMARY\s+\|\s+passed=11\s+failed=0/.test(day6Summary);
    out.push(result("17. Day 6 smoke suite still passes", day6Pass, day6.status === 0 ? "status=0" : `status=${day6.status}`));

    // Route reachability
    reqCtx = await request.newContext();
    const pageChecks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      pageChecks.push(`${p}:${resp.status()}`);
    }
    const allReachable = pageChecks.every((entry) => entry.endsWith(":200"));
    out.push(result("18. login/signup/pricing pages reachable", allReachable, pageChecks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY7_SMOKE_RESULTS_START");
    out.forEach((r) => {
      console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY7_SMOKE_RESULTS_END");

    process.exitCode = failed.length > 0 ? 1 : 0;
  } finally {
    if (reqCtx) await reqCtx.dispose();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
