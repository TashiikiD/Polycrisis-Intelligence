const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../../../../");
const analyticsRoot = path.join(repoRoot, "output", "analytics");
const port = Number(process.env.DAY6_SMOKE_PORT || 3100);
let mode = "api";

const sampleApi = {
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

const sampleLegacy = JSON.parse(JSON.stringify(sampleApi));

const sampleCorrelations = {
  generated_at: "2026-02-17T12:00:00Z",
  window_days: 90,
  strong_threshold: 0.6,
  theme_level: {
    matrix: {
      A: { A: 1.0, B: -0.62, C: 0.2 },
      B: { A: -0.62, B: 1.0, C: 0.52 },
      C: { A: 0.2, B: 0.52, C: 1.0 },
    },
    pairs: [
      { theme_a: "A", theme_b: "B", pearson_r: -0.62, p_value: 0.01, sample_n: 50, is_significant: 1 },
      { theme_a: "A", theme_b: "C", pearson_r: 0.2, p_value: 0.2, sample_n: 48, is_significant: 0 },
      { theme_a: "B", theme_b: "C", pearson_r: 0.52, p_value: 0.03, sample_n: 49, is_significant: 1 },
    ],
  },
};

const sampleHistory = {
  generated_at: "2026-02-17T12:00:00Z",
  days: 90,
  history: Array.from({ length: 90 }).map((_, idx) => {
    const daysAgo = 89 - idx;
    const dt = new Date("2026-02-17T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() - daysAgo);
    const score = 42 + (Math.sin(idx / 7) * 16);
    return {
      date: dt.toISOString().slice(0, 10),
      wssi_score: Number(score.toFixed(1)),
      wssi_value: Number(((score - 50) / 20).toFixed(3)),
      wssi_delta: Number((Math.cos(idx / 5) * 0.8).toFixed(3)),
      trend: idx % 2 === 0 ? "up" : "down",
    };
  }),
};

const sampleAlerts = {
  generated_at: "2026-02-17T12:00:00Z",
  active_alerts: [
    {
      alert_id: "SMOKE_ALERT_1",
      title: "Sample warning",
      severity: "warning",
      timestamp: "2026-02-16T12:00:00Z",
      theme_ids: ["B"],
    },
  ],
};

const sampleNetwork = {
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

const samplePatterns = {
  generated_at: "2026-02-17T12:00:00Z",
  method: "weighted_cosine_overlap_penalty",
  current_vector_size: 12,
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
        penalty: 1,
        overlap: ["A.1", "B.1", "C.1", "X.1"],
        missing_indicators: []
      }
    }
  ]
};

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

    if (pathname === "/api/v1/wssi") {
      if (mode === "api") return sendJson(res, 200, sampleApi);
      return sendJson(res, 503, { error: "api_v1 unavailable in current mode" });
    }

    if (pathname === "/api/v1/themes") {
      if (mode === "api") return sendJson(res, 200, { themes: sampleApi.theme_signals });
      return sendJson(res, 503, { error: "themes unavailable" });
    }

    if (pathname === "/wssi/current") {
      if (mode === "legacy") return sendJson(res, 200, sampleLegacy);
      return sendJson(res, 503, { error: "legacy unavailable in current mode" });
    }

    if (pathname === "/api/v1/correlations") {
      if (mode === "api") return sendJson(res, 200, sampleCorrelations);
      return sendJson(res, 503, { error: "api correlations unavailable in current mode" });
    }

    if (pathname === "/api/v1/wssi/history") {
      if (mode === "api") return sendJson(res, 200, sampleHistory);
      return sendJson(res, 503, { error: "api history unavailable in current mode" });
    }

    if (pathname === "/api/v1/alerts") {
      if (mode === "api") return sendJson(res, 200, sampleAlerts);
      return sendJson(res, 503, { error: "api alerts unavailable in current mode" });
    }

    if (pathname === "/api/v1/network") {
      if (mode === "api") return sendJson(res, 200, sampleNetwork);
      return sendJson(res, 503, { error: "api network unavailable in current mode" });
    }

    if (pathname === "/api/v1/patterns") {
      if (mode === "api") return sendJson(res, 200, samplePatterns);
      return sendJson(res, 503, { error: "api patterns unavailable in current mode" });
    }

    if (pathname === "/correlations") {
      if (mode === "legacy") return sendJson(res, 200, sampleCorrelations);
      return sendJson(res, 503, { error: "legacy correlations unavailable in current mode" });
    }

    if (pathname === "/wssi/history") {
      if (mode === "legacy") return sendJson(res, 200, { data: sampleHistory.history, days: 90 });
      return sendJson(res, 503, { error: "legacy history unavailable in current mode" });
    }

    if (pathname === "/alerts") {
      if (mode === "legacy") return sendJson(res, 200, { alerts: sampleAlerts.active_alerts });
      return sendJson(res, 503, { error: "legacy alerts unavailable in current mode" });
    }

    if (pathname === "/network") {
      if (mode === "legacy") return sendJson(res, 200, sampleNetwork);
      return sendJson(res, 503, { error: "legacy network unavailable in current mode" });
    }

    if (pathname === "/patterns") {
      if (mode === "legacy") return sendJson(res, 200, samplePatterns);
      return sendJson(res, 503, { error: "legacy patterns unavailable in current mode" });
    }

    if (mode === "stale" && pathname === "/app/data/wssi-fallback.json") {
      return sendJson(res, 503, { error: "local fallback unavailable in stale mode" });
    }

    if (pathname.startsWith("/output/analytics/")) {
      if (mode === "stale") {
        return sendJson(res, 503, { error: "artifact unavailable in stale mode" });
      }
      if (pathname.endsWith("/patterns.json")) {
        return sendJson(res, 200, samplePatterns);
      }
      const relative = pathname.replace("/output/analytics/", "");
      return serveFile(res, path.join(analyticsRoot, relative));
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
        localStorage.setItem("wssi_api_key", "smoke-day6-key");
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

    // 1
    await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
    const hasBriefEntry = await page.locator('a.brief-entry:has-text("Open Brief Dashboard")').count();
    const hasPulseLinks = await page.locator('a[href*="pulse"]').count();
    out.push(result("1. Landing page brief-only", hasBriefEntry === 1 && hasPulseLinks === 0, `briefEntry=${hasBriefEntry}, pulseLinks=${hasPulseLinks}`));

    // 2
    await page.goto(`${base}/modes/pulse/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname.endsWith("/app/index.html"), { timeout: 8000 });
    out.push(result("2. Pulse route redirects to app", page.url().includes("/app/index.html"), page.url()));

    // 3
    consoleErrors.length = 0;
    pageErrors.length = 0;
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    await page.waitForSelector(".ledger-row");
    const sourceApi = await page.locator("#dataSourceLabel").innerText();
    const rowsApi = await page.locator(".ledger-row").count();
    out.push(result("3. Stress Ledger loads from API when available", sourceApi.includes("api-v1") && rowsApi >= 3, `source=${sourceApi}, rows=${rowsApi}`));
    const baselineConsoleErrors = [...consoleErrors];
    const baselinePageErrors = [...pageErrors];

    // 4
    await page.request.get(`${base}/__mode?set=legacy`);
    await page.click("#refreshButton");
    await page.waitForTimeout(700);
    const sourceLegacy = await page.locator("#dataSourceLabel").innerText();
    out.push(result("4. Fallback to /wssi/current when /api/v1/wssi fails", sourceLegacy.includes("legacy"), `source=${sourceLegacy}`));

    // 5
    await page.request.get(`${base}/__mode?set=artifact`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const sourceArtifact = await page.locator("#dataSourceLabel").innerText();
    out.push(result("5. Fallback to output analytics artifacts when API unavailable", sourceArtifact.includes("analytics-artifact"), `source=${sourceArtifact}`));

    // 6
    await page.request.get(`${base}/__mode?set=api`);
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const sortExpectations = {
      themeName: "Charlie Theme",
      zScore: "Bravo Theme",
      barRatio: "Charlie Theme",
      trendValue: "Charlie Theme",
      confidenceTier: "Charlie Theme",
      freshnessState: "Charlie Theme",
    };
    let sortPass = true;
    const sortDetails = [];
    for (const [key, expectedFirst] of Object.entries(sortExpectations)) {
      await page.click(`button.sort-button[data-sort="${key}"]`);
      await page.waitForTimeout(180);
      const firstTheme = (await page.locator(".ledger-row .theme-name").first().innerText()).trim();
      const ok = firstTheme === expectedFirst;
      sortDetails.push(`${key}:${firstTheme}`);
      if (!ok) sortPass = false;
    }
    out.push(result("6. Sorting works across all columns", sortPass, sortDetails.join(" | ")));

    // 7
    await page.locator(".ledger-row").first().click();
    const expansionVisible = await page.locator(".expansion-row:not([hidden]) .indicator-table").count();
    out.push(result("7. Row expansion shows indicator details", expansionVisible > 0, `visibleExpansionTables=${expansionVisible}`));

    // 8
    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    await page.request.get(`${base}/__mode?set=stale`);
    await page.click("#refreshButton");
    await page.waitForTimeout(1000);
    const staleVisible = await page.locator("#staleBadge:not(.hidden)").count();
    const staleText = staleVisible ? await page.locator("#staleBadge").innerText() : "";
    const has60s = intervalDelays.includes(60000);
    out.push(result("8. Auto-refresh configured at 60s + stale warning on failure", has60s && staleVisible > 0, `intervals=${JSON.stringify(intervalDelays)}, stale='${staleText}'`));

    // 9
    await page.setViewportSize({ width: 360, height: 800 });
    await page.request.get(`${base}/__mode?set=api`);
    await page.goto(`${base}/app/index.html`, { waitUntil: "networkidle" });
    const visibleHeaderCount = await page.$$eval(".ledger-table > thead > tr > th", (ths) =>
      ths.filter((th) => getComputedStyle(th).display !== "none").length
    );
    await page.locator(".ledger-row").first().click();
    const mobileExpansionVisible = await page.locator(".expansion-row:not([hidden]) .indicator-table").count();
    out.push(result("9. Mobile 360 collapses to 3 columns and keeps expansion", visibleHeaderCount === 3 && mobileExpansionVisible > 0, `visibleHeaders=${visibleHeaderCount}, expansion=${mobileExpansionVisible}`));

    // 10
    const noConsoleErrors = baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0;
    out.push(result("10. No JS console/runtime errors on load", noConsoleErrors, `consoleErrors=${baselineConsoleErrors.length}, pageErrors=${baselinePageErrors.length}`));

    // 11
    reqCtx = await request.newContext();
    const pageChecks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      pageChecks.push(`${p}:${resp.status()}`);
    }
    const allReachable = pageChecks.every((entry) => entry.endsWith(":200"));
    out.push(result("11. login/signup/pricing pages reachable", allReachable, pageChecks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY6_SMOKE_RESULTS_START");
    out.forEach((r) => {
      console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY6_SMOKE_RESULTS_END");

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
