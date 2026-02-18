const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY9_SMOKE_PORT || 3600);
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
  current_vector_size: 52,
  matches: [
    {
      episode_id: "episode_2008_financial_crisis",
      label: "2008 Financial Crisis",
      period: "2008-09 to 2009-06",
      description: "Credit stress + volatility shock + labor market deterioration.",
      similarity_pct: 80.38,
      confidence_tier: "high",
      required_overlap_min: 4,
      diagnostics: { raw_cosine: 0.803843, penalty: 1.0, overlap: ["1.2.1", "2.1.1", "3.1.1", "3.4.10"], missing_indicators: [] },
    },
    {
      episode_id: "episode_2020_covid_shock",
      label: "2020 COVID Shock",
      period: "2020-03 to 2020-08",
      description: "Acute cross-system volatility with supply and health strain.",
      similarity_pct: 25.87,
      confidence_tier: "low",
      required_overlap_min: 4,
      diagnostics: { raw_cosine: 0.323362, penalty: 0.8, overlap: ["1.4.1", "3.1.1", "5.1.new2", "5.2.new1"], missing_indicators: ["2.2.1"] },
    },
    {
      episode_id: "episode_2022_energy_food",
      label: "2022 Energy-Food Crisis",
      period: "2022-02 to 2022-12",
      description: "Inflation and food-system stress driven by conflict and energy disruption.",
      similarity_pct: 0,
      confidence_tier: "low",
      required_overlap_min: 4,
      diagnostics: { raw_cosine: 0, penalty: 0.8, overlap: ["1.1.new2", "2.1.new3", "3.1.new1", "3.1.new3"], missing_indicators: ["5.2.1"] },
    },
  ],
};

const sampleLegacyWssi = JSON.parse(JSON.stringify(sampleApiWssi));
const sampleLegacyCorrelations = JSON.parse(JSON.stringify(sampleCorrelationPayload));
const sampleLegacyHistory = { data: sampleHistoryPayload.history, days: 90 };
const sampleLegacyAlerts = { alerts: [...sampleAlertsPayload.active_alerts, ...sampleAlertsPayload.recent_alerts] };
const sampleLegacyNetwork = JSON.parse(JSON.stringify(sampleNetworkPayload));
const sampleLegacyPatterns = JSON.parse(JSON.stringify(samplePatternsPayload));

const sampleArtifactWssi = JSON.parse(JSON.stringify(sampleApiWssi));
const sampleArtifactCorrelations = JSON.parse(JSON.stringify(sampleCorrelationPayload));
const sampleArtifactHistory = JSON.parse(JSON.stringify(sampleHistoryPayload));
const sampleArtifactAlerts = JSON.parse(JSON.stringify(sampleAlertsPayload));
const sampleArtifactNetwork = JSON.parse(JSON.stringify(sampleNetworkPayload));
const sampleArtifactPatterns = JSON.parse(JSON.stringify(samplePatternsPayload));

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

async function clickTab(page, tabId) {
  await page.click(`[data-tab="${tabId}"]`);
  await page.waitForTimeout(120);
}

