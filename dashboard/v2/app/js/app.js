import { DashboardApiClient } from "./utils/api-client.js";
import { StressLedger } from "./components/stress-ledger.js";
import { CorrelationHeatmap } from "./components/correlation-heatmap.js";
import { WssiTimeline } from "./components/wssi-timeline.js";
import { ThemeDetailPanel } from "./components/theme-detail.js";
import { NetworkGraph } from "./components/network-graph.js";
import { AlertRegister } from "./components/alert-register.js";
import { PatternMatcher } from "./components/pattern-matcher.js";
import { buildFragilityBriefModel } from "./utils/report-model.js";
import { exportFragilityBriefPdf } from "./utils/report-exporter.js";

const TAB_ORDER = ["ledger", "correlations", "network", "patterns", "timeline"];
const FREE_THEME_LIMIT = 5;

const apiClient = new DashboardApiClient({ timeoutMs: 10000 });
const themeDetail = new ThemeDetailPanel(document.getElementById("themeDetailMount"));
const timeline = new WssiTimeline(document.getElementById("wssiTimelineMount"));
const network = new NetworkGraph(document.getElementById("networkGraphMount"), {
    onThemeSelect: (themeId) => themeDetail.selectTheme(themeId)
});
const patternMatcher = new PatternMatcher(document.getElementById("patternMatcherMount"));

const ledger = new StressLedger(document.getElementById("stressLedgerMount"), {
    onThemeSelect: (themeId) => themeDetail.selectTheme(themeId)
});

const heatmap = new CorrelationHeatmap(document.getElementById("correlationHeatmapMount"), {
    onPairSelect: (pair) => themeDetail.setPairContext(pair)
});

const alertRegister = new AlertRegister(document.getElementById("alertRegisterMount"), {
    onAlertSelect: (record) => {
        const timelineMatched = timeline.focusByAlert(record);
        const networkMatched = network.highlightThemes(record.themeIds);
        if (record.themeIds.length > 0) themeDetail.selectTheme(record.themeIds[0]);
        return { timelineMatched, networkMatched };
    }
});

const elements = {
    wssiValue: document.getElementById("wssiValue"),
    wssiScore: document.getElementById("wssiScore"),
    calculationTime: document.getElementById("calculationTime"),
    rowCount: document.getElementById("rowCount"),
    sourceLabel: document.getElementById("dataSourceLabel"),
    staleBadge: document.getElementById("staleBadge"),
    lastRefresh: document.getElementById("lastRefresh"),
    refreshButton: document.getElementById("refreshButton"),
    exportBriefButton: document.getElementById("exportBriefButton"),
    exportBriefStatus: document.getElementById("exportBriefStatus"),
    publishBriefButton: document.getElementById("publishBriefButton"),
    publishBriefStatus: document.getElementById("publishBriefStatus"),
    publishBriefArchiveLink: document.getElementById("publishBriefArchiveLink"),
    briefRenderHost: document.getElementById("fragilityBriefRenderHost"),
    errorMessage: document.getElementById("errorMessage"),
    accessBadge: document.getElementById("accessBadge"),
    upgradeLink: document.getElementById("upgradeLink"),
    accessNotice: document.getElementById("accessNotice"),
    sideRail: document.querySelector(".side-rail"),
    tabList: document.getElementById("dashboardTabList"),
    tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
    tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
    panelStatus: {
        stressLedger: document.getElementById("stressLedgerPanelStatus"),
        correlation: document.getElementById("correlationPanelStatus"),
        timeline: document.getElementById("timelinePanelStatus"),
        network: document.getElementById("networkPanelStatus"),
        alerts: document.getElementById("alertsPanelStatus"),
        patterns: document.getElementById("patternsPanelStatus")
    }
};

const panelStatusMessages = {
    stressLedger: "",
    correlation: "",
    timeline: "",
    network: "",
    alerts: "",
    patterns: ""
};

const lastSuccessful = {
    snapshot: null,
    correlations: null,
    timeline: null,
    alerts: null,
    network: null,
    patterns: null
};

let refreshInterval = null;
let activeTab = "ledger";
let authState = loadAuthState();
let briefPublishToken = "";
let refreshToken = 0;
apiClient.setAuth(authState);

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function apiPath(path) {
    const base = String(readStorage("wssi_api_base_url") ?? "").trim().replace(/\/+$/, "");
    if (!base) return path;
    return `${base}${path}`;
}

