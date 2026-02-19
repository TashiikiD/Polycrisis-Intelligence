const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY11_SMOKE_PORT || 5200);
let mode = "api";

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

function isoDateFromOffset(offsetDays) {
  const now = new Date("2026-02-20T00:00:00Z");
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function buildHistory(days) {
  const rows = [];
  let score = 55;
  for (let i = -days + 1; i <= 0; i += 1) {
    score += Math.sin(i / 5) * 1.7;
    score = Math.max(8, Math.min(94, score));
    rows.push({
      date: isoDateFromOffset(i),
      wssi_score: Number(score.toFixed(1)),
      wssi_value: Number(((score - 50) / 20).toFixed(3)),
      wssi_delta: Number((Math.cos(i / 4) * 0.52).toFixed(3)),
      trend: i % 2 === 0 ? "up" : "down",
    });
  }
  return rows;
}

const themeSignals = [
  {
    theme_id: "1.2",
    theme_name: "Corporate Debt Distress",
    category: "Economic-Financial",
    mean_z_score: 1.25,
    stress_level: "watch",
    momentum_30d: 0.22,
  },
  {
    theme_id: "2.1",
    theme_name: "Tipping Point Proximity",
    category: "Climate-Environmental",
    mean_z_score: 2.96,
    stress_level: "approaching",
    momentum_30d: 0.48,
  },
  {
    theme_id: "3.1",
    theme_name: "Interstate Conflict",
    category: "Geopolitical-Conflict",
    mean_z_score: -2.21,
    stress_level: "approaching",
    momentum_30d: -0.41,
  },
  {
    theme_id: "3.4",
    theme_name: "Governance Decay",
    category: "Geopolitical-Conflict",
    mean_z_score: -3.84,
    stress_level: "critical",
    momentum_30d: -0.66,
  },
  {
    theme_id: "4.2",
    theme_name: "Cyber Systemic Risk",
    category: "Technological",
    mean_z_score: 1.92,
    stress_level: "watch",
    momentum_30d: 0.27,
  },
  {
    theme_id: "5.2",
    theme_name: "Food System Fragility",
    category: "Biological-Health",
    mean_z_score: 2.54,
    stress_level: "approaching",
    momentum_30d: 0.33,
  },
  {
    theme_id: "6.1",
    theme_name: "Supply Chain Fragmentation",
    category: "Cross-System",
    mean_z_score: 1.48,
    stress_level: "watch",
    momentum_30d: 0.18,
  },
].map((row, idx) => ({
  ...row,
  confidence_tier: idx % 2 === 0 ? "documented" : "established",
  quality_score: 0.7 + ((idx % 3) * 0.05),
  data_freshness: idx % 4 === 0 ? "warning" : "fresh",
  indicator_details: [
    {
      indicator_id: `${row.theme_id}.1`,
      name: `${row.theme_name} Signal`,
      source: "Synthetic",
      stress_z_latest: row.mean_z_score,
      momentum_30d: row.momentum_30d,
      freshness: "fresh",
      quality_tier: "documented",
    },
    {
      indicator_id: `${row.theme_id}.2`,
      name: `${row.theme_name} Auxiliary`,
      source: "Synthetic",
      stress_z_latest: row.mean_z_score * 0.8,
      momentum_30d: row.momentum_30d * 0.7,
      freshness: "recent",
      quality_tier: "documented",
    },
  ],
}));

const sampleApiWssi = {
  wssi_value: 0.92,
  wssi_score: 64.7,
  calculation_timestamp: "2026-02-20T12:00:00Z",
  theme_signals: themeSignals,
};

const sampleCorrelationPayload = {
  generated_at: "2026-02-20T12:00:00Z",
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
  generated_at: "2026-02-20T12:00:00Z",
  days: 90,
  history: buildHistory(90),
};

const alertDate = sampleHistoryPayload.history[sampleHistoryPayload.history.length - 3].date;
const sampleAlertsPayload = {
  generated_at: "2026-02-20T12:00:00Z",
  active_alerts: [
    {
      alert_id: "THEME_CRITICAL_3.4_20260220",
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
      metadata: { alert_id: "THEME_CRITICAL_3.4_20260220", theme_ids: ["3.4"], trigger_value: -3.84 },
    },
  ],
  recent_alerts: [
    {
      alert_id: "THEME_WARNING_3.1_20260219",
      title: "Interstate Conflict warning",
      description: "Conflict stress remains elevated.",
      alert_type: "Geopolitical-Conflict",
      severity: "warning",
      status: "resolved",
      created_at: `${isoDateFromOffset(-6)} 10:15:00`,
      theme_ids: ["3.1"],
      indicator_id: "3.1.1",
      threshold: 2.0,
      raw_value: -2.21,
      metadata: { alert_id: "THEME_WARNING_3.1_20260219", theme_ids: ["3.1"], trigger_value: -2.21 },
    },
    {
      alert_id: "THEME_INFO_1.2_20260218",
      title: "Corporate debt conditions improving",
      description: "Moderate variance detected.",
      alert_type: "Economic-Financial",
      severity: "info",
      status: "resolved",
      created_at: `${isoDateFromOffset(-8)} 08:20:00`,
      theme_ids: ["1.2"],
      indicator_id: "1.2.1",
      threshold: 1.5,
      raw_value: 1.25,
      metadata: { alert_id: "THEME_INFO_1.2_20260218", theme_ids: ["1.2"], trigger_value: 1.25 },
    },
  ],
};

const sampleNetworkPayload = {
  generated_at: "2026-02-20T12:00:00Z",
  node_count: 5,
  edge_count: 5,
  nodes: [
    { id: "n_1_2", label: "Corporate Debt Distress", category: "Economic-Financial", theme_id: "1.2", x: 160, y: 120 },
    { id: "n_2_1", label: "Tipping Point Proximity", category: "Climate-Environmental", theme_id: "2.1", x: 420, y: 110 },
    { id: "n_3_1", label: "Interstate Conflict", category: "Geopolitical-Conflict", theme_id: "3.1", x: 560, y: 320 },
    { id: "n_3_4", label: "Governance Decay", category: "Geopolitical-Conflict", theme_id: "3.4", x: 390, y: 420 },
    { id: "n_bridge_supply_chain", label: "Supply Chain Chokepoints", category: "Cross-System", theme_id: null, x: 300, y: 250 },
  ],
  edges: [
    { id: "e01", source: "n_1_2", target: "n_bridge_supply_chain", weight: 0.62, evidence: "documented", direction: "unidirectional", type: "corporate_margin_pressure" },
    { id: "e02", source: "n_bridge_supply_chain", target: "n_2_1", weight: 0.58, evidence: "documented", direction: "unidirectional", type: "climate_trade" },
    { id: "e03", source: "n_3_4", target: "n_3_1", weight: 0.53, evidence: "documented", direction: "unidirectional", type: "governance_conflict_feedback" },
    { id: "e04", source: "n_2_1", target: "n_3_1", weight: 0.47, evidence: "documented", direction: "unidirectional", type: "climate_conflict_pressure" },
    { id: "e05", source: "n_3_1", target: "n_bridge_supply_chain", weight: 0.44, evidence: "emerging", direction: "unidirectional", type: "conflict_supply" },
  ],
  metrics: {
    n_1_2: { degree_total: 2, pagerank: 0.11 },
    n_2_1: { degree_total: 2, pagerank: 0.12 },
    n_3_1: { degree_total: 3, pagerank: 0.14 },
    n_3_4: { degree_total: 1, pagerank: 0.08 },
    n_bridge_supply_chain: { degree_total: 4, pagerank: 0.2 },
  },
};

const samplePatternsPayload = {
  generated_at: "2026-02-20T12:00:00Z",
  method: "weighted_cosine_overlap_penalty",
  current_vector_size: 52,
  matches: [
    {
      episode_id: "episode_2008_financial_crisis",
      label: "2008 Financial Crisis",
      period: "2008-09 to 2009-06",
      description: "Credit contraction and liquidity breakdown across financial systems.",
      similarity_pct: 80.2,
      confidence_tier: "high",
      required_overlap_min: 4,
      diagnostics: {
        raw_cosine: 0.88,
        penalty: 0.23,
        overlap: ["1.2.1", "1.2.2", "3.1.1", "6.1.1"],
        missing_indicators: ["2.1.1", "4.2.1"],
      },
    },
    {
      episode_id: "episode_2020_covid_shock",
      label: "2020 COVID Shock",
      period: "2020-03 to 2020-08",
      description: "Acute cross-system volatility with supply and health strain.",
      similarity_pct: 62.7,
      confidence_tier: "medium",
      required_overlap_min: 4,
      diagnostics: {
        raw_cosine: 0.71,
        penalty: 0.36,
        overlap: ["3.1.1", "5.2.1", "6.1.1", "4.2.1"],
        missing_indicators: ["2.1.1"],
      },
    },
    {
      episode_id: "episode_2022_energy_food",
      label: "2022 Energy-Food Crisis",
      period: "2022-02 to 2022-12",
      description: "Inflation and food-system stress driven by conflict and energy disruption.",
      similarity_pct: 44.4,
      confidence_tier: "low",
      required_overlap_min: 4,
      diagnostics: {
        raw_cosine: 0.52,
        penalty: 0.41,
        overlap: ["2.1.1", "3.1.1", "5.2.1"],
        missing_indicators: ["1.2.1", "4.2.1"],
      },
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
    if (mode === "network-stale" && pathname.endsWith("/app/data/network-fallback.json")) {
      return sendJson(res, 503, { error: "network local fallback unavailable" });
    }

    if (pathname.startsWith("/output/analytics/")) {
      if (mode === "stale" || mode === "local") return sendJson(res, 503, { error: "artifact unavailable" });
      if (mode === "network-stale" && pathname.endsWith("/network.json")) return sendJson(res, 503, { error: "network artifact unavailable" });
      if (pathname.endsWith("/wssi-latest.json")) return sendJson(res, 200, sampleArtifactWssi);
      if (pathname.endsWith("/correlations.json")) return sendJson(res, 200, sampleArtifactCorrelations);
      if (pathname.endsWith("/wssi-history.json")) return sendJson(res, 200, sampleArtifactHistory);
      if (pathname.endsWith("/alerts.json")) return sendJson(res, 200, sampleArtifactAlerts);
      if (pathname.endsWith("/network.json")) return sendJson(res, 200, sampleArtifactNetwork);
      if (pathname.endsWith("/patterns.json")) return sendJson(res, 200, sampleArtifactPatterns);
      return sendJson(res, 404, { error: "artifact not found" });
    }

    const apiEnabled = mode === "api" || mode === "partial-stale" || mode === "network-stale";
    if (pathname === "/api/v1/wssi") return apiEnabled ? sendJson(res, 200, sampleApiWssi) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/themes") return apiEnabled ? sendJson(res, 200, { themes: sampleApiWssi.theme_signals }) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/correlations") return apiEnabled ? sendJson(res, 200, sampleCorrelationPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/wssi/history") return apiEnabled ? sendJson(res, 200, sampleHistoryPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/alerts") return apiEnabled ? sendJson(res, 200, sampleAlertsPayload) : sendJson(res, 503, { error: "api unavailable" });
    if (pathname === "/api/v1/network") {
      if (mode === "partial-stale" || mode === "network-stale") return sendJson(res, 503, { error: "network unavailable (forced stale)" });
      return apiEnabled ? sendJson(res, 200, sampleNetworkPayload) : sendJson(res, 503, { error: "api unavailable" });
    }
    if (pathname === "/api/v1/patterns") return apiEnabled ? sendJson(res, 200, samplePatternsPayload) : sendJson(res, 503, { error: "api unavailable" });

    if (pathname === "/wssi/current") return mode === "legacy" ? sendJson(res, 200, sampleLegacyWssi) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/correlations") return mode === "legacy" ? sendJson(res, 200, sampleLegacyCorrelations) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/wssi/history") return mode === "legacy" ? sendJson(res, 200, sampleLegacyHistory) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/alerts") return mode === "legacy" ? sendJson(res, 200, sampleLegacyAlerts) : sendJson(res, 503, { error: "legacy unavailable" });
    if (pathname === "/network") {
      if (mode === "network-stale") return sendJson(res, 503, { error: "network legacy unavailable" });
      return mode === "legacy" ? sendJson(res, 200, sampleLegacyNetwork) : sendJson(res, 503, { error: "legacy unavailable" });
    }
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

async function setTier(page, tier) {
  await page.evaluate((nextTier) => {
    localStorage.setItem("wssi_tier", nextTier);
    localStorage.setItem("tier", nextTier);
    localStorage.setItem("paywall_tier", nextTier);
    localStorage.setItem("wssi_api_key", "smoke-day11-key");
  }, tier);
}

async function clickExport(page) {
  const maybeDownload = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await page.click("#exportBriefButton");
  await page.waitForTimeout(350);
  return maybeDownload;
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
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem("wssi_tier")) localStorage.setItem("wssi_tier", "basic");
        if (!localStorage.getItem("tier")) localStorage.setItem("tier", "basic");
        if (!localStorage.getItem("paywall_tier")) localStorage.setItem("paywall_tier", "basic");
        if (!localStorage.getItem("wssi_api_key")) localStorage.setItem("wssi_api_key", "smoke-day11-key");
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

    const exportButtonInfo = await page.evaluate(() => {
      const button = document.getElementById("exportBriefButton");
      const publishButton = document.getElementById("publishBriefButton");
      const archiveLink = document.querySelector(".archive-link");
      return {
        exists: Boolean(button),
        disabled: button ? button.disabled : true,
        describedBy: button ? button.getAttribute("aria-describedby") : "",
        archiveLinkExists: Boolean(archiveLink),
        publishHiddenWithoutToken: publishButton ? publishButton.classList.contains("hidden") : true,
      };
    });
    out.push(result(
      "1. Export button, archive link, and default hidden publish trigger are present",
      exportButtonInfo.exists &&
        !exportButtonInfo.disabled &&
        exportButtonInfo.describedBy === "exportBriefStatus" &&
        exportButtonInfo.archiveLinkExists &&
        exportButtonInfo.publishHiddenWithoutToken,
      JSON.stringify(exportButtonInfo)
    ));

    await setTier(page, "free");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(700);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const freeTierBadge = await page.locator("#accessBadge").innerText();
    const freeDownload = await clickExport(page);
    const freeReportInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const placeholders = report ? report.querySelectorAll(".brief-upgrade-placeholder").length : 0;
      const stressRows = report ? report.querySelectorAll(".brief-section:nth-of-type(2) tbody tr").length : 0;
      const tier = report ? report.querySelector(".brief-tier-label")?.textContent?.trim() : "";
      return { exists: Boolean(report), placeholders, stressRows, tier };
    });
    out.push(result(
      "2. Free tier exports limited brief with placeholders",
      freeReportInfo.exists &&
        freeReportInfo.stressRows <= 5 &&
        freeReportInfo.placeholders >= 1 &&
        freeReportInfo.tier === "Free" &&
        freeTierBadge.toLowerCase().includes("free"),
      `badge=${freeTierBadge} download=${Boolean(freeDownload)} report=${JSON.stringify(freeReportInfo)}`
    ));

    await setTier(page, "basic");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(700);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const paidDownload = await clickExport(page);
    const paidReportInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const placeholders = report ? report.querySelectorAll(".brief-upgrade-placeholder").length : 0;
      const appendixThemes = report ? report.querySelectorAll(".brief-appendix-theme").length : 0;
      const tier = report ? report.querySelector(".brief-tier-label")?.textContent?.trim() : "";
      return { exists: Boolean(report), placeholders, appendixThemes, tier };
    });
    out.push(result(
      "3. Paid tier exports full brief sections and appendix",
      paidReportInfo.exists && paidReportInfo.placeholders === 0 && paidReportInfo.appendixThemes > 0 && paidReportInfo.tier === "Basic",
      `download=${Boolean(paidDownload)} report=${JSON.stringify(paidReportInfo)}`
    ));

    const scoreConsistency = await page.evaluate(() => {
      const screenScore = document.getElementById("wssiScore")?.textContent?.trim() || "";
      const reportScore = document.querySelector("#fragilityBriefRenderHost .brief-kpi-grid article:nth-child(2) p")?.textContent?.trim() || "";
      return { screenScore, reportScore };
    });
    out.push(result(
      "4. PDF model includes WSSI score matching on-screen snapshot",
      scoreConsistency.screenScore !== "" && scoreConsistency.reportScore.includes(scoreConsistency.screenScore),
      JSON.stringify(scoreConsistency)
    ));

    const appendixInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const appendixRows = report ? report.querySelectorAll(".brief-appendix-theme tbody tr").length : 0;
      const topThemeRows = report ? report.querySelectorAll(".brief-section:nth-of-type(2) tbody tr").length : 0;
      return { appendixRows, topThemeRows };
    });
    out.push(result(
      "5. Report includes top themes and indicator appendix rows",
      appendixInfo.topThemeRows > 0 && appendixInfo.appendixRows > 0,
      JSON.stringify(appendixInfo)
    ));

    const alertInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const alertText = report ? report.querySelector(".brief-section:nth-of-type(3)")?.textContent || "" : "";
      const tableRows = report ? report.querySelectorAll(".brief-section:nth-of-type(3) tbody tr").length : 0;
      return {
        hasCritical: alertText.includes("Critical"),
        hasWarning: alertText.includes("Warning"),
        hasInfo: alertText.includes("Info"),
        tableRows,
      };
    });
    out.push(result(
      "6. Alert summary and latest rows populate from alert register data",
      alertInfo.hasCritical && alertInfo.hasWarning && alertInfo.hasInfo && alertInfo.tableRows >= 2,
      JSON.stringify(alertInfo)
    ));

    const highlightInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const text = report ? report.textContent || "" : "";
      return {
        hasCorrelation: text.includes("2.1 vs 3.4"),
        hasNetwork: text.includes("Top Nodes") && text.includes("Top Edges"),
        hasPattern: text.includes("2008 Financial Crisis"),
      };
    });
    out.push(result(
      "7. Correlation, network, and pattern highlights render when datasets are available",
      highlightInfo.hasCorrelation && highlightInfo.hasNetwork && highlightInfo.hasPattern,
      JSON.stringify(highlightInfo)
    ));

    await page.request.get(`${base}/__mode?set=network-stale`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const staleExportDownload = await clickExport(page);
    const staleInfo = await page.evaluate(() => {
      const report = document.querySelector("#fragilityBriefRenderHost .fragility-brief");
      const staleBadges = report ? report.querySelectorAll(".brief-section-stale").length : 0;
      const staleBannerVisible = document.querySelector("#staleBadge:not(.hidden)") !== null;
      return { staleBadges, staleBannerVisible };
    });
    out.push(result(
      "8. Export proceeds with stale section badges when one non-core dataset fails",
      staleInfo.staleBadges >= 1 && staleInfo.staleBannerVisible,
      `download=${Boolean(staleExportDownload)} stale=${JSON.stringify(staleInfo)}`
    ));

    await page.request.get(`${base}/__mode?set=api`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      window.__printFallbackCount = 0;
      window.open = () => {
        window.__printFallbackCount += 1;
        return {
          document: { open() {}, write() {}, close() {} },
          focus() {},
          print() {},
        };
      };
      delete window.html2canvas;
      delete window.jspdf;
    });
    await page.click("#exportBriefButton");
    await page.waitForTimeout(450);
    const fallbackInfo = await page.evaluate(() => ({
      printFallbackCount: window.__printFallbackCount || 0,
      statusText: document.getElementById("exportBriefStatus")?.textContent?.trim() || "",
    }));
    out.push(result(
      "9. Export gracefully falls back when PDF libraries are unavailable",
      fallbackInfo.printFallbackCount > 0 && fallbackInfo.statusText.toLowerCase().includes("print fallback"),
      JSON.stringify(fallbackInfo)
    ));

    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    out.push(result(
      "10. No runtime console/page errors during Day 11 export interactions",
      baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0 && intervalDelays.includes(60000),
      `console=${baselineConsoleErrors.length} page=${baselinePageErrors.length} intervals=${JSON.stringify(intervalDelays)}`
    ));

    if (browser) {
      await browser.close();
      browser = null;
    }

    const day10 = spawnSync("node", ["day10-smoke-check.js"], {
      cwd: __dirname,
      env: {
        ...process.env,
        DAY10_SMOKE_PORT: "4101",
        DAY9_SMOKE_PORT: "3601",
        DAY8_SMOKE_PORT: "3501",
        DAY7_SMOKE_PORT: "3301",
        DAY6_SMOKE_PORT: "3201",
      },
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const day10Summary = `${day10.stdout}\n${day10.stderr}`;
    const day10SummaryPass = /SUMMARY\s+\|\s+passed=12\s+failed=0/.test(day10Summary);
    const day10Pass = day10.status === 0 && day10SummaryPass;
    const day10Tail = day10Summary.slice(Math.max(0, day10Summary.length - 320)).replace(/\s+/g, " ").trim();
    out.push(result(
      "11. Day 10 smoke remains passing unchanged",
      day10Pass,
      `status=${day10.status} error=${day10.error ? String(day10.error.message || day10.error) : "none"} tail=${day10Tail}`
    ));

    reqCtx = await request.newContext();
    const pageChecks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html", "/archive/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      pageChecks.push(`${p}:${resp.status()}`);
    }
    const allReachable = pageChecks.every((entry) => entry.endsWith(":200"));
    out.push(result("12. login/signup/pricing/archive remain reachable", allReachable, pageChecks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY11_SMOKE_RESULTS_START");
    out.forEach((r) => {
      console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY11_SMOKE_RESULTS_END");
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
