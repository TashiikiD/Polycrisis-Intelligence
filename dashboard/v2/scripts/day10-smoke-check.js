const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY10_SMOKE_PORT || 4100);
let mode = "api";
let billingEnabled = true;

const users = new Map();
const keys = new Map();
let keyCounter = 0;

const RATE_LIMIT = {
  free: 0,
  basic: 1000,
  pro: 1000,
  enterprise: 999999999,
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function normalizeTier(value) {
  const tier = String(value || "").toLowerCase().trim();
  if (["free", "basic", "pro", "enterprise"].includes(tier)) return tier;
  if (tier === "developer") return "basic";
  if (tier === "professional") return "pro";
  return "free";
}

function createKey(tier, email = null) {
  keyCounter += 1;
  const normalized = normalizeTier(tier);
  const key = `wssi-${normalized}-smoke-${String(keyCounter).padStart(4, "0")}`;
  keys.set(key, { tier: normalized, email });
  return key;
}

function seedUsers() {
  const paidEmail = "paid-smoke@example.com";
  const freeEmail = "free-smoke@example.com";
  const paidKey = createKey("basic", paidEmail);
  const freeKey = createKey("free", freeEmail);
  users.set(paidEmail, { email: paidEmail, password: "ValidPass123", tier: "basic", key: paidKey });
  users.set(freeEmail, { email: freeEmail, password: "ValidPass123", tier: "free", key: freeKey });
}

seedUsers();

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

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function isoDateFromOffset(offsetDays) {
  const now = new Date("2026-02-17T00:00:00Z");
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function buildHistory(days) {
  const rows = [];
  let score = 52;
  for (let i = -days + 1; i <= 0; i += 1) {
    score += Math.sin(i / 6) * 1.8;
    score = Math.max(8, Math.min(94, score));
    rows.push({
      date: isoDateFromOffset(i),
      wssi_score: Number(score.toFixed(1)),
      wssi_value: Number(((score - 50) / 20).toFixed(3)),
      wssi_delta: Number((Math.cos(i / 4) * 0.6).toFixed(3)),
      trend: i % 2 === 0 ? "up" : "down",
    });
  }
  return rows;
}

const themeSignals = [
  { theme_id: "1.2", theme_name: "Corporate Debt Distress", category: "Economic-Financial", mean_z_score: 1.25, stress_level: "watch", momentum_30d: 0.22 },
  { theme_id: "2.1", theme_name: "Tipping Point Proximity", category: "Climate-Environmental", mean_z_score: 2.96, stress_level: "approaching", momentum_30d: 0.48 },
  { theme_id: "3.1", theme_name: "Interstate Conflict", category: "Geopolitical-Conflict", mean_z_score: -2.21, stress_level: "approaching", momentum_30d: -0.41 },
  { theme_id: "3.4", theme_name: "Governance Decay", category: "Geopolitical-Conflict", mean_z_score: -3.84, stress_level: "critical", momentum_30d: -0.66 },
  { theme_id: "4.2", theme_name: "Cyber Systemic Risk", category: "Technological", mean_z_score: 1.92, stress_level: "watch", momentum_30d: 0.27 },
  { theme_id: "5.2", theme_name: "Food System Fragility", category: "Biological-Health", mean_z_score: 2.54, stress_level: "approaching", momentum_30d: 0.33 },
  { theme_id: "6.1", theme_name: "Supply Chain Fragmentation", category: "Cross-System", mean_z_score: 1.48, stress_level: "watch", momentum_30d: 0.18 },
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
  ],
}));

const sampleApiWssi = {
  wssi_value: 0.92,
  wssi_score: 64.7,
  calculation_timestamp: "2026-02-17T12:00:00Z",
  theme_signals: themeSignals,
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

const sampleHistoryPayload = { generated_at: "2026-02-17T12:00:00Z", days: 90, history: buildHistory(90) };
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
  ],
  recent_alerts: [
    {
      alert_id: "THEME_WARNING_3.1_20260215",
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
      metadata: { alert_id: "THEME_WARNING_3.1_20260215", theme_ids: ["3.1"], trigger_value: -2.21 },
    },
  ],
};

const sampleNetworkPayload = {
  generated_at: "2026-02-17T12:00:00Z",
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
      diagnostics: { raw_cosine: 0.323362, penalty: 0.8, overlap: ["1.4.1", "3.1.1"], missing_indicators: ["2.2.1"] },
    },
    {
      episode_id: "episode_2022_energy_food",
      label: "2022 Energy-Food Crisis",
      period: "2022-02 to 2022-12",
      description: "Inflation and food-system stress driven by conflict and energy disruption.",
      similarity_pct: 12.1,
      confidence_tier: "low",
      required_overlap_min: 4,
      diagnostics: { raw_cosine: 0.16, penalty: 0.75, overlap: ["1.1.new2"], missing_indicators: ["5.2.1"] },
    },
  ],
};