function normalizeTier(value) {
    const tier = String(value ?? "").trim().toLowerCase();
    if (tier === "developer") return "basic";
    if (tier === "professional" || tier === "premium") return "pro";
    return ["free", "basic", "pro", "enterprise"].includes(tier) ? tier : "free";
}

function tierLabel(tier) {
    if (tier === "basic") return "Basic";
    if (tier === "pro") return "Pro";
    if (tier === "enterprise") return "Enterprise";
    return "Free";
}

function isPaidTier(tier) {
    return tier === "basic" || tier === "pro" || tier === "enterprise";
}

function loadAuthState() {
    const apiKey = String(readStorage("wssi_api_key") ?? readStorage("api_key") ?? "").trim();
    const tier = normalizeTier(readStorage("wssi_tier") ?? readStorage("tier") ?? readStorage("paywall_tier"));
    return { apiKey, tier };
}

function loadBriefPublishToken() {
    return String(readStorage("wssi_brief_publish_token") ?? "").trim();
}

function formatTimestamp(value) {
    if (!value) return "--";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "--";
    return dt.toLocaleString();
}

function normalizeTab(value) {
    const cleaned = String(value ?? "").trim().toLowerCase();
    return TAB_ORDER.includes(cleaned) ? cleaned : "ledger";
}