async function activeTabId(page) {
  return page.$eval('[role="tab"][aria-selected="true"]', (el) => el.getAttribute("data-tab"));
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
      if (mode === "stale" || mode === "local") return sendJson(res, 503, { error: "artifact unavailable in current mode" });
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
    if (pathname === "/patterns") return mode === "legacy" ? sendJson(res, 200, sampleLegacyPatterns) : sendJson(res, 503, { error: "legacy unavailable" });

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
        localStorage.setItem("wssi_api_key", "smoke-day9-key");
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
    await page.goto(`${base}/app/index.html#ledger`, { waitUntil: "networkidle" });
    await page.waitForSelector(".ledger-row");
    const baselineConsoleErrors = [...consoleErrors];
    const baselinePageErrors = [...pageErrors];

    const activeStartTab = await activeTabId(page);
    out.push(result("1. #ledger route opens ledger tab", activeStartTab === "ledger", `activeTab=${activeStartTab}`));

    const tabs = ["ledger", "correlations", "network", "patterns", "timeline"];
    let deepLinkPass = true;
    const deepLinkDetails = [];
    for (const tab of tabs) {
      await page.goto(`${base}/app/index.html#${tab}`, { waitUntil: "networkidle" });
      const active = await activeTabId(page);
      deepLinkDetails.push(`${tab}:${active}`);
      if (active !== tab) deepLinkPass = false;
    }
    out.push(result("2. Hash routes activate correct tabs", deepLinkPass, deepLinkDetails.join(" | ")));

    await page.goto(`${base}/app/index.html#foo`, { waitUntil: "networkidle" });
    const unknownActive = await activeTabId(page);
    const hashAfterUnknown = await page.evaluate(() => window.location.hash);
    out.push(result("3. Unknown hash normalizes to #ledger", unknownActive === "ledger" && hashAfterUnknown === "#ledger", `active=${unknownActive} hash=${hashAfterUnknown}`));

    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await clickTab(page, "patterns");
    const patternSourceApi = await page.locator(".pattern-source").innerText();
    out.push(result("4. Pattern panel loads from /api/v1/patterns", patternSourceApi.includes("api-v1-patterns"), patternSourceApi));

    const patternItems = await page.locator(".pattern-item").count();
    const firstSimilarity = await page.locator(".pattern-item .pattern-similarity").first().innerText();
    out.push(result("5. Pattern top-3 list renders and sorts by similarity", patternItems >= 3 && firstSimilarity.includes("80"), `items=${patternItems} first=${firstSimilarity}`));

    const disclaimerText = await page.locator(".pattern-subhead").innerText();
    const proxyNoteText = await page.locator(".pattern-proxy-note").innerText();
    const radarWidth = await page.locator(".pattern-radar-canvas").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    out.push(result("6. Pattern disclaimer and diagnostic proxy note visible", disclaimerText.includes("not predictions") && proxyNoteText.includes("diagnostic proxy") && radarWidth > 200, `radarWidth=${radarWidth}`));

    await page.locator(".pattern-item").nth(1).click();
    await page.waitForTimeout(160);
    const diagnosticsText = await page.locator(".pattern-diagnostics").innerText();
    const diagnosticsLower = diagnosticsText.toLowerCase();
    out.push(result("7. Pattern selection updates diagnostics pane", diagnosticsLower.includes("raw cosine") && diagnosticsLower.includes("missing indicators"), diagnosticsText.slice(0, 170)));

    await page.request.get(`${base}/__mode?set=legacy`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "patterns");
    const patternSourceLegacy = await page.locator(".pattern-source").innerText();
    out.push(result("8. Pattern falls back to /patterns when v1 fails", patternSourceLegacy.includes("legacy-patterns"), patternSourceLegacy));

    await page.request.get(`${base}/__mode?set=artifact`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await clickTab(page, "patterns");
    const patternSourceArtifact = await page.locator(".pattern-source").innerText();
    out.push(result("9. Pattern falls back to analytics artifacts", patternSourceArtifact.includes("analytics-artifact-patterns"), patternSourceArtifact));

    await page.request.get(`${base}/__mode?set=local`);
    await page.click("#refreshButton");
    await page.waitForTimeout(1000);
    await clickTab(page, "patterns");
    const patternSourceLocal = await page.locator(".pattern-source").innerText();
    out.push(result("10. Pattern falls back to local sample as terminal fallback", patternSourceLocal.includes("local-fallback-patterns"), patternSourceLocal));

    await page.request.get(`${base}/__mode?set=api`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);

    await clickTab(page, "ledger");
    await page.locator('.ledger-row:has-text("Interstate Conflict")').first().click();
    await page.waitForTimeout(180);
    const themeAfterLedger = await page.locator("#themeDetailMount h3").innerText();
    out.push(result("11. Ledger selection still updates theme detail", themeAfterLedger.includes("Interstate Conflict"), themeAfterLedger));

    await clickTab(page, "network");
    await page.locator(".network-canvas").focus();
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
    }
    const themeAfterNetwork = await page.locator("#themeDetailMount h3").innerText();
    out.push(result("12. Network selection still updates theme detail", themeAfterNetwork.length > 0, themeAfterNetwork));

    await clickTab(page, "timeline");
    await page.locator(".alert-row").first().click();
    await page.waitForTimeout(220);
    const timelineTooltipVisible = await page.locator("#wssiTimelineMount .chart-tooltip:not(.hidden)").count();
    const themeAfterAlert = await page.locator("#themeDetailMount h3").innerText();
    out.push(result("13. Alert row click still focuses timeline + theme context", timelineTooltipVisible > 0 && themeAfterAlert.length > 0, `tooltip=${timelineTooltipVisible} theme=${themeAfterAlert}`));

    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    await page.request.get(`${base}/__mode?set=stale`);
    await page.click("#refreshButton");
    await page.waitForTimeout(1000);
    const staleVisible = await page.locator("#staleBadge:not(.hidden)").count();
    const stalePanelCount = await page.locator(".panel-status:not(.hidden)").count();
    out.push(result("14. 60s refresh and stale statuses remain active", intervalDelays.includes(60000) && staleVisible > 0 && stalePanelCount > 0, `intervals=${JSON.stringify(intervalDelays)} stale=${staleVisible} panels=${stalePanelCount}`));

    await page.setViewportSize({ width: 360, height: 800 });
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html#patterns`, { waitUntil: "networkidle" });
    await clickTab(page, "patterns");
    const mobilePatternWidth = await page.locator(".pattern-radar-canvas").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const mobileTabButtons = await page.locator(".tab-button").count();
    const mobileAlertRows = await page.locator(".alert-row").count();
    out.push(result("15. Mobile 360 tabbed shell + side rail remain usable", mobilePatternWidth > 260 && mobileTabButtons === 5 && mobileAlertRows > 0, `patternWidth=${mobilePatternWidth} tabs=${mobileTabButtons} alerts=${mobileAlertRows}`));

    out.push(result("16. No JS console/runtime errors on Day 9 baseline load", baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0, `consoleErrors=${baselineConsoleErrors.length} pageErrors=${baselinePageErrors.length}`));

    const day8 = spawnSync("node", ["day8-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY8_SMOKE_PORT: "3700", DAY7_SMOKE_PORT: "3800", DAY6_SMOKE_PORT: "3900" },
      encoding: "utf-8",
    });
    const day8Summary = `${day8.stdout}\n${day8.stderr}`;
    const day8Pass = day8.status === 0 && /SUMMARY\s+\|\s+passed=18\s+failed=0/.test(day8Summary);
    out.push(result("17. Day 8 smoke suite passes unchanged", day8Pass, day8.status === 0 ? "status=0" : `status=${day8.status}`));

    const day7 = spawnSync("node", ["day7-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY7_SMOKE_PORT: "3801", DAY6_SMOKE_PORT: "3901" },
      encoding: "utf-8",
    });
    const day7Summary = `${day7.stdout}\n${day7.stderr}`;
    const day7Pass = day7.status === 0 && /SUMMARY\s+\|\s+passed=18\s+failed=0/.test(day7Summary);
    out.push(result("18. Day 7 smoke suite passes unchanged", day7Pass, day7.status === 0 ? "status=0" : `status=${day7.status}`));

    const day6 = spawnSync("node", ["day6-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY6_SMOKE_PORT: "3902" },
      encoding: "utf-8",
    });
    const day6Summary = `${day6.stdout}\n${day6.stderr}`;
    const day6Pass = day6.status === 0 && /SUMMARY\s+\|\s+passed=11\s+failed=0/.test(day6Summary);
    out.push(result("19. Day 6 smoke suite passes unchanged", day6Pass, day6.status === 0 ? "status=0" : `status=${day6.status}`));

    reqCtx = await request.newContext();
    const pageChecks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      pageChecks.push(`${p}:${resp.status()}`);
    }
    const allReachable = pageChecks.every((entry) => entry.endsWith(":200"));
    out.push(result("20. login/signup/pricing pages reachable", allReachable, pageChecks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY9_SMOKE_RESULTS_START");
    out.forEach((r) => {
      console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY9_SMOKE_RESULTS_END");
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
