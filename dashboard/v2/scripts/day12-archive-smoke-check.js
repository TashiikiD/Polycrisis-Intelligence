const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, request } = require("playwright");

const v2Root = path.resolve(__dirname, "..");
const port = Number(process.env.DAY12_ARCHIVE_SMOKE_PORT || 5300);
const publishToken = "smoke-publish-token";
const paidApiKey = "smoke-paid-key";
const freeApiKey = "smoke-free-key";

let publishCount = 0;
let releases = [
  {
    release_id: "brief-20990218-120000-aa11",
    release_date: "2099-02-18",
    published_at: "2099-02-18T12:00:00Z",
    title: "The Fragility Brief (2099-02-18)",
    wssi_score: 67.4,
    wssi_value: 0.96,
    summary: {
      stress_level: "approaching",
      trend_label: "up +1.10",
      above_warning_count: 4,
      alert_counts: { critical: 1, warning: 2, info: 1 },
    },
    created_by: "seed",
    notes: "seed release",
    tier_variants: ["free", "paid"],
    is_degraded: true,
    missing_sections: ["correlations"],
    stale_sections: [],
    data_quality: "degraded",
  },
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

function releaseLinks(releaseId, isPaid) {
  return {
    free: {
      view_url: `/api/v1/briefs/releases/${releaseId}/view?variant=free`,
      model_url: `/api/v1/briefs/releases/${releaseId}/model?variant=free`,
    },
    paid: isPaid
      ? {
          view_url: `/api/v1/briefs/releases/${releaseId}/view?variant=paid`,
          model_url: `/api/v1/briefs/releases/${releaseId}/model?variant=paid`,
        }
      : null,
  };
}

function projectReleases(isPaid) {
  return releases
    .slice()
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .map((release) => ({
      ...release,
      links: releaseLinks(release.release_id, isPaid),
      locked_paid: !isPaid,
    }));
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || "GET";
    const apiKey = String(req.headers["x-api-key"] || "").trim();
    const isPaid = apiKey === paidApiKey;

    if (pathname === "/__publish_count") {
      return sendJson(res, 200, { publishCount });
    }

    if (pathname === "/api/v1/briefs/releases" && method === "GET") {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "50"), 200));
      const items = projectReleases(isPaid).slice(0, limit);
      return sendJson(res, 200, {
        releases: items,
        count: items.length,
        limit,
        viewer: {
          tier: isPaid ? "basic" : "free",
          is_paid: isPaid,
          authenticated: apiKey.length > 0,
        },
      });
    }

    if (pathname === "/api/v1/briefs/releases/readiness" && method === "GET") {
      return sendJson(res, 200, {
        status: "degraded",
        publish_blocked: false,
        core_missing: [],
        dataset_status: {
          "wssi-latest": { available: true, freshness: "fresh", section: "wssi_summary", core: true, source_path: "/app/data/analytics/wssi-latest.json" },
          alerts: { available: true, freshness: "fresh", section: "alerts", core: false, source_path: "/app/data/analytics/alerts.json" },
          correlations: { available: false, freshness: "unknown", section: "correlations", core: false, source_path: null },
          network: { available: true, freshness: "recent", section: "network", core: false, source_path: "/app/data/analytics/network.json" },
          patterns: { available: true, freshness: "recent", section: "patterns", core: false, source_path: "/app/data/analytics/patterns.json" },
          "wssi-history": { available: true, freshness: "recent", section: "timeline", core: false, source_path: "/app/data/analytics/wssi-history.json" },
        },
        publish_health: {
          is_degraded: true,
          missing_sections: ["correlations"],
          stale_sections: [],
          dataset_status: {},
        },
        generated_at: new Date().toISOString(),
      });
    }

    if (pathname === "/api/v1/briefs/releases/publish" && method === "POST") {
      const token = String(req.headers["x-brief-publish-token"] || "").trim();
      if (token !== publishToken) {
        return sendJson(res, 401, { detail: { code: "PUBLISH_TOKEN_INVALID", message: "Invalid brief publish token" } });
      }
      let bodyRaw = "";
      req.on("data", (chunk) => {
        bodyRaw += chunk.toString("utf-8");
      });
      req.on("end", () => {
        const body = bodyRaw ? JSON.parse(bodyRaw) : {};
        const releaseDate = String(body.release_date || "2099-02-19");
        const now = new Date().toISOString();
        const releaseId = `brief-${releaseDate.replaceAll("-", "")}-${Date.now()}`;
        const release = {
          release_id: releaseId,
          release_date: releaseDate,
          published_at: now,
          title: `The Fragility Brief (${releaseDate})`,
          wssi_score: 68.9,
          wssi_value: 1.03,
          summary: {
            stress_level: "approaching",
            trend_label: "up +0.90",
            above_warning_count: 5,
            alert_counts: { critical: 1, warning: 3, info: 2 },
          },
          created_by: body.created_by || "dashboard-admin",
          notes: body.notes || null,
          tier_variants: ["free", "paid"],
          is_degraded: true,
          missing_sections: ["correlations"],
          stale_sections: [],
          data_quality: "degraded",
        };
        releases.unshift(release);
        publishCount += 1;
        return sendJson(res, 200, {
          status: "published",
          release: {
            ...release,
            links: releaseLinks(releaseId, true),
            locked_paid: false,
          },
          archive_page_url: "/dashboard/v2/archive/index.html",
          variant_urls: releaseLinks(releaseId, true),
          publish_health: {
            is_degraded: true,
            missing_sections: ["correlations"],
            stale_sections: [],
            dataset_status: {},
          },
          strict_mode: false,
        });
      });
      return;
    }

    const viewMatch = pathname.match(/^\/api\/v1\/briefs\/releases\/([^/]+)\/view$/);
    if (viewMatch && method === "GET") {
      const releaseId = viewMatch[1];
      const variant = String(url.searchParams.get("variant") || "free").toLowerCase();
      const found = releases.find((item) => item.release_id === releaseId);
      if (!found) return sendJson(res, 404, { detail: { code: "RELEASE_NOT_FOUND", message: "Release not found" } });
      if (variant === "paid" && !isPaid) {
        const statusCode = apiKey ? 403 : 402;
        return sendJson(res, statusCode, { detail: { code: "UPGRADE_REQUIRED", message: "Paid tier required" } });
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html><body><h1>${found.title} (${variant})</h1></body></html>`);
      return;
    }

    const modelMatch = pathname.match(/^\/api\/v1\/briefs\/releases\/([^/]+)\/model$/);
    if (modelMatch && method === "GET") {
      const releaseId = modelMatch[1];
      const variant = String(url.searchParams.get("variant") || "free").toLowerCase();
      const found = releases.find((item) => item.release_id === releaseId);
      if (!found) return sendJson(res, 404, { detail: { code: "RELEASE_NOT_FOUND", message: "Release not found" } });
      if (variant === "paid" && !isPaid) {
        const statusCode = apiKey ? 403 : 402;
        return sendJson(res, statusCode, { detail: { code: "UPGRADE_REQUIRED", message: "Paid tier required" } });
      }
      return sendJson(res, 200, {
        generated_at: found.published_at,
        tier_context: { tier: variant === "paid" ? "paid" : "free" },
        wssi_summary: { wssi_score: found.wssi_score, wssi_value: found.wssi_value },
      });
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
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto(`${base}/app/index.html#ledger`, { waitUntil: "networkidle" });
    await page.waitForSelector("#publishBriefButton", { state: "attached" });
    const hiddenWithoutToken = await page.evaluate(() => {
      const button = document.getElementById("publishBriefButton");
      return button ? button.classList.contains("hidden") : false;
    });
    out.push(result("1. Publish button hidden by default without local token", hiddenWithoutToken, `hidden=${hiddenWithoutToken}`));

    await page.evaluate((state) => {
      localStorage.setItem("wssi_brief_publish_token", state.token);
      localStorage.setItem("wssi_tier", state.tier);
      localStorage.setItem("tier", state.tier);
      localStorage.setItem("wssi_api_key", state.apiKey);
    }, { token: publishToken, tier: "basic", apiKey: paidApiKey });
    await page.reload({ waitUntil: "networkidle" });
    const visibleWithToken = await page.evaluate(() => {
      const button = document.getElementById("publishBriefButton");
      return button ? !button.classList.contains("hidden") : false;
    });
    out.push(result("2. Publish button appears when local publish token is set", visibleWithToken, `visible=${visibleWithToken}`));

    await page.click("#publishBriefButton");
    await page.waitForTimeout(400);
    const publishState = await page.evaluate(() => ({
      status: document.getElementById("publishBriefStatus")?.textContent?.trim() || "",
      archiveLinkVisible: !document.getElementById("publishBriefArchiveLink")?.classList.contains("hidden"),
    }));
    out.push(result(
      "3. In-app publish action posts release and shows status + archive link",
      publishState.status.toLowerCase().includes("published") && publishState.status.toLowerCase().includes("degraded") && publishState.archiveLinkVisible,
      JSON.stringify(publishState)
    ));

    await page.evaluate((freeKey) => {
      localStorage.removeItem("wssi_api_key");
      localStorage.setItem("wssi_tier", "free");
      localStorage.setItem("tier", "free");
      localStorage.setItem("api_key", freeKey);
    }, freeApiKey);
    await page.goto(`${base}/archive/index.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const freeArchive = await page.evaluate(() => ({
      rowCount: document.querySelectorAll("#archiveRows tr").length,
      hasLockPill: document.querySelector("#archiveRows .lock-pill") !== null,
      hasPaidBriefAction: Array.from(document.querySelectorAll("#archiveRows .actions a")).some((a) => a.textContent.includes("Paid Brief")),
      hasHealthPill: document.querySelector("#archiveRows .health-pill") !== null,
    }));
    out.push(result(
      "4. Archive page loads free-tier list with paid links hidden/locked",
      freeArchive.rowCount > 0 && freeArchive.hasLockPill && !freeArchive.hasPaidBriefAction && freeArchive.hasHealthPill,
      JSON.stringify(freeArchive)
    ));

    await page.evaluate((apiKey) => {
      localStorage.setItem("wssi_api_key", apiKey);
      localStorage.setItem("wssi_tier", "basic");
      localStorage.setItem("tier", "basic");
    }, paidApiKey);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const paidArchive = await page.evaluate(() => ({
      tierBadge: document.getElementById("archiveTierBadge")?.textContent?.trim() || "",
      paidActionCount: Array.from(document.querySelectorAll("#archiveRows .actions a")).filter((a) => a.textContent.includes("Paid Brief")).length,
    }));
    out.push(result(
      "5. Paid-tier archive view exposes paid variant links",
      paidArchive.paidActionCount > 0 && paidArchive.tierBadge.toLowerCase().includes("basic"),
      JSON.stringify(paidArchive)
    ));

    reqCtx = await request.newContext();
    const readinessResp = await reqCtx.get(`${base}/api/v1/briefs/releases/readiness`);
    const readinessBody = await readinessResp.json();
    out.push(result(
      "6. Readiness endpoint reports state before publish workflow",
      readinessResp.status() === 200 && readinessBody.publish_blocked === false,
      `status=${readinessResp.status()} blocked=${String(readinessBody.publish_blocked)}`
    ));

    const latestReleaseId = releases[0].release_id;
    const unauthPaidView = await reqCtx.get(`${base}/api/v1/briefs/releases/${latestReleaseId}/view?variant=paid`);
    const paidView = await reqCtx.get(`${base}/api/v1/briefs/releases/${latestReleaseId}/view?variant=paid`, {
      headers: { "X-API-Key": paidApiKey },
    });
    out.push(result(
      "7. Paid variant endpoint enforces access control",
      [402, 403].includes(unauthPaidView.status()) && paidView.status() === 200,
      `unauth=${unauthPaidView.status()} paid=${paidView.status()}`
    ));

    out.push(result(
      "8. No runtime page exceptions during archive/publish interactions",
      pageErrors.length === 0,
      `console=${consoleErrors.length} page=${pageErrors.length}`
    ));

    const appResp = await reqCtx.get(`${base}/app/index.html`);
    const archiveResp = await reqCtx.get(`${base}/archive/index.html`);
    out.push(result(
      "9. App and archive routes are reachable",
      appResp.status() === 200 && archiveResp.status() === 200,
      `app=${appResp.status()} archive=${archiveResp.status()}`
    ));

    const failed = out.filter((item) => !item.pass);
    console.log("DAY12_ARCHIVE_SMOKE_RESULTS_START");
    out.forEach((item) => {
      console.log(`${item.pass ? "PASS" : "FAIL"} | ${item.name} | ${item.detail}`);
    });
    console.log(`SUMMARY | passed=${out.length - failed.length} failed=${failed.length}`);
    console.log("DAY12_ARCHIVE_SMOKE_RESULTS_END");
    process.exitCode = failed.length > 0 ? 1 : 0;
  } finally {
    if (reqCtx) await reqCtx.dispose();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