function resolveHashRoute(hashValue) {
    const cleaned = String(hashValue ?? "").replace(/^#/, "").trim().toLowerCase();
    return {
        tabId: normalizeTab(cleaned),
        isValid: TAB_ORDER.includes(cleaned)
    };
}

function updateHash(tabId) {
    const target = `#${tabId}`;
    if (window.location.hash !== target) window.location.hash = target;
}

function setPanelStatus(panelKey, message) {
    panelStatusMessages[panelKey] = message || "";
    const el = elements.panelStatus[panelKey];
    if (!el) return;
    if (!message) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    el.classList.remove("hidden");
    el.textContent = message;
}

function setExportStatus(message, tone = "") {
    const el = elements.exportBriefStatus;
    if (!el) return;
    el.classList.remove("is-error", "is-warning", "is-success");
    if (!message) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    if (tone === "error") el.classList.add("is-error");
    else if (tone === "warning") el.classList.add("is-warning");
    else if (tone === "success") el.classList.add("is-success");
    el.classList.remove("hidden");
    el.textContent = message;
}

function setPublishStatus(message, tone = "") {
    const el = elements.publishBriefStatus;
    if (!el) return;
    el.classList.remove("is-error", "is-warning", "is-success");
    if (!message) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    if (tone === "error") el.classList.add("is-error");
    else if (tone === "warning") el.classList.add("is-warning");
    else if (tone === "success") el.classList.add("is-success");
    el.classList.remove("hidden");
    el.textContent = message;
}

function updatePublishControls(options = {}) {
    briefPublishToken = loadBriefPublishToken();
    const visible = Boolean(briefPublishToken);
    if (elements.publishBriefButton) {
        elements.publishBriefButton.classList.toggle("hidden", !visible);
        elements.publishBriefButton.disabled = !visible;
    }
    if (!options.preserveStatus && !visible) {
        setPublishStatus("");
        elements.publishBriefArchiveLink?.classList.add("hidden");
    }
}

function canExportBrief() {
    return Boolean(lastSuccessful.snapshot);
}

function updateExportAvailability(options = {}) {
    const hasData = canExportBrief();
    if (elements.exportBriefButton) elements.exportBriefButton.disabled = !hasData;
    if (options.preserveStatus) return;
    if (!hasData) {
        setExportStatus("Export unavailable until first successful data refresh.", "warning");
        return;
    }
    if (!isPaidTier(authState.tier)) {
        setExportStatus("Free-tier export includes limited sections and upgrade placeholders.", "warning");
    } else {
        setExportStatus("");
    }
}

function setStaleState(isStale, message = "") {
    if (!isStale) {
        elements.staleBadge.classList.add("hidden");
        elements.staleBadge.textContent = "";
        return;
    }
    elements.staleBadge.classList.remove("hidden");
    elements.staleBadge.textContent = message || "Data stale";
}

function setError(message) {
    if (!message) {
        elements.errorMessage.classList.add("hidden");
        elements.errorMessage.textContent = "";
        return;
    }
    elements.errorMessage.classList.remove("hidden");
    elements.errorMessage.textContent = message;
}

function markStaleOrUnavailable(panelKey, dataKey) {
    if (lastSuccessful[dataKey]) {
        setPanelStatus(panelKey, `Stale · last good ${formatTimestamp(lastSuccessful[dataKey].fetchedAt)}`);
    } else {
        setPanelStatus(panelKey, "Unavailable");
    }
}

function applyTimelineData() {
    timeline.setData(lastSuccessful.timeline, lastSuccessful.alerts);
}

function limitRowsForFree(rows) {
    const ranked = [...rows];
    ranked.sort((a, b) => {
        const stressDiff = DashboardApiClient.getStressRank(b.stressLevel) - DashboardApiClient.getStressRank(a.stressLevel);
        if (stressDiff !== 0) return stressDiff;
        const bAbs = typeof b.zScore === "number" ? Math.abs(b.zScore) : -1;
        const aAbs = typeof a.zScore === "number" ? Math.abs(a.zScore) : -1;
        if (bAbs !== aAbs) return bAbs - aAbs;
        return String(a.themeName).localeCompare(String(b.themeName));
    });
    return ranked.slice(0, FREE_THEME_LIMIT);
}

function updateSummary(snapshot, rowCountOverride = null) {
    const wssiValue = snapshot.wssiValue;
    const wssiScore = snapshot.wssiScore;
    const rowCount = Number.isInteger(rowCountOverride) ? rowCountOverride : snapshot.rows.length;

    elements.wssiValue.textContent = typeof wssiValue === "number" ? wssiValue.toFixed(2) : "--";
    elements.wssiValue.classList.remove("negative", "positive");
    if (typeof wssiValue === "number") elements.wssiValue.classList.add(wssiValue < 0 ? "negative" : "positive");

    elements.wssiScore.textContent = typeof wssiScore === "number" ? wssiScore.toFixed(1) : "--";
    elements.calculationTime.textContent = formatTimestamp(snapshot.calculationTimestamp);
    elements.rowCount.textContent = String(rowCount);
    elements.sourceLabel.textContent = `Source (WSSI): ${snapshot.source}`;
    elements.lastRefresh.textContent = formatTimestamp(snapshot.fetchedAt);
}

function applyTabState(tabId) {
    activeTab = tabId;
    elements.tabButtons.forEach((button) => {
        const isActive = !button.classList.contains("hidden") && button.dataset.tab === tabId;
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
        button.classList.toggle("is-active", isActive);
    });

    elements.tabPanels.forEach((panel) => {
        const isActive = panel.dataset.tabPanel === tabId;
        panel.classList.toggle("hidden", !isActive);
    });
}

function setAccessUI() {
    const tier = normalizeTier(authState.tier);
    const paid = isPaidTier(tier);
    elements.accessBadge.textContent = `Tier: ${tierLabel(tier)}`;
    elements.upgradeLink.classList.toggle("hidden", paid);
    elements.accessNotice.classList.toggle("hidden", paid);
    if (!paid) {
        elements.accessNotice.textContent = "Free tier: showing WSSI summary + top 5 stress themes. Upgrade to unlock correlations, network, patterns, timeline, alerts, and theme detail.";
    } else {
        elements.accessNotice.textContent = "";
    }
}

function applyAccessGating() {
    const paid = isPaidTier(authState.tier);
    elements.tabButtons.forEach((button) => {
        const tabId = normalizeTab(button.dataset.tab);
        const allowed = paid || tabId === "ledger";
        button.classList.toggle("hidden", !allowed);
        button.disabled = !allowed;
        button.setAttribute("aria-disabled", allowed ? "false" : "true");
    });
    elements.sideRail?.classList.toggle("hidden", !paid);
    if (!paid && activeTab !== "ledger") {
        setActiveTab("ledger");
    }
    updateExportAvailability();
}

function setActiveTab(nextTabId, options = {}) {
    const requestedTab = normalizeTab(nextTabId);
    let tabId = requestedTab;
    const forcedLedger = !isPaidTier(authState.tier) && requestedTab !== "ledger";
    if (forcedLedger) tabId = "ledger";
    applyTabState(tabId);
    if (options.updateHash !== false || forcedLedger) updateHash(tabId);
}

function focusTabByOffset(offset) {
    const available = elements.tabButtons.filter((button) => !button.classList.contains("hidden"));
    const currentIndex = available.findIndex((button) => button.dataset.tab === activeTab);
    const nextIndex = (Math.max(0, currentIndex) + offset + available.length) % available.length;
    const button = available[nextIndex];
    if (!button) return;
    setActiveTab(button.dataset.tab);
    button.focus();
}

function bindTabRouting() {
    elements.tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.disabled) return;
            setActiveTab(button.dataset.tab);
        });
    });

    elements.tabList?.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) return;
        if (event.key === "ArrowRight") {
            event.preventDefault();
            focusTabByOffset(1);
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            focusTabByOffset(-1);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            const first = elements.tabButtons.find((button) => !button.classList.contains("hidden"));
            if (first) {
                setActiveTab(first.dataset.tab);
                first.focus();
            }
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            const visible = elements.tabButtons.filter((button) => !button.classList.contains("hidden"));
            const last = visible[visible.length - 1];
            if (last) {
                setActiveTab(last.dataset.tab);
                last.focus();
            }
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            const focused = document.activeElement;
            if (focused?.dataset?.tab && !focused.disabled) {
                event.preventDefault();
                setActiveTab(focused.dataset.tab);
            }
        }
    });

    window.addEventListener("hashchange", () => {
        const route = resolveHashRoute(window.location.hash);
        setActiveTab(route.tabId, { updateHash: !route.isValid });
    });

    const initialRoute = resolveHashRoute(window.location.hash);
    setActiveTab(initialRoute.tabId, { updateHash: !initialRoute.isValid });
}