function authFromHeader(req) {
  const key = req.headers["x-api-key"];
  if (!key || !keys.has(key)) return null;
  return keys.get(key);
}

function serveApiPayload(pathname) {
  if (pathname === "/api/v1/wssi") return sampleApiWssi;
  if (pathname === "/api/v1/themes") return { themes: sampleApiWssi.theme_signals };
  if (pathname === "/api/v1/correlations") return sampleCorrelationPayload;
  if (pathname === "/api/v1/wssi/history") return sampleHistoryPayload;
  if (pathname === "/api/v1/alerts") return sampleAlertsPayload;
  if (pathname === "/api/v1/network") return sampleNetworkPayload;
  if (pathname === "/api/v1/patterns") return samplePatternsPayload;
  return null;
}

function serveLegacyPayload(pathname) {
  if (pathname === "/wssi/current") return sampleApiWssi;
  if (pathname === "/correlations") return sampleCorrelationPayload;
  if (pathname === "/wssi/history") return { data: sampleHistoryPayload.history, days: 90 };
  if (pathname === "/alerts") return { alerts: [...sampleAlertsPayload.active_alerts, ...sampleAlertsPayload.recent_alerts] };
  if (pathname === "/network") return sampleNetworkPayload;
  if (pathname === "/patterns") return samplePatternsPayload;
  return null;
}

