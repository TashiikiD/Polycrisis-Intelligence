const elements = {
    tierBadge: document.getElementById("archiveTierBadge"),
    status: document.getElementById("archiveDataStatus"),
    rows: document.getElementById("archiveRows"),
    empty: document.getElementById("archiveEmptyState")
};
const DEFAULT_PUBLIC_API_BASE = "https://polycrisis-intelligence-production.up.railway.app";

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
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

function apiPath(path) {
    const fromStorage = String(readStorage("wssi_api_base_url") ?? "").trim().replace(/\/+$/, "");
    const host = String(window.location?.hostname ?? "").toLowerCase();
    const base = fromStorage || (host.endsWith("github.io") ? DEFAULT_PUBLIC_API_BASE : "");
    if (!base) return path;
    return `${base}${path}`;
}

function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString();
}

function formatWssi(score, value) {
    const scoreText = Number.isFinite(score) ? score.toFixed(1) : "--";
    const valueText = Number.isFinite(value) ? value.toFixed(2) : "--";
    return `Score ${scoreText} | Value ${valueText}`;
}

function setStatus(message, tone = "") {
    if (!elements.status) return;
    elements.status.classList.remove("is-error", "is-success");
    if (tone === "error") elements.status.classList.add("is-error");
    if (tone === "success") elements.status.classList.add("is-success");
    elements.status.textContent = message;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function lockTag(locked) {
    if (!locked) return "";
    return '<span class="lock-pill">Paid Locked</span>';
}

function releaseActions(release) {
    const free = release.links?.free;
    const paid = release.links?.paid;
    const freeView = free?.view_url
        ? `<a href="${escapeHtml(apiPath(free.view_url))}" target="_blank" rel="noopener">View Brief</a>`
        : '<span class="action-muted">Unavailable</span>';
    const freeModel = free?.model_url
        ? `<a href="${escapeHtml(apiPath(free.model_url))}" target="_blank" rel="noopener">Model JSON</a>`
        : '<span class="action-muted">Unavailable</span>';
    const paidView = paid?.view_url
        ? `<a href="${escapeHtml(apiPath(paid.view_url))}" target="_blank" rel="noopener">Paid Brief</a>`
        : '<span class="action-muted">Paid</span>';
    return `<div class="actions">${freeView}${freeModel}${paidView}</div>`;
}

function releaseHealth(release) {
    const quality = String(release?.data_quality ?? (release?.is_degraded ? "degraded" : "healthy")).toLowerCase();
    const missing = Array.isArray(release?.missing_sections) ? release.missing_sections : [];
    const stale = Array.isArray(release?.stale_sections) ? release.stale_sections : [];
    const label = quality === "degraded" ? "Degraded" : "Healthy";
    const tone = quality === "degraded" ? "health-degraded" : "health-healthy";
    const fragments = [];
    if (missing.length > 0) fragments.push(`Missing: ${missing.join(", ")}`);
    if (stale.length > 0) fragments.push(`Stale: ${stale.join(", ")}`);
    const detail = fragments.length > 0 ? `<div class="meta">${escapeHtml(fragments.join(" | "))}</div>` : "";
    return `<span class="health-pill ${tone}">${label}</span>${detail}`;
}

function renderReleaseRows(releases) {
    if (!elements.rows || !elements.empty) return;
    elements.rows.innerHTML = "";
    if (!Array.isArray(releases) || releases.length === 0) {
        elements.empty.classList.remove("hidden");
        return;
    }
    elements.empty.classList.add("hidden");
    const rowsHtml = releases.map((release) => {
        const summary = release.summary ?? {};
        const alertCounts = summary.alert_counts ?? {};
        return `
            <tr>
                <td>${escapeHtml(release.release_date ?? "--")}<div class="meta">${escapeHtml(formatTimestamp(release.published_at))}</div></td>
                <td>${escapeHtml(release.title ?? "Untitled")} ${lockTag(Boolean(release.locked_paid))}</td>
                <td>${escapeHtml(formatWssi(Number(release.wssi_score), Number(release.wssi_value)))}</td>
                <td>
                    <div>Stress: ${escapeHtml(summary.stress_level ?? "--")}</div>
                    <div class="meta">Alerts C/W/I: ${escapeHtml(alertCounts.critical ?? 0)}/${escapeHtml(alertCounts.warning ?? 0)}/${escapeHtml(alertCounts.info ?? 0)}</div>
                </td>
                <td>${releaseHealth(release)}</td>
                <td>${releaseActions(release)}</td>
            </tr>`;
    }).join("");
    elements.rows.innerHTML = rowsHtml;
}

async function loadArchive() {
    const tier = normalizeTier(readStorage("wssi_tier") ?? readStorage("tier") ?? readStorage("paywall_tier"));
    if (elements.tierBadge) elements.tierBadge.textContent = `Tier: ${tierLabel(tier)}`;

    const apiKey = String(readStorage("wssi_api_key") ?? readStorage("api_key") ?? "").trim();
    const headers = { Accept: "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;

    setStatus("Loading releases...");
    try {
        const response = await fetch(apiPath("/api/v1/briefs/releases?limit=50"), { headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload?.detail ?? {};
            const message = detail.message ?? `${response.status} ${response.statusText}`;
            throw new Error(message);
        }
        const viewerTier = normalizeTier(payload?.viewer?.tier ?? tier);
        if (elements.tierBadge) elements.tierBadge.textContent = `Tier: ${tierLabel(viewerTier)}`;
        const releases = Array.isArray(payload.releases) ? payload.releases : [];
        renderReleaseRows(releases);
        setStatus(`Loaded ${releases.length} release${releases.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
        renderReleaseRows([]);
        setStatus(`Archive load failed: ${error.message ?? "unknown error"}`, "error");
    }
}

loadArchive();