function syncAuthStateIfChanged() {
    const next = loadAuthState();
    const nextPublishToken = loadBriefPublishToken();
    const tokenChanged = nextPublishToken !== briefPublishToken;
    if (next.apiKey === authState.apiKey && next.tier === authState.tier && !tokenChanged) return;
    authState = next;
    apiClient.setAuth(authState);
    setAccessUI();
    applyAccessGating();
    updatePublishControls({ preserveStatus: true });
    if (tokenChanged) {
        setPublishStatus("Publish token updated. Ready to publish release.", "success");
    }
    refreshDashboard();
}

async function refreshFreeDashboard() {
    lastSuccessful.correlations = null;
    lastSuccessful.timeline = null;
    lastSuccessful.alerts = null;
    lastSuccessful.network = null;
    lastSuccessful.patterns = null;

    setPanelStatus("stressLedger", "");
    setPanelStatus("correlation", "");
    setPanelStatus("timeline", "");
    setPanelStatus("network", "");
    setPanelStatus("alerts", "");
    setPanelStatus("patterns", "");
    heatmap.setSnapshot(null);
    timeline.setData(null, null);
    network.setSnapshot(null);
    patternMatcher.setSnapshot(null);
    alertRegister.setSnapshot({ records: [], annotations: [] });

    const snapshotResult = await Promise.allSettled([apiClient.getDashboardSnapshot()]);
    const item = snapshotResult[0];
    if (item.status === "fulfilled") {
        const snapshot = item.value;
        const limitedRows = limitRowsForFree(snapshot.rows);
        lastSuccessful.snapshot = { ...snapshot, rows: limitedRows };
        updateSummary(snapshot, limitedRows.length);
        ledger.setRows(limitedRows);
        themeDetail.setThemes(limitedRows);
        heatmap.setThemeMetrics(limitedRows);
        network.setThemeMetrics(limitedRows);
        setStaleState(false);
        setError("");
        updateExportAvailability();
        return;
    }

    setStaleState(true, "Data stale (WSSI fetch failed)");
    setError(`WSSI snapshot: ${item.reason?.message ?? "unknown failure"}`);
    if (lastSuccessful.snapshot) {
        updateSummary(lastSuccessful.snapshot, lastSuccessful.snapshot.rows.length);
        ledger.setRows(lastSuccessful.snapshot.rows);
    }
    updateExportAvailability();
}