function createServer() {
  return http.createServer(async (req, res) => {
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

    if (pathname === "/__billing") {
      const enabled = url.searchParams.get("enabled");
      if (enabled !== null) billingEnabled = enabled === "1";
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`billingEnabled=${billingEnabled}`);
      return;
    }

    if (pathname === "/checkout-mock") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html><body><h1>Checkout Mock</h1><p>${url.searchParams.get("tier") || "unknown"}</p></body></html>`);
      return;
    }

    if (pathname.startsWith("/output/analytics/")) {
      if (mode === "stale" || mode === "local") return sendJson(res, 503, { error: "artifact unavailable" });
      if (pathname.endsWith("/wssi-latest.json")) return sendJson(res, 200, sampleApiWssi);
      if (pathname.endsWith("/correlations.json")) return sendJson(res, 200, sampleCorrelationPayload);
      if (pathname.endsWith("/wssi-history.json")) return sendJson(res, 200, sampleHistoryPayload);
      if (pathname.endsWith("/alerts.json")) return sendJson(res, 200, sampleAlertsPayload);
      if (pathname.endsWith("/network.json")) return sendJson(res, 200, sampleNetworkPayload);
      if (pathname.endsWith("/patterns.json")) return sendJson(res, 200, samplePatternsPayload);
      return sendJson(res, 404, { error: "artifact not found" });
    }

    if (mode === "stale" && pathname.startsWith("/app/data/")) {
      return sendJson(res, 503, { error: "local fallback unavailable in stale mode" });
    }

    if (req.method === "POST" && pathname === "/api/v1/auth/register") {
      const body = await parseJsonBody(req);
      const email = String(body.email || "").toLowerCase().trim();
      const password = String(body.password || "");
      if (!email.includes("@") || password.length < 8) {
        return sendJson(res, 422, { detail: { code: "INVALID_INPUT", message: "Valid email and password required" } });
      }
      const tier = normalizeTier(body.tier || "free");
      const existing = users.get(email);
      if (existing?.key) keys.delete(existing.key);
      const key = createKey(tier, email);
      users.set(email, { email, password, tier, key });
      return sendJson(res, 200, {
        message: "Account created",
        access_token: `legacy-${email}`,
        refresh_token: `legacy-refresh-${email}`,
        token_type: "bearer",
        api_key: key,
        tier,
        rate_limit: RATE_LIMIT[tier],
      });
    }

    if (req.method === "POST" && pathname === "/api/v1/auth/login") {
      const body = await parseJsonBody(req);
      const email = String(body.email || "").toLowerCase().trim();
      const password = String(body.password || "");
      const user = users.get(email);
      if (!user || user.password !== password) {
        return sendJson(res, 401, { detail: { code: "AUTH_INVALID", message: "Invalid email or password" } });
      }
      if (user.key) keys.delete(user.key);
      const newKey = createKey(user.tier, email);
      user.key = newKey;
      return sendJson(res, 200, {
        access_token: `legacy-login-${email}`,
        refresh_token: `legacy-refresh-login-${email}`,
        token_type: "bearer",
        tier: user.tier,
        rate_limit: RATE_LIMIT[user.tier],
        api_key: newKey,
        api_key_hint: `wssi-${user.tier}-***`,
      });
    }

    if (req.method === "POST" && pathname === "/api/v1/auth/key-login") {
      const body = await parseJsonBody(req);
      const key = String(body.api_key || "");
      const keyData = keys.get(key);
      if (!keyData) return sendJson(res, 401, { detail: { code: "AUTH_INVALID", message: "Invalid API key" } });
      return sendJson(res, 200, {
        tier: keyData.tier,
        rate_limit: RATE_LIMIT[keyData.tier],
        api_key_hint: `wssi-${keyData.tier}-***`,
        status: "active",
      });
    }

    if (pathname === "/api/v1/billing/config") {
      return sendJson(res, 200, {
        enabled: billingEnabled,
        tiers: {
          basic: { launch_price: 9, standard_price: 19, contact_sales: false },
          pro: { launch_price: 20, standard_price: 49, contact_sales: false },
          enterprise: { launch_price: 149, standard_price: 499, contact_sales: true },
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/v1/billing/checkout-session") {
      const body = await parseJsonBody(req);
      const tier = normalizeTier(body.tier || "free");
      const keyData = authFromHeader(req);
      if (!keyData) return sendJson(res, 401, { detail: { code: "AUTH_MISSING", message: "Valid API key is required to upgrade" } });
      if (tier === "enterprise") {
        return sendJson(res, 400, { detail: { code: "CONTACT_SALES_REQUIRED", message: "Enterprise upgrades are handled by sales" } });
      }
      if (!billingEnabled) {
        return sendJson(res, 503, { detail: { code: "BILLING_NOT_CONFIGURED", message: "Stripe is not configured yet" } });
      }
      return sendJson(res, 200, {
        session_id: `cs_test_${tier}`,
        checkout_url: `http://127.0.0.1:${port}/checkout-mock?tier=${tier}&session_id=cs_test_${tier}`,
      });
    }

    if (pathname.startsWith("/api/v1/")) {
      if (mode !== "api") return sendJson(res, 503, { error: "api unavailable" });
      const payload = serveApiPayload(pathname);
      if (payload) return sendJson(res, 200, payload);
      return sendJson(res, 404, { error: "not found" });
    }

    if (["/wssi/current", "/wssi/history", "/correlations", "/network", "/alerts", "/patterns"].includes(pathname)) {
      if (mode !== "legacy") return sendJson(res, 503, { error: "legacy unavailable" });
      const payload = serveLegacyPayload(pathname);
      if (payload) return sendJson(res, 200, payload);
      return sendJson(res, 404, { error: "not found" });
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
    await page.goto(`${base}/signup/index.html?plan=free`, { waitUntil: "networkidle" });
    await page.fill("#firstName", "Smoke");
    await page.fill("#lastName", "Free");
    await page.fill("#email", "free-e2e@example.com");
    await page.fill("#company", "Test Co");
    await page.fill("#password", "ValidPass123");
    await page.click("#submit-btn");
    await page.waitForURL("**/app/index.html#ledger", { timeout: 6000 });
    const freeStored = await page.evaluate(() => ({
      key: localStorage.getItem("wssi_api_key"),
      tier: localStorage.getItem("wssi_tier"),
    }));
    out.push(result("1. Signup provisions API key and routes to app shell", Boolean(freeStored.key) && freeStored.tier === "free", `tier=${freeStored.tier} key=${String(freeStored.key || "").slice(0, 12)}`));

    await page.waitForSelector(".ledger-row");
    const freeVisibleTabs = await page.locator('.tab-button:not(.hidden)').count();
    const freeSideRailHidden = await page.locator(".side-rail.hidden").count();
    const freeRows = await page.locator(".ledger-row").count();
    out.push(result("2. Free tier hard-gates tabs + side rail and caps ledger rows", freeVisibleTabs === 1 && freeSideRailHidden === 1 && freeRows > 0 && freeRows <= 5, `tabs=${freeVisibleTabs} sideRailHidden=${freeSideRailHidden} rows=${freeRows}`));
    const baselineConsoleErrors = [...consoleErrors];
    const baselinePageErrors = [...pageErrors];

    await page.goto(`${base}/app/index.html#timeline`, { waitUntil: "networkidle" });
    const freeActiveTab = await page.$eval('[role="tab"][aria-selected="true"]', (el) => el.getAttribute("data-tab"));
    const freeHash = await page.evaluate(() => window.location.hash);
    out.push(result("3. Free tier route normalization keeps ledger canonical", freeActiveTab === "ledger" && freeHash === "#ledger", `active=${freeActiveTab} hash=${freeHash}`));

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/login/index.html`, { waitUntil: "networkidle" });
    await page.fill("#email", "paid-smoke@example.com");
    await page.fill("#password", "ValidPass123");
    await page.click("#submit-btn");
    await page.waitForURL("**/app/index.html#ledger", { timeout: 6000 });
    await page.waitForSelector(".ledger-row");
    const paidStored = await page.evaluate(() => ({
      key: localStorage.getItem("wssi_api_key"),
      tier: localStorage.getItem("wssi_tier"),
    }));
    const paidVisibleTabs = await page.locator('.tab-button:not(.hidden)').count();
    const paidSideRailHidden = await page.locator(".side-rail.hidden").count();
    out.push(result("4. Password login issues API key and unlocks paid shell", Boolean(paidStored.key) && paidStored.tier === "basic" && paidVisibleTabs === 5 && paidSideRailHidden === 0, `tier=${paidStored.tier} tabs=${paidVisibleTabs} sideRailHidden=${paidSideRailHidden}`));

    await page.goto(`${base}/pricing/index.html`, { waitUntil: "networkidle" });
    await page.click('button[data-action="checkout"][data-tier="basic"]');
    await page.waitForURL("**/checkout-mock?tier=basic**", { timeout: 5000 });
    const checkoutUrl = page.url();
    out.push(result("5. Pricing basic CTA starts checkout session", checkoutUrl.includes("/checkout-mock?tier=basic"), checkoutUrl));

    await page.goto(`${base}/pricing/index.html`, { waitUntil: "networkidle" });
    const enterpriseHref = await page.getAttribute('a[href^="mailto:sales@polycrisis.io"]', "href");
    out.push(result("6. Enterprise is contact-sales-only", String(enterpriseHref || "").startsWith("mailto:sales@polycrisis.io"), enterpriseHref || "missing"));

    await page.request.get(`${base}/__billing?enabled=0`);
    await page.goto(`${base}/pricing/index.html`, { waitUntil: "networkidle" });
    await page.click('button[data-action="checkout"][data-tier="basic"]');
    await page.waitForTimeout(500);
    const billingMessage = await page.locator("#pricingMessage").innerText();
    out.push(result("7. Pricing degrades gracefully when Stripe is not configured", billingMessage.toLowerCase().includes("not configured"), billingMessage));

    await page.request.get(`${base}/__mode?set=stale`);
    await page.goto(`${base}/app/index.html#ledger`, { waitUntil: "networkidle" });
    await page.click("#refreshButton");
    await page.waitForTimeout(900);
    const staleVisible = await page.locator("#staleBadge:not(.hidden)").count();
    out.push(result("8. App shows stale state on refresh failures", staleVisible > 0, `staleVisible=${staleVisible}`));

    const intervalDelays = await page.evaluate(() => window.__intervalDelays || []);
    out.push(result("9. 60s global refresh timer remains active", intervalDelays.includes(60000), `intervals=${JSON.stringify(intervalDelays)}`));

    out.push(result("10. No JS console/runtime errors on baseline interactions", baselineConsoleErrors.length === 0 && baselinePageErrors.length === 0, `consoleErrors=${baselineConsoleErrors.length} pageErrors=${baselinePageErrors.length}`));

    const day9 = spawnSync("node", ["day9-smoke-check.js"], {
      cwd: __dirname,
      env: { ...process.env, DAY9_SMOKE_PORT: "4200", DAY8_SMOKE_PORT: "4300", DAY7_SMOKE_PORT: "4400", DAY6_SMOKE_PORT: "4500" },
      encoding: "utf-8",
    });
    const day9Summary = `${day9.stdout}\n${day9.stderr}`;
    const day9Pass = day9.status === 0 && /SUMMARY\s+\|\s+passed=20\s+failed=0/.test(day9Summary);
    out.push(result("11. Day 9 smoke suite passes unchanged", day9Pass, day9.status === 0 ? "status=0" : `status=${day9.status}`));

    reqCtx = await request.newContext();
    const checks = [];
    for (const p of ["/login/index.html", "/signup/index.html", "/pricing/index.html"]) {
      const resp = await reqCtx.get(`${base}${p}`);
      checks.push(`${p}:${resp.status()}`);
    }
    out.push(result("12. login/signup/pricing pages reachable", checks.every((entry) => entry.endsWith(":200")), checks.join(" | ")));

    const failed = out.filter((r) => !r.pass);
    console.log("DAY10_SMOKE_RESULTS_START");
    out.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`));
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY10_SMOKE_RESULTS_END");
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
