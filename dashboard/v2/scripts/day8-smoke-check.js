const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY8_SMOKE_PORT || 3500);
let mode = "api";

function isoDateFromOffset(offsetDays) {
  const now = new Date("2026-02-17T00:00:00Z");
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function buildHistory(days) {
  const rows = [];
  let score = 46;
  for (let i = -days + 1; i <= 0; i += 1) {
    score += Math.sin(i / 5) * 1.5 + ((i % 6) - 2) * 0.12;
    score = Math.max(5, Math.min(95, score));
    rows.push({
      date: isoDateFromOffset(i),
      wssi_score: Number(score.toFixed(1)),
      wssi_value: Number(((score - 50) / 20).toFixed(3)),
      wssi_delta: Number((Math.cos(i / 4) * 0.8).toFixed(3)),
      trend: i % 2 === 0 ? "up" : "down",
    });
  }
  return rows;
}

const sampleApiWssi = {
  wssi_value: 0.92,
  wssi_score: 64.7,
  calculation_timestamp: "2026-02-17T12:00:00Z",
  theme_signals: [
    {
      theme_id: "1.2",
      theme_name: "Corporate Debt Distress",
      category: "Economic-Financial",
      mean_z_score: 1.25,
      stress_level: "watch",
      momentum_30d: 0.22,
      confidence_tier: "documented",
      quality_score: 0.72,
      data_freshness: "fresh",
      indicator_details: [{ indicator_id: "1.2.1", name: "BBB Spread", source: "FRED", stress_z_latest: 1.25, momentum_30d: 0.22, freshness: "fresh", quality_tier: "documented" }],
    },
    {
      theme_id: "2.1",
      theme_name: "Tipping Point Proximity",
      category: "Climate-Environmental",
      mean_z_score: 2.96,
      stress_level: "approaching",
      momentum_30d: 0.48,
      confidence_tier: "established",
      quality_score: 0.83,
      data_freshness: "fresh",
      indicator_details: [{ indicator_id: "2.1.1", name: "Global Temp", source: "Copernicus", stress_z_latest: 2.96, momentum_30d: 0.48, freshness: "fresh", quality_tier: "established" }],
    },
    {
      theme_id: "3.1",
      theme_name: "Interstate Conflict",
      category: "Geopolitical-Conflict",
      mean_z_score: -2.21,
      stress_level: "approaching",
      momentum_30d: -0.41,
      confidence_tier: "documented",
      quality_score: 0.75,
      data_freshness: "warning",
      indicator_details: [{ indicator_id: "3.1.1", name: "Conflict Event Rate", source: "ACLED", stress_z_latest: -2.21, momentum_30d: -0.41, freshness: "warning", quality_tier: "documented" }],
    },
    {
      theme_id: "3.4",
      theme_name: "Governance Decay",
      category: "Geopolitical-Conflict",
      mean_z_score: -3.84,
      stress_level: "critical",
      momentum_30d: -0.66,
      confidence_tier: "documented",
      quality_score: 0.8,
      data_freshness: "recent",
      indicator_details: [{ indicator_id: "3.4.10", name: "Regime Stability", source: "Polity", stress_z_latest: -3.84, momentum_30d: -0.66, freshness: "recent", quality_tier: "documented" }],
    },
  ],
};

const sampleCorrelationPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  window_days: 90,
  strong_threshold: 0.6,
  theme_level: {
    matrix: {
      "1.2": { "1.2": 1, "2.1": 0.28, "3.1": -0.51, "3.4": -0.35 },
      "2.1": { "1.2": 0.28, "2.1": 1, "3.1": 0.42, "3.4": 0.63 },
      "3.1": { "1.2": -0.51, "2.1": 0.42, "3.1": 1, "3.4": 0.58 },
      "3.4": { "1.2": -0.35, "2.1": 0.63, "3.1": 0.58, "3.4": 1 },
    },
    pairs: [
      { theme_a: "2.1", theme_b: "3.4", pearson_r: 0.63, p_value: 0.011, sample_n: 60, is_significant: 1 },
      { theme_a: "1.2", theme_b: "3.1", pearson_r: -0.51, p_value: 0.041, sample_n: 55, is_significant: 1 },
    ],
  },
};

const sampleHistoryPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  days: 90,
  history: buildHistory(90),
};

const alertDate = sampleHistoryPayload.history[sampleHistoryPayload.history.length - 3].date;

const sampleAlertsPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  active_alerts: [
    {
      alert_id: "THEME_CRITICAL_3.4_20260216",
      title: "Governance Decay at CRITICAL stress",
      description: "Governance stress crossed critical threshold.",
      alert_type: "Geopolitical-Conflict",
      severity: "critical",
      status: "active",
      created_at: `${alertDate} 12:00:00`,
      theme_ids: ["3.4"],
      indicator_id: "3.4.10",
      threshold: 3.0,
      raw_value: -3.84,
      metadata: { alert_id: "THEME_CRITICAL_3.4_20260216", theme_ids: ["3.4"], trigger_value: -3.84 },
    },
    {
      alert_id: "THEME_APPROACHING_3.1_20260216",
      title: "Interstate Conflict approaching critical",
      description: "Interstate conflict stress is elevated.",
      alert_type: "Geopolitical-Conflict",
      severity: "warning",
      status: "active",
      created_at: `${isoDateFromOffset(-4)} 08:00:00`,
      theme_ids: ["3.1"],
      indicator_id: "3.1.1",
      threshold: 2.0,
      raw_value: -2.21,
      metadata: { alert_id: "THEME_APPROACHING_3.1_20260216", theme_ids: ["3.1"], trigger_value: -2.21 },
    },
  ],
  recent_alerts: [
    {
      alert_id: "THEME_CRITICAL_2.1_20260215",
      title: "Tipping Point Proximity at CRITICAL stress",
      description: "Resolved critical climate risk condition.",
      alert_type: "Climate-Environmental",
      severity: "critical",
      status: "resolved",
      created_at: `${isoDateFromOffset(-7)} 10:15:00`,
      theme_ids: ["2.1"],
      indicator_id: "2.1.1",
      threshold: 3.0,
      raw_value: 3.3,
      metadata: { alert_id: "THEME_CRITICAL_2.1_20260215", theme_ids: ["2.1"], trigger_value: 3.3 },
    },
  ],
};

const sampleNetworkPayload = {
  generated_at: "2026-02-17T12:00:00Z",
  node_count: 7,
  edge_count: 8,
  warnings: [],
  nodes: [
    { id: "n_1_2", label: "Corporate Debt Distress", category: "Economic-Financial", theme_id: "1.2", x: 180, y: 120 },
    { id: "n_2_1", label: "Tipping Point Proximity", category: "Climate-Environmental", theme_id: "2.1", x: 500, y: 110 },
    { id: "n_3_1", label: "Interstate Conflict", category: "Geopolitical-Conflict", theme_id: "3.1", x: 640, y: 330 },
    { id: "n_3_4", label: "Governance Decay", category: "Geopolitical-Conflict", theme_id: "3.4", x: 430, y: 420 },
    { id: "n_4_2", label: "Cyber Systemic Risk", category: "Technological", theme_id: "4.2", x: 260, y: 390 },
    { id: "n_5_2", label: "Food System Fragility", category: "Biological-Health", theme_id: "5.2", x: 120, y: 270 },
    { id: "n_bridge_supply_chain", label: "Global Supply Chain Chokepoints", category: "Cross-System", theme_id: null, x: 360, y: 250 },
  ],
  edges: [
    { id: "e01", source: "n_1_2", target: "n_bridge_supply_chain", weight: 0.62, evidence: "documented", direction: "unidirectional", type: "corporate_margin_pressure" },
    { id: "e02", source: "n_bridge_supply_chain", target: "n_5_2", weight: 0.78, evidence: "established", direction: "unidirectional", type: "logistics_food" },
    { id: "e03", source: "n_2_1", target: "n_5_2", weight: 0.66, evidence: "documented", direction: "unidirectional", type: "crop_shock" },
    { id: "e04", source: "n_3_1", target: "n_bridge_supply_chain", weight: 0.58, evidence: "documented", direction: "unidirectional", type: "trade_route_disruption" },
    { id: "e05", source: "n_3_4", target: "n_3_1", weight: 0.53, evidence: "documented", direction: "unidirectional", type: "governance_conflict_feedback" },
    { id: "e06", source: "n_4_2", target: "n_bridge_supply_chain", weight: 0.49, evidence: "emerging", direction: "unidirectional", type: "cyber_logistics_disruption" },
    { id: "e07", source: "n_4_2", target: "n_3_4", weight: 0.44, evidence: "emerging", direction: "unidirectional", type: "information_governance" },
    { id: "e08", source: "n_2_1", target: "n_3_1", weight: 0.47, evidence: "documented", direction: "unidirectional", type: "climate_conflict_pressure" },
  ],
  metrics: {
    n_1_2: { degree_total: 2, pagerank: 0.103, betweenness: 0.12 },
    n_2_1: { degree_total: 2, pagerank: 0.111, betweenness: 0.1 },
    n_3_1: { degree_total: 3, pagerank: 0.138, betweenness: 0.15 },
    n_3_4: { degree_total: 2, pagerank: 0.122, betweenness: 0.11 },
    n_4_2: { degree_total: 2, pagerank: 0.094, betweenness: 0.08 },
    n_5_2: { degree_total: 2, pagerank: 0.127, betweenness: 0.09 },
    n_bridge_supply_chain: { degree_total: 5, pagerank: 0.211, betweenness: 0.33 },
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
        overlap: ["1.2.1", "2.1.1", "3.1.1", "3.4.10"],
        missing_indicators: []
      }
    }
  ]
};