async function refreshPaidDashboard() {
    const failures = [];
    const requests = await Promise.allSettled([
        apiClient.getDashboardSnapshot(),
        apiClient.getCorrelationSnapshot(),
        apiClient.getTimelineSnapshot(90),
        apiClient.getAlertsSnapshot(),
        apiClient.getNetworkSnapshot(),
        apiClient.getPatternSnapshot()
    ]);

    const [snapshotResult, correlationResult, timelineResult, alertsResult, networkResult, patternResult] = requests;

    if (snapshotResult.status === "fulfilled") {
        lastSuccessful.snapshot = snapshotResult.value;
        updateSummary(lastSuccessful.snapshot);
        ledger.setRows(lastSuccessful.snapshot.rows);
        heatmap.setThemeMetrics(lastSuccessful.snapshot.rows);
        themeDetail.setThemes(lastSuccessful.snapshot.rows);
        network.setThemeMetrics(lastSuccessful.snapshot.rows);
        setPanelStatus("stressLedger", "");
    } else {
        failures.push(`WSSI snapshot: ${snapshotResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("stressLedger", "snapshot");
    }

    if (correlationResult.status === "fulfilled") {
        lastSuccessful.correlations = correlationResult.value;
        heatmap.setSnapshot(lastSuccessful.correlations);
        setPanelStatus("correlation", "");
    } else {
        failures.push(`Correlations: ${correlationResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("correlation", "correlations");
        if (!lastSuccessful.correlations) heatmap.setSnapshot(null);
    }

    if (timelineResult.status === "fulfilled") {
        lastSuccessful.timeline = timelineResult.value;
        applyTimelineData();
        setPanelStatus("timeline", "");
    } else {
        failures.push(`Timeline: ${timelineResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("timeline", "timeline");
        if (!lastSuccessful.timeline) timeline.setData(null, null);
        else applyTimelineData();
    }

    if (alertsResult.status === "fulfilled") {
        lastSuccessful.alerts = alertsResult.value;
        alertRegister.setSnapshot(lastSuccessful.alerts);
        applyTimelineData();
        setPanelStatus("alerts", "");
    } else {
        failures.push(`Alerts: ${alertsResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("alerts", "alerts");
        if (lastSuccessful.alerts) {
            alertRegister.setSnapshot(lastSuccessful.alerts);
            applyTimelineData();
        }
    }

    if (networkResult.status === "fulfilled") {
        lastSuccessful.network = networkResult.value;
        network.setSnapshot(lastSuccessful.network);
        if (lastSuccessful.snapshot) network.setThemeMetrics(lastSuccessful.snapshot.rows);
        setPanelStatus("network", "");
    } else {
        failures.push(`Network: ${networkResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("network", "network");
        if (!lastSuccessful.network) network.setSnapshot(null);
    }

    if (patternResult.status === "fulfilled") {
        lastSuccessful.patterns = patternResult.value;
        patternMatcher.setSnapshot(lastSuccessful.patterns);
        setPanelStatus("patterns", "");
    } else {
        failures.push(`Patterns: ${patternResult.reason?.message ?? "unknown failure"}`);
        markStaleOrUnavailable("patterns", "patterns");
        if (lastSuccessful.patterns) patternMatcher.setSnapshot(lastSuccessful.patterns);
        else patternMatcher.setSnapshot(null);
    }

    if (failures.length > 0) {
        const staleMessage = lastSuccessful.snapshot
            ? `Data stale (${failures.length} source${failures.length > 1 ? "s" : ""} failed)`
            : "Data stale (no successful refresh yet)";
        setStaleState(true, staleMessage);
        setError(failures.join(" | "));
    } else {
        setStaleState(false);
        setError("");
    }
    updateExportAvailability();
}

async function refreshDashboard() {
    refreshToken += 1;
    const token = refreshToken;
    elements.refreshButton.disabled = true;
    try {
        if (!isPaidTier(authState.tier)) {
            await refreshFreeDashboard();
        } else {
            await refreshPaidDashboard();
        }
    } finally {
        elements.refreshButton.disabled = false;
    }
    if (token !== refreshToken) return;
}

function exportFileName() {
    const dt = new Date();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `the-fragility-brief-${dt.getFullYear()}-${month}-${day}.pdf`;
}

async function handleExportBrief() {
    if (!elements.exportBriefButton) return;
    if (!canExportBrief()) {
        updateExportAvailability();
        return;
    }
    if (!elements.briefRenderHost) {
        setExportStatus("Export unavailable: report render host missing.", "error");
        return;
    }

    elements.exportBriefButton.disabled = true;
    setExportStatus("Preparing Fragility Brief export...", "");

    try {
        const model = buildFragilityBriefModel(lastSuccessful, authState, { panelStatus: panelStatusMessages });
        const result = await exportFragilityBriefPdf(model, {
            mountEl: elements.briefRenderHost,
            fileName: exportFileName(),
            allowPrintFallback: true,
            stylesheetHrefs: ["css/report.css"]
        });
        if (result.method === "pdf") {
            setExportStatus("Fragility Brief PDF downloaded.", "success");
        } else {
            setExportStatus("PDF libraries unavailable. Opened print fallback.", "warning");
        }
    } catch (error) {
        setExportStatus(`Fragility Brief export failed: ${error.message ?? "unknown error"}`, "error");
    } finally {
        if (elements.exportBriefButton) elements.exportBriefButton.disabled = false;
    }
}

async function handlePublishBriefRelease() {
    if (!elements.publishBriefButton) return;
    if (!briefPublishToken) {
        setPublishStatus("Publish token missing. Set localStorage.wssi_brief_publish_token.", "warning");
        updatePublishControls();
        return;
    }

    elements.publishBriefButton.disabled = true;
    setPublishStatus("Checking archive readiness...", "");
    elements.publishBriefArchiveLink?.classList.add("hidden");

    try {
        const authHeaders = { Accept: "application/json" };
        if (authState.apiKey) authHeaders["X-API-Key"] = authState.apiKey;

        const readinessResponse = await fetch(apiPath("/api/v1/briefs/releases/readiness"), {
            method: "GET",
            headers: authHeaders
        });
        const readinessPayload = await readinessResponse.json().catch(() => ({}));
        if (!readinessResponse.ok) {
            const detail = readinessPayload?.detail ?? {};
            const message = detail.message ?? `${readinessResponse.status} ${readinessResponse.statusText}`;
            throw new Error(`Readiness check failed: ${message}`);
        }
        if (readinessPayload.publish_blocked) {
            const coreMissing = Array.isArray(readinessPayload.core_missing) ? readinessPayload.core_missing : [];
            const blockedMessage = coreMissing.length > 0
                ? `Publish blocked: core data unavailable (${coreMissing.join(", ")}).`
                : "Publish blocked: core data unavailable.";
            setPublishStatus(blockedMessage, "error");
            return;
        }

        const readinessHealth = readinessPayload.publish_health ?? {};
        const readinessMissing = Array.isArray(readinessHealth.missing_sections) ? readinessHealth.missing_sections : [];
        const readinessStale = Array.isArray(readinessHealth.stale_sections) ? readinessHealth.stale_sections : [];
        if (readinessHealth.is_degraded) {
            const fragments = [];
            if (readinessMissing.length > 0) fragments.push(`missing: ${readinessMissing.join(", ")}`);
            if (readinessStale.length > 0) fragments.push(`stale: ${readinessStale.join(", ")}`);
            setPublishStatus(`Readiness is degraded (${fragments.join(" | ")}). Publishing with flags...`, "warning");
        } else {
            setPublishStatus("Readiness healthy. Publishing release...", "");
        }

        const publishHeaders = {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Brief-Publish-Token": briefPublishToken
        };
        if (authState.apiKey) publishHeaders["X-API-Key"] = authState.apiKey;
        const response = await fetch(apiPath("/api/v1/briefs/releases/publish"), {
            method: "POST",
            headers: publishHeaders,
            body: JSON.stringify({ created_by: "dashboard-admin", strict_mode: false })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload?.detail ?? {};
            const message = detail.message ?? payload.message ?? `${response.status} ${response.statusText}`;
            throw new Error(message);
        }
        const releaseId = payload?.release?.release_id ?? "unknown";
        const publishHealth = payload?.publish_health ?? {};
        const missingSections = Array.isArray(publishHealth.missing_sections) ? publishHealth.missing_sections : [];
        if (publishHealth.is_degraded) {
            const suffix = missingSections.length > 0 ? ` Missing sections: ${missingSections.join(", ")}.` : "";
            setPublishStatus(`Published degraded release ${releaseId}.${suffix}`, "warning");
        } else {
            setPublishStatus(`Published healthy release ${releaseId}.`, "success");
        }
        if (elements.publishBriefArchiveLink) {
            elements.publishBriefArchiveLink.href = "../archive/index.html";
            elements.publishBriefArchiveLink.classList.remove("hidden");
        }
    } catch (error) {
        setPublishStatus(`Publish failed: ${error.message ?? "unknown error"}`, "error");
    } finally {
        if (elements.publishBriefButton) elements.publishBriefButton.disabled = false;
    }
}

function init() {
    updatePublishControls();
    setAccessUI();
    applyAccessGating();
    bindTabRouting();
    elements.refreshButton.addEventListener("click", refreshDashboard);
    elements.exportBriefButton?.addEventListener("click", handleExportBrief);
    elements.publishBriefButton?.addEventListener("click", handlePublishBriefRelease);
    updateExportAvailability();
    refreshDashboard();

    refreshInterval = setInterval(() => {
        syncAuthStateIfChanged();
        refreshDashboard();
    }, 60000);

    window.addEventListener("storage", syncAuthStateIfChanged);
    window.addEventListener("focus", syncAuthStateIfChanged);
    window.addEventListener("beforeunload", () => {
        if (refreshInterval) clearInterval(refreshInterval);
    });
}

init();