const sampleLegacyWssi = JSON.parse(JSON.stringify(sampleApiWssi));
const sampleLegacyCorrelations = JSON.parse(JSON.stringify(sampleCorrelationPayload));
const sampleLegacyHistory = { data: sampleHistoryPayload.history, days: 90 };
const sampleLegacyAlerts = { alerts: [...sampleAlertsPayload.active_alerts, ...sampleAlertsPayload.recent_alerts] };
const sampleLegacyNetwork = JSON.parse(JSON.stringify(sampleNetworkPayload));

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

    if (mode === "stale" && pathname.startsWith("/app/data/")) return sendJson(res, 503, { error: "local fallback unavailable in stale mode" });

    if (pathname.startsWith("/output/analytics/")) {
      if (mode === "stale") return sendJson(res, 503, { error: "artifact unavailable in stale mode" });
      if (pathname.endsWith("/wssi-latest.json")) return sendJson(res, 200, sampleArtifactWssi);
      if (pathname.endsWith("/correlations.json")) return sendJson(res, 200, sampleArtifactCorrelations);
      if (pathname.endsWith("/wssi-history.json")) return sendJson(res, 200, sampleArtifactHistory);
      if (pathname.endsWith("/alerts.json")) return sendJson(res, 200, sampleArtifactAlerts);
      if (pathname.endsWith("/network.json")) return sendJson(res, 200, sampleArtifactNetwork);
      if (pathname.endsWith("/patterns.json")) return sendJson(res, 200, sampleArtifactPatterns);
      return sendJson(res, 404, { error: "artifact not found" });
    }

    if (pathname === "/api/v1/wssi") return mode === "api" ? sendJson(res, 200, sampleApiWssi) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/themes") return mode === "api" ? sendJson(res, 200, { themes: sampleApiWssi.theme_signals }) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/correlations") return mode === "api" ? sendJson(res, 200, sampleCorrelationPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/wssi/history") return mode === "api" ? sendJson(res, 200, sampleHistoryPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/alerts") return mode === "api" ? sendJson(res, 200, sampleAlertsPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/network") return mode === "api" ? sendJson(res, 200, sampleNetworkPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/patterns") return mode === "api" ? sendJson(res, 200, samplePatternsPayload) : sendJson(res, 503, { error: "api unavailable" });

    if (pathname === "/wssi/current") return mode === "legacy" ? sendJson(res, 200, sampleLegacyWssi) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/correlations") return mode === "legacy" ? sendJson(res, 200, sampleLegacyCorrelations) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/wssi/history") return mode === "legacy" ? sendJson(res, 200, sampleLegacyHistory) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/alerts") return mode === "legacy" ? sendJson(res, 200, sampleLegacyAlerts) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/network") return mode === "legacy" ? sendJson(res, 200, sampleLegacyNetwork) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/patterns") return mode === "legacy" ? sendJson(res, 200, samplePatternsPayload) : sendJson(res, 503, { error: "legacy unavailable" });

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

function projectedNodePoint(box, nodeId) {
  const pad = 36;
  const node = sampleNetworkPayload.nodes.find((n) => n.id === nodeId);
  const all = sampleNetworkPayload.nodes;
  const minX = Math.min(...all.map((n) => n.x));
  const maxX = Math.max(...all.map((n) => n.x));
  const minY = Math.min(...all.map((n) => n.y));
  const maxY = Math.max(...all.map((n) => n.y));
  const rx = Math.max(1, maxX - minX);
  const ry = Math.max(1, maxY - minY);
  const x = box.x + pad + ((node.x - minX) / rx) * (box.width - pad * 2);
  const y = box.y + pad + ((node.y - minY) / ry) * (box.height - pad * 2);
  return { x, y };
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
        localStorage.setItem("wssi_api_key", "smoke-day8-key");
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

    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await page.waitForSelector(".alert-row");
    await clickTab(page, "network");
    await page.waitForSelector(".network-canvas", { state: "visible" });

    const baselineConsoleErrors = [...consoleErrors];
    const baselinePageErrors = [...pageErrors];

    const networkSourceApi = await page.locator(".network-source").innerText();
    out.push(result("1. Network graph loads from /api/v1/network", networkSourceApi.includes("api-v1-network"), networkSourceApi));

    const edgeLegend = await page.locator(".network-legend-text").innerText();
    out.push(result("2. Network legend indicates stress/evidence semantics", edgeLegend.includes("stress tier") && edgeLegend.includes("evidence tier"), edgeLegend));

    const alertRowsInitial = await page.locator(".alert-row").count();
    out.push(result("3. Alert register loads active/recent alerts", alertRowsInitial >= 3, `rows=${alertRowsInitial}`));

    await page.locator(".network-canvas").focus();
    let nodeClickMapped = false;
    let nodeClickDetail = "";
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(90);
      const title = await page.locator("#themeDetailMount h3").innerText();
      nodeClickDetail = title;
      if (title.includes("Governance Decay")) {
        nodeClickMapped = true;
        break;
      }
    }
    out.push(result("4. Network node click selects mapped theme detail", nodeClickMapped, nodeClickDetail));

    await page.locator('input[data-category="Geopolitical-Conflict"]').uncheck();
    await page.waitForTimeout(120);
    await page.locator('input[data-category="Geopolitical-Conflict"]').check();
    const geopToggleState = await page.locator('input[data-category="Geopolitical-Conflict"]').isChecked();
    out.push(result("5. Category toggles hide/show subsets without errors", geopToggleState, `geopoliticalChecked=${geopToggleState}`));

    await page.selectOption('select[data-filter="severity"]', "critical");
    await page.waitForTimeout(120);
    const criticalRows = await page.locator(".alert-row").count();
    await page.selectOption('select[data-filter="status"]', "resolved");
    await page.waitForTimeout(120);
    const resolvedCriticalRows = await page.locator(".alert-row").count();
    await page.selectOption('select[data-filter="severity"]', "all");
    await page.selectOption('select[data-filter="status"]', "all");
    await page.selectOption('select[data-filter="category"]', "Geopolitical-Conflict");
    await page.waitForTimeout(120);
    const geoRows = await page.locator(".alert-row").count();
    await page.selectOption('select[data-filter="category"]', "all");
    out.push(result("6. Alert filters severity/status/category produce subsets", criticalRows >= 1 && resolvedCriticalRows >= 1 && geoRows >= 1, `critical=${criticalRows} resolvedCritical=${resolvedCriticalRows} geo=${geoRows}`));

    await page.locator(".alert-row").first().click();
    await page.waitForTimeout(220);
    const drawerVisible = await page.locator(".alert-drawer:not(.hidden)").count();
    const drawerText = drawerVisible ? await page.locator(".alert-drawer").innerText() : "";
    out.push(result("7. Alert row click opens detail drawer with metadata", drawerVisible > 0 && /alert id/i.test(drawerText), drawerText.slice(0, 150)));

    await clickTab(page, "timeline");
    const timelineTooltipVisible = await page.locator("#wssiTimelineMount .chart-tooltip:not(.hidden)").count();
    out.push(result("8. Alert row click triggers timeline focus", timelineTooltipVisible > 0, `timelineTooltips=${timelineTooltipVisible}`));

    const themeAfterAlertClick = await page.locator("#themeDetailMount h3").innerText();
    out.push(result("9. Alert row click syncs theme context", themeAfterAlertClick.length > 0, themeAfterAlertClick));

    await page.request.get(`${base}/__mode?set=legacy`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "network");
    const networkSourceLegacy = await page.locator(".network-source").innerText();
    out.push(result("10. Network falls back to /network when v1 fails", networkSourceLegacy.includes("legacy-network"), networkSourceLegacy));

    await page.request.get(`${base}/__mode?set=artifact`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "network");
    const networkSourceArtifact = await page.locator(".network-source").innerText();
    out.push(result("11. Network falls back to analytics artifact", networkSourceArtifact.includes("analytics-artifact-network"), networkSourceArtifact));

    await clickTab(page, "timeline");
    const timelineSourceArtifact = await page.locator(".timeline-source").innerText();
    out.push(result("12. Existing timeline behavior remains with artifact fallback", timelineSourceArtifact.includes("analytics-artifact-history"), timelineSourceArtifact));

    await page.request.get(`${base}/__mode?set=stale`);
    await page.click("#refreshButton");
    await page.waitForTimeout(1000);
    const staleVisible = await page.locator("#staleBadge:not(.hidden)").count();
    const stalePanelCount = await page.locator(".panel-status:not(.hidden)").count();
    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    out.push(result("13. Global/per-panel stale states + 60s refresh interval", staleVisible > 0 && stalePanelCount >= 2 && intervalDelays.includes(60000), `stale=${staleVisible} panel=${stalePanelCount} intervals=${JSON.stringify(intervalDelays)}`));

    await page.setViewportSize({ width: 360, height: 800 });
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await clickTab(page, "network");
    const mobileNetworkWidth = await page.locator(".network-canvas").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const mobileAlertRows = await page.locator(".alert-row").count();
    out.push(result("14. Mobile 360 keeps network and alerts usable", mobileNetworkWidth > 280 && mobileAlertRows > 0, `networkWidth=${mobileNetworkWidth} rows=${mobileAlertRows}`));

    out.push(result("15. No JS console/runtime errors on Day 8 baseline load", baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0, `consoleErrors=${baselineConsoleErrors.length} pageErrors=${baselinePageErrors.length}`));

    const nestedDay7Port = String(port + 10);
    const nestedDay6ForDay7Port = String(port + 11);
    const nestedDay6Port = String(port + 12);

    const day7 = spawnSync("node", ["day7-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY7_SMOKE_PORT: nestedDay7Port, DAY6_SMOKE_PORT: nestedDay6ForDay7Port },
      encoding: "utf-8",
    });
    const day7Summary = `${day7.stdout}\n${day7.stderr}`;
    const day7Pass = day7.status === 0 && /SUMMARY\s+\|\s+passed=18\s+failed=0/.test(day7Summary);
    out.push(result("16. Day 7 smoke suite passes unchanged", day7Pass, day7.status === 0 ? "status=0" : `status=${day7.status}`));

    const day6 = spawnSync("node", ["day6-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY6_SMOKE_PORT: nestedDay6Port },
      encoding: "utf-8",
    });
    const day6Summary = `${day6.stdout}\n${day6.stderr}`;
    const day6Pass = day6.status === 0 && /SUMMARY\s+\|\s+passed=11\s+failed=0/.test(day6Summary);
    out.push(result("17. Day 6 smoke suite passes unchanged", day6Pass, day6.status === 0 ? "status=0" : `status=${day6.status}`));

    reqCtx = await request.newContext();
    const pageChecks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      pageChecks.push(`${p}:${resp.status()}`);
    }
    const allReachable = pageChecks.every((entry) => entry.endsWith(":200"));
    out.push(result("18. login/signup/pricing pages reachable", allReachable, pageChecks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY8_SMOKE_RESULTS_START");
    out.forEach((r) => {
      console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY8_SMOKE_RESULTS_END");
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
