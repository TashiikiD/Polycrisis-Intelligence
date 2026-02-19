const STRESS_LEVELS = ["stable", "watch", "approaching", "critical", "unknown"];
const STRESS_RANK = { unknown: 0, stable: 1, watch: 2, approaching: 3, critical: 4 };
const FRESHNESS_RANK = { unknown: 0, fresh: 1, recent: 2, warning: 3, stale: 4 };
const ALERT_SEVERITIES = ["critical", "warning", "info", "unknown"];
const ALERT_STATUSES = ["active", "resolved", "unknown"];
const EVIDENCE_LEVELS = ["established", "documented", "emerging", "unknown"];
const TIMELINE_BANDS = [
    { name: "stable", min: 0, max: 40 },
    { name: "elevated", min: 40, max: 60 },
    { name: "high", min: 60, max: 75 },
    { name: "critical", min: 75, max: 101 }
];
const DEFAULT_PUBLIC_API_BASE = "https://polycrisis-intelligence-production.up.railway.app";

function readStorageSafe(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function resolveApiBaseUrl() {
    const fromStorage = String(readStorageSafe("wssi_api_base_url") ?? "").trim().replace(/\/+$/, "");
    if (fromStorage) return fromStorage;
    if (typeof window !== "undefined") {
        const host = String(window.location?.hostname ?? "").toLowerCase();
        if (host.endsWith("github.io")) return DEFAULT_PUBLIC_API_BASE;
    }
    return "";
}

const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseDate(value) {
    if (!value) return null;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(value.trim())) {
        const utc = new Date(value.trim().replace(" ", "T") + "Z");
        if (!Number.isNaN(utc.getTime())) return utc;
    }
    return null;
}

const toTimestampMs = (value) => {
    const dt = parseDate(value);
    return dt ? dt.getTime() : null;
};

const toIsoDate = (value) => {
    const dt = parseDate(value);
    return dt ? dt.toISOString().slice(0, 10) : null;
};

function relativeTimeLabel(timestampMs) {
    if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return "Unknown";
    const diffMs = Date.now() - timestampMs;
    const absMs = Math.abs(diffMs);
    if (absMs < 60000) return diffMs >= 0 ? "<1m ago" : "in <1m";
    if (absMs < 3600000) {
        const mins = Math.round(absMs / 60000);
        return diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
    }
    if (absMs < 86400000) {
        const hrs = Math.round(absMs / 3600000);
        return diffMs >= 0 ? `${hrs}h ago` : `in ${hrs}h`;
    }
    const days = Math.round(absMs / 86400000);
    return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
}

function normalizeStressLevel(rawStress, zScore) {
    const text = typeof rawStress === "string" ? rawStress.trim().toLowerCase() : "";
    if (STRESS_LEVELS.includes(text)) return text;
    if (text === "elevated") return "watch";
    if (text === "high") return "approaching";
    if (zScore === null) return "unknown";
    const absZ = Math.abs(zScore);
    if (absZ >= 3) return "critical";
    if (absZ >= 2) return "approaching";
    if (absZ >= 1) return "watch";
    return "stable";
}

function normalizeTrend(momentum) {
    const value = toNumber(momentum);
    if (value === null) return { trendValue: null, trendLabel: "No 30d momentum", trendArrow: "-" };
    if (value > 0) return { trendValue: value, trendLabel: `up +${value.toFixed(2)} (30d)`, trendArrow: "up" };
    if (value < 0) return { trendValue: value, trendLabel: `down ${value.toFixed(2)} (30d)`, trendArrow: "down" };
    return { trendValue: 0, trendLabel: "flat 0.00 (30d)", trendArrow: "flat" };
}

function normalizeFreshness(rawFreshness, timestamp) {
    const val = typeof rawFreshness === "string" ? rawFreshness.trim().toLowerCase() : "";
    const dt = parseDate(timestamp);
    const ageHours = dt ? (Date.now() - dt.getTime()) / 3600000 : null;
    let state = "unknown";
    if (["live", "fresh"].includes(val)) state = "fresh";
    else if (val === "recent") state = "recent";
    else if (["warning", "old"].includes(val)) state = "warning";
    else if (["stale", "unavailable"].includes(val)) state = "stale";
    else if (ageHours !== null) {
        if (ageHours <= 6) state = "fresh";
        else if (ageHours <= 24) state = "recent";
        else if (ageHours <= 72) state = "warning";
        else state = "stale";
    }

    let label = "Unknown";
    if (state === "stale") label = "Stale";
    else if (ageHours !== null) {
        if (ageHours < 1) label = "<1h ago";
        else if (ageHours < 24) label = `${Math.floor(ageHours)}h ago`;
        else label = `${Math.floor(ageHours / 24)}d ago`;
    } else if (state !== "unknown") {
        label = state;
    }
    return { freshnessState: state, freshnessLabel: label };
}

function normalizeIndicator(indicator) {
    return {
        indicatorId: String(indicator.indicator_id ?? indicator.id ?? ""),
        name: String(indicator.name ?? indicator.indicator_name ?? "Unknown indicator"),
        source: String(indicator.source ?? "Unknown"),
        zScore: toNumber(indicator.z_score ?? indicator.stress_z_latest),
        momentum30d: toNumber(indicator.momentum_30d),
        freshness: String(indicator.freshness ?? "unknown"),
        qualityTier: String(indicator.quality_tier ?? "unknown")
    };
}

function extractThemeSignals(raw) {
    if (!raw) return [];
    if (Array.isArray(raw.theme_signals)) return raw.theme_signals;
    if (Array.isArray(raw.themes)) return raw.themes;
    if (Array.isArray(raw.themeSignals)) return raw.themeSignals;
    if (Array.isArray(raw.data?.theme_signals)) return raw.data.theme_signals;
    if (Array.isArray(raw.data?.themes)) return raw.data.themes;
    if (Array.isArray(raw)) return raw;
    return [];
}

function normalizeThemeSignal(signal, snapshotTimestamp) {
    const themeId = String(signal.theme_id ?? signal.id ?? signal.theme ?? signal.name ?? "unknown-theme");
    const themeName = String(signal.theme_name ?? signal.name ?? signal.theme ?? themeId);
    const category = String(signal.category ?? signal.domain ?? "Uncategorized");
    const zScore = toNumber(
        signal.mean_z_score ??
        signal.normalized_value ??
        signal.z_score ??
        signal.stress_z_latest ??
        (typeof signal.stress_level === "number" ? signal.stress_level : null)
    );
    const stressLevel = normalizeStressLevel(signal.stress_level ?? signal.risk_level, zScore);
    const trend = normalizeTrend(signal.momentum_30d);
    const indicatorDetailsRaw = Array.isArray(signal.indicator_details)
        ? signal.indicator_details
        : (Array.isArray(signal.indicators) ? signal.indicators : []);
    const indicatorDetails = indicatorDetailsRaw.map(normalizeIndicator);
    const indicatorFreshness = indicatorDetails.find((item) => item.freshness && item.freshness !== "unknown")?.freshness;
    const freshness = normalizeFreshness(signal.data_freshness ?? signal.freshness ?? indicatorFreshness, signal.last_updated ?? signal.updated_at ?? snapshotTimestamp);

    return {
        themeId,
        themeName,
        category,
        zScore,
        stressLevel,
        barRatio: zScore === null ? 0 : Math.min(Math.abs(zScore) / 3, 1),
        trendValue: trend.trendValue,
        trendLabel: trend.trendLabel,
        trendArrow: trend.trendArrow,
        confidenceTier: String(signal.confidence_tier ?? signal.quality_tier ?? "unknown"),
        qualityScore: toNumber(signal.quality_score),
        freshnessLabel: freshness.freshnessLabel,
        freshnessState: freshness.freshnessState,
        indicatorDetails
    };
}

function normalizeSnapshot(raw, source) {
    const calculationTimestamp =
        raw.calculation_timestamp ??
        raw.generated_at ??
        raw.timestamp ??
        raw.date ??
        raw.data?.calculation_timestamp ??
        raw.data?.timestamp ??
        null;
    const rows = extractThemeSignals(raw).map((signal) => normalizeThemeSignal(signal, calculationTimestamp));
    return {
        source,
        fetchedAt: new Date().toISOString(),
        calculationTimestamp,
        wssiValue: toNumber(raw.wssi_value ?? raw.value ?? raw.data?.wssi_value ?? raw.data?.overall_score),
        wssiScore: toNumber(raw.wssi_score ?? raw.score ?? raw.data?.wssi_score ?? raw.data?.overall_score),
        rows
    };
}

function pairKey(a, b) {
    const left = String(a);
    const right = String(b);
    return left < right ? `${left}::${right}` : `${right}::${left}`;
}

function normalizeCorrelationSnapshot(raw, source, themeCatalog) {
    const themeLevel = raw.theme_level ?? raw.themeLevel ?? raw.data?.theme_level ?? raw.data ?? {};
    const matrixRaw = themeLevel.matrix ?? raw.matrix ?? null;
    const pairsRaw = Array.isArray(themeLevel.pairs) ? themeLevel.pairs : (Array.isArray(raw.pairs) ? raw.pairs : []);
    const strongThreshold = toNumber(raw.strong_threshold ?? themeLevel.strong_threshold ?? raw.strongThreshold) ?? 0.6;
    const generatedAt = raw.generated_at ?? raw.generatedAt ?? raw.timestamp ?? null;
    const windowDays = toNumber(raw.window_days ?? themeLevel.window_days ?? raw.windowDays) ?? 90;

    const normalizedPairs = pairsRaw.map((rawPair) => {
        const rowThemeId = String(rawPair.theme_a ?? rawPair.row_theme_id ?? rawPair.rowThemeId ?? rawPair.themeA ?? "");
        const colThemeId = String(rawPair.theme_b ?? rawPair.col_theme_id ?? rawPair.colThemeId ?? rawPair.themeB ?? "");
        const pearsonR = toNumber(rawPair.pearson_r ?? rawPair.r ?? rawPair.value);
        return {
            rowThemeId,
            colThemeId,
            pearsonR,
            absR: pearsonR === null ? 0 : Math.abs(pearsonR),
            pValue: toNumber(rawPair.p_value ?? rawPair.p),
            sampleN: toNumber(rawPair.sample_n ?? rawPair.n),
            isSignificant: Boolean(rawPair.is_significant ?? rawPair.significant)
        };
    }).filter((pair) => pair.rowThemeId && pair.colThemeId);

    const matrixIds = matrixRaw ? Object.keys(matrixRaw) : [];
    const pairIds = new Set();
    normalizedPairs.forEach((pair) => {
        pairIds.add(pair.rowThemeId);
        pairIds.add(pair.colThemeId);
    });
    const allIds = new Set([...matrixIds, ...pairIds]);
    if (allIds.size === 0 && themeCatalog.size > 0) {
        themeCatalog.forEach((_, id) => allIds.add(id));
    }

    const orderedIds = [...allIds].sort((a, b) => {
        const aName = (themeCatalog.get(a)?.themeName ?? a).toLowerCase();
        const bName = (themeCatalog.get(b)?.themeName ?? b).toLowerCase();
        return aName.localeCompare(bName);
    });

    const pairMap = new Map();
    normalizedPairs.forEach((pair) => pairMap.set(pairKey(pair.rowThemeId, pair.colThemeId), pair));

    const cells = [];
    orderedIds.forEach((rowThemeId) => {
        orderedIds.forEach((colThemeId) => {
            let pearsonR = null;
            let pValue = null;
            let sampleN = null;
            let isSignificant = false;
            if (rowThemeId === colThemeId) {
                pearsonR = 1;
            } else {
                if (matrixRaw?.[rowThemeId]?.[colThemeId] !== undefined) pearsonR = toNumber(matrixRaw[rowThemeId][colThemeId]);
                else if (matrixRaw?.[colThemeId]?.[rowThemeId] !== undefined) pearsonR = toNumber(matrixRaw[colThemeId][rowThemeId]);
                const pair = pairMap.get(pairKey(rowThemeId, colThemeId));
                if (pair) {
                    if (pearsonR === null) pearsonR = pair.pearsonR;
                    pValue = pair.pValue;
                    sampleN = pair.sampleN;
                    isSignificant = pair.isSignificant;
                }
            }
            const absR = pearsonR === null ? 0 : Math.abs(pearsonR);
            const isStrong = absR >= strongThreshold && rowThemeId !== colThemeId;
            cells.push({
                rowThemeId,
                colThemeId,
                pearsonR,
                absR,
                pValue,
                sampleN,
                isSignificant,
                isStrong,
                patternLabel: isStrong ? "Emerging Pattern" : ""
            });
        });
    });

    const themes = orderedIds.map((themeId) => ({
        themeId,
        themeName: themeCatalog.get(themeId)?.themeName ?? themeId,
        category: themeCatalog.get(themeId)?.category ?? "Uncategorized"
    }));

    const pairs = normalizedPairs.map((pair) => ({
        ...pair,
        isStrong: pair.absR >= strongThreshold,
        patternLabel: pair.absR >= strongThreshold ? "Emerging Pattern" : ""
    }));

    return { source, fetchedAt: new Date().toISOString(), generatedAt, windowDays, strongThreshold, themes, cells, pairs };
}

function scoreBand(score) {
    if (score === null) return "unknown";
    const band = TIMELINE_BANDS.find((b) => score >= b.min && score < b.max);
    return band ? band.name : "unknown";
}

function normalizeTimelineSnapshot(raw, source, requestedDays) {
    const rawPoints = Array.isArray(raw.history) ? raw.history : (Array.isArray(raw.data) ? raw.data : (Array.isArray(raw.points) ? raw.points : []));
    const points = rawPoints.map((rawPoint) => {
        const date = String(rawPoint.date ?? rawPoint.day ?? rawPoint.timestamp ?? "");
        return {
            date,
            timestampMs: toTimestampMs(rawPoint.date ?? rawPoint.timestamp ?? rawPoint.calculation_timestamp) ?? 0,
            wssiScore: toNumber(rawPoint.wssi_score ?? rawPoint.score ?? rawPoint.risk_score),
            wssiValue: toNumber(rawPoint.wssi_value ?? rawPoint.value),
            wssiDelta: toNumber(rawPoint.wssi_delta ?? rawPoint.delta),
            trend: String(rawPoint.trend ?? "unknown"),
            band: scoreBand(toNumber(rawPoint.wssi_score ?? rawPoint.score ?? rawPoint.risk_score))
        };
    }).filter((point) => point.date).sort((a, b) => a.timestampMs - b.timestampMs);

    return {
        source,
        fetchedAt: new Date().toISOString(),
        generatedAt: raw.generated_at ?? raw.generatedAt ?? null,
        days: toNumber(raw.days ?? raw.count ?? requestedDays) ?? requestedDays,
        points,
        annotations: []
    };
}

const normalizeSeverity = (value) => {
    const v = String(value ?? "unknown").toLowerCase();
    return ALERT_SEVERITIES.includes(v) ? v : "unknown";
};

function normalizeStatus(value, bucket) {
    const v = String(value ?? "").toLowerCase();
    if (ALERT_STATUSES.includes(v)) return v;
    if (bucket === "active") return "active";
    if (bucket === "recent") return "resolved";
    return "unknown";
}

function alertIdOrComposite(rawAlert) {
    const explicit = String(rawAlert.alert_id ?? rawAlert.id ?? rawAlert.metadata?.alert_id ?? "").trim();
    if (explicit) return explicit;
    const title = String(rawAlert.title ?? rawAlert.message ?? "alert").toLowerCase().trim();
    const timestamp = String(rawAlert.created_at ?? rawAlert.timestamp ?? rawAlert.date ?? "").toLowerCase().trim();
    const severity = normalizeSeverity(rawAlert.severity ?? rawAlert.level);
    const themeId = String(rawAlert.theme_id ?? rawAlert.metadata?.theme_ids?.[0] ?? "").toLowerCase().trim();
    return `${title}::${timestamp}::${severity}::${themeId}`;
}

function normalizeAlertRecord(rawAlert, bucket = "unknown") {
    const createdAtRaw = rawAlert.created_at ?? rawAlert.timestamp ?? rawAlert.date ?? null;
    const createdAtMs = toTimestampMs(createdAtRaw);
    const createdAt = createdAtMs === null ? null : new Date(createdAtMs).toISOString();
    const themeIdsRaw = Array.isArray(rawAlert.theme_ids)
        ? rawAlert.theme_ids
        : (Array.isArray(rawAlert.metadata?.theme_ids) ? rawAlert.metadata.theme_ids : (rawAlert.theme_id ? [rawAlert.theme_id] : []));
    const themeIds = [...new Set(themeIdsRaw.map((id) => String(id)).filter(Boolean))];
    return {
        alertId: alertIdOrComposite(rawAlert),
        createdAt,
        createdAtMs,
        relativeTimeLabel: relativeTimeLabel(createdAtMs),
        title: String(rawAlert.title ?? rawAlert.message ?? "Alert"),
        description: String(rawAlert.description ?? rawAlert.message ?? "No description available."),
        category: String(rawAlert.category ?? rawAlert.alert_type ?? rawAlert.type ?? "unknown"),
        severity: normalizeSeverity(rawAlert.severity ?? rawAlert.level),
        status: normalizeStatus(rawAlert.status, bucket),
        themeIds,
        indicatorId: rawAlert.indicator_id ? String(rawAlert.indicator_id) : null,
        threshold: toNumber(rawAlert.threshold ?? rawAlert.metadata?.threshold ?? null),
        triggerValue: toNumber(rawAlert.trigger_value ?? rawAlert.metadata?.trigger_value ?? rawAlert.raw_value ?? rawAlert.z_score)
    };
}

function normalizeAlertsSnapshot(raw, source) {
    const active = Array.isArray(raw.active_alerts) ? raw.active_alerts : [];
    const recent = Array.isArray(raw.recent_alerts) ? raw.recent_alerts : [];
    const generic = Array.isArray(raw.alerts) ? raw.alerts : [];
    const merged = [
        ...active.map((alert) => ({ bucket: "active", alert })),
        ...recent.map((alert) => ({ bucket: "recent", alert })),
        ...generic.map((alert) => ({ bucket: "unknown", alert }))
    ];

    const deduped = new Map();
    merged.forEach((item) => {
        const record = normalizeAlertRecord(item.alert, item.bucket);
        if (!deduped.has(record.alertId)) deduped.set(record.alertId, record);
    });

    const records = [...deduped.values()].sort((a, b) => (b.createdAtMs ?? Number.NEGATIVE_INFINITY) - (a.createdAtMs ?? Number.NEGATIVE_INFINITY));
    const annotations = records.map((record) => ({
        alertId: record.alertId,
        date: toIsoDate(record.createdAt) ?? "unknown",
        severity: record.severity,
        title: record.title,
        themeIds: record.themeIds
    }));

    return { source, fetchedAt: new Date().toISOString(), generatedAt: raw.generated_at ?? raw.generatedAt ?? null, annotations, records };
}

const normalizeEvidence = (value) => {
    const v = String(value ?? "unknown").toLowerCase();
    return EVIDENCE_LEVELS.includes(v) ? v : "unknown";
};

function fallbackRingCoordinate(nodeId, index, total, axis) {
    const size = Math.max(1, total);
    let hash = 0;
    String(nodeId).split("").forEach((char) => {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    });
    const angle = ((index + Math.abs(hash % size)) / size) * Math.PI * 2;
    const radius = 320 + (Math.abs(hash) % 90);
    const cx = 500;
    const cy = 360;
    return axis === "x"
        ? Math.round(cx + (Math.cos(angle) * radius))
        : Math.round(cy + (Math.sin(angle) * radius));
}

function normalizeNetworkSnapshot(raw, source) {
    const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : (Array.isArray(raw.data?.nodes) ? raw.data.nodes : []);
    const edgesRaw = Array.isArray(raw.edges) ? raw.edges : (Array.isArray(raw.data?.edges) ? raw.data.edges : []);
    const metricsByNodeId = Object.fromEntries(
        Object.entries(raw.metrics ?? raw.data?.metrics ?? {}).map(([id, metric]) => {
            const normalized = {};
            Object.entries(metric ?? {}).forEach(([key, value]) => {
                normalized[key] = toNumber(value) ?? value;
            });
            return [String(id), normalized];
        })
    );

    const nodes = nodesRaw.map((rawNode, idx) => {
        const id = rawNode?.id === undefined || rawNode?.id === null ? "" : String(rawNode.id);
        if (!id) return null;
        const metric = metricsByNodeId[id] ?? {};
        const sizeScore = toNumber(metric.degree_total) ?? toNumber(metric.pagerank) ?? 1;
        const zScore = toNumber(rawNode.z_score ?? rawNode.mean_z_score);
        return {
            id,
            label: String(rawNode.label ?? rawNode.name ?? id),
            category: String(rawNode.category ?? "Cross-System"),
            themeId: rawNode.theme_id === undefined || rawNode.theme_id === null ? null : String(rawNode.theme_id),
            xHint: toNumber(rawNode.x) ?? fallbackRingCoordinate(id, idx, nodesRaw.length, "x"),
            yHint: toNumber(rawNode.y) ?? fallbackRingCoordinate(id, idx, nodesRaw.length, "y"),
            stressLevel: normalizeStressLevel(rawNode.stress_level, zScore),
            sizeScore: Math.max(0.1, Number(sizeScore))
        };
    }).filter(Boolean);

    const edges = edgesRaw.map((rawEdge, idx) => {
        const sourceId = rawEdge?.source === undefined || rawEdge?.source === null ? "" : String(rawEdge.source);
        const targetId = rawEdge?.target === undefined || rawEdge?.target === null ? "" : String(rawEdge.target);
        if (!sourceId || !targetId) return null;
        return {
            id: rawEdge?.id === undefined || rawEdge?.id === null ? `edge-${idx + 1}` : String(rawEdge.id),
            sourceId,
            targetId,
            weight: clamp(toNumber(rawEdge.weight) ?? 0.5, 0, 1),
            evidence: normalizeEvidence(rawEdge.evidence),
            direction: String(rawEdge.direction ?? "unknown"),
            type: String(rawEdge.type ?? "unknown")
        };
    }).filter(Boolean);

    return {
        source,
        fetchedAt: new Date().toISOString(),
        generatedAt: raw.generated_at ?? raw.generatedAt ?? null,
        nodeCount: toNumber(raw.node_count ?? raw.nodeCount) ?? nodes.length,
        edgeCount: toNumber(raw.edge_count ?? raw.edgeCount) ?? edges.length,
        nodes,
        edges,
        metricsByNodeId,
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map((w) => String(w)) : []
    };
}

function normalizeConfidenceTier(value) {
    const normalized = String(value ?? "unknown").toLowerCase();
    if (["high", "medium", "low"].includes(normalized)) return normalized;
    return "unknown";
}

function normalizePatternSnapshot(raw, source) {
    const payload = raw?.data ?? raw ?? {};
    const matchesRaw = Array.isArray(payload.matches) ? payload.matches : [];

    const matches = matchesRaw.map((item) => {
        const similarityPct = clamp(toNumber(item.similarity_pct ?? item.similarityPct) ?? 0, 0, 100);
        const diagnostics = item.diagnostics ?? {};
        return {
            episodeId: String(item.episode_id ?? item.episodeId ?? ""),
            label: String(item.label ?? item.episode_label ?? "Unknown episode"),
            period: String(item.period ?? ""),
            description: String(item.description ?? ""),
            similarityPct,
            confidenceTier: normalizeConfidenceTier(item.confidence_tier ?? item.confidenceTier),
            requiredOverlapMin: toNumber(item.required_overlap_min ?? item.requiredOverlapMin),
            diagnostics: {
                rawCosine: toNumber(diagnostics.raw_cosine ?? diagnostics.rawCosine),
                penalty: toNumber(diagnostics.penalty),
                overlap: Array.isArray(diagnostics.overlap) ? diagnostics.overlap.map((v) => String(v)) : [],
                missingIndicators: Array.isArray(diagnostics.missing_indicators)
                    ? diagnostics.missing_indicators.map((v) => String(v))
                    : (Array.isArray(diagnostics.missingIndicators) ? diagnostics.missingIndicators.map((v) => String(v)) : [])
            }
        };
    }).filter((item) => item.episodeId);

    matches.sort((a, b) => {
        if (b.similarityPct !== a.similarityPct) return b.similarityPct - a.similarityPct;
        return a.label.localeCompare(b.label);
    });

    return {
        source,
        fetchedAt: new Date().toISOString(),
        generatedAt: payload.generated_at ?? payload.generatedAt ?? null,
        method: String(payload.method ?? "unknown"),
        currentVectorSize: toNumber(payload.current_vector_size ?? payload.currentVectorSize),
        matches
    };
}

export class DashboardApiClient {
    constructor(options = {}) {
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
        this.themeCatalog = new Map();
        this.apiKey = "";
        this.accessTier = "free";
    }

    setAuth(auth = {}) {
        this.apiKey = typeof auth.apiKey === "string" ? auth.apiKey.trim() : "";
        let rawTier = String(auth.tier ?? "free").trim().toLowerCase();
        if (rawTier === "developer") rawTier = "basic";
        if (rawTier === "professional" || rawTier === "premium") rawTier = "pro";
        this.accessTier = ["free", "basic", "pro", "enterprise"].includes(rawTier) ? rawTier : "free";
    }

    getAuth() {
        return { apiKey: this.apiKey, tier: this.accessTier };
    }

    async getDashboardSnapshot() {
        const attempts = [
            { path: "/api/v1/wssi", label: "api-v1" },
            { path: "/wssi/current", label: "legacy" },
            { path: "../../../output/analytics/wssi-latest.json", label: "analytics-artifact" },
            { path: "data/wssi-fallback.json", label: "local-fallback" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                let payload = await this.fetchJson(attempt.path);
                if (attempt.path === "/api/v1/wssi" && extractThemeSignals(payload).length === 0) {
                    try {
                        const themesPayload = await this.fetchJson("/api/v1/themes");
                        const themeSignals = extractThemeSignals(themesPayload);
                        if (themeSignals.length > 0) payload = { ...payload, theme_signals: themeSignals };
                    } catch {
                        // keep primary payload
                    }
                }
                const snapshot = normalizeSnapshot(payload, attempt.label);
                if (snapshot.rows.length > 0 || attempt.label === "local-fallback") {
                    this.cacheThemeCatalog(snapshot.rows);
                    return snapshot;
                }
                errors.push(`${attempt.label}: no theme rows`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load dashboard data. ${errors.join(" | ")}`);
    }

    async getCorrelationSnapshot() {
        const attempts = [
            { path: "/api/v1/correlations", label: "api-v1-correlations" },
            { path: "/correlations", label: "legacy-correlations" },
            { path: "../../../output/analytics/correlations.json", label: "analytics-artifact-correlations" },
            { path: "../../../../output/analytics/correlations.json", label: "analytics-root-correlations" },
            { path: "/output/analytics/correlations.json", label: "analytics-public-correlations" },
            { path: "data/correlations-fallback.json", label: "local-fallback-correlations" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                const snapshot = normalizeCorrelationSnapshot(await this.fetchJson(attempt.path), attempt.label, this.themeCatalog);
                if (snapshot.cells.length > 0 || attempt.label === "local-fallback-correlations") return snapshot;
                errors.push(`${attempt.label}: empty correlation cells`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load correlations. ${errors.join(" | ")}`);
    }

    async getTimelineSnapshot(days = 90) {
        const normalizedDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 90;
        const attempts = [
            { path: `/api/v1/wssi/history?days=${normalizedDays}`, label: "api-v1-history" },
            { path: `/wssi/history?days=${normalizedDays}`, label: "legacy-history" },
            { path: "../../../output/analytics/wssi-history.json", label: "analytics-artifact-history" },
            { path: "../../../../output/analytics/wssi-history.json", label: "analytics-root-history" },
            { path: "/output/analytics/wssi-history.json", label: "analytics-public-history" },
            { path: "data/wssi-history-fallback.json", label: "local-fallback-history" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                const snapshot = normalizeTimelineSnapshot(await this.fetchJson(attempt.path), attempt.label, normalizedDays);
                if (snapshot.points.length > 0 || attempt.label === "local-fallback-history") return snapshot;
                errors.push(`${attempt.label}: empty history points`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load WSSI history. ${errors.join(" | ")}`);
    }

    async getAlertsSnapshot() {
        const attempts = [
            { path: "/api/v1/alerts", label: "api-v1-alerts" },
            { path: "/alerts", label: "legacy-alerts" },
            { path: "../../../output/analytics/alerts.json", label: "analytics-artifact-alerts" },
            { path: "../../../../output/analytics/alerts.json", label: "analytics-root-alerts" },
            { path: "/output/analytics/alerts.json", label: "analytics-public-alerts" },
            { path: "data/alerts-fallback.json", label: "local-fallback-alerts" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                const snapshot = normalizeAlertsSnapshot(await this.fetchJson(attempt.path), attempt.label);
                if (snapshot.records.length > 0 || attempt.label === "local-fallback-alerts") return snapshot;
                errors.push(`${attempt.label}: empty alerts`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load alerts. ${errors.join(" | ")}`);
    }

    async getNetworkSnapshot() {
        const attempts = [
            { path: "/api/v1/network", label: "api-v1-network" },
            { path: "/network", label: "legacy-network" },
            { path: "../../../output/analytics/network.json", label: "analytics-artifact-network" },
            { path: "../../../../output/analytics/network.json", label: "analytics-root-network" },
            { path: "/output/analytics/network.json", label: "analytics-public-network" },
            { path: "data/network-fallback.json", label: "local-fallback-network" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                const snapshot = normalizeNetworkSnapshot(await this.fetchJson(attempt.path), attempt.label);
                if (snapshot.nodes.length > 0 || attempt.label === "local-fallback-network") return snapshot;
                errors.push(`${attempt.label}: empty network graph`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load network snapshot. ${errors.join(" | ")}`);
    }

    async getPatternSnapshot() {
        const attempts = [
            { path: "/api/v1/patterns", label: "api-v1-patterns" },
            { path: "/patterns", label: "legacy-patterns" },
            { path: "../../../output/analytics/patterns.json", label: "analytics-artifact-patterns" },
            { path: "../../../../output/analytics/patterns.json", label: "analytics-root-patterns" },
            { path: "/output/analytics/patterns.json", label: "analytics-public-patterns" },
            { path: "data/patterns-fallback.json", label: "local-fallback-patterns" }
        ];
        const errors = [];
        for (const attempt of attempts) {
            try {
                const snapshot = normalizePatternSnapshot(await this.fetchJson(attempt.path), attempt.label);
                if (snapshot.matches.length > 0 || attempt.label === "local-fallback-patterns") return snapshot;
                errors.push(`${attempt.label}: empty patterns`);
            } catch (error) {
                errors.push(`${attempt.label}: ${error.message}`);
            }
        }
        throw new Error(`Unable to load patterns. ${errors.join(" | ")}`);
    }

    cacheThemeCatalog(rows) {
        this.themeCatalog = new Map();
        rows.forEach((row) => {
            this.themeCatalog.set(row.themeId, { themeId: row.themeId, themeName: row.themeName, category: row.category });
        });
    }

    async fetchJson(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = { Accept: "application/json" };
            if (this.apiKey) headers["X-API-Key"] = this.apiKey;
            const normalizedPath = String(path ?? "");
            const base = resolveApiBaseUrl();
            const target = /^https?:\/\//i.test(normalizedPath)
                ? normalizedPath
                : (base && normalizedPath.startsWith("/") ? `${base}${normalizedPath}` : normalizedPath);
            const response = await fetch(target, {
                signal: controller.signal,
                headers
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") throw new Error(`timeout after ${this.timeoutMs}ms`);
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    static getStressRank(level) {
        return STRESS_RANK[level] ?? STRESS_RANK.unknown;
    }

    static getFreshnessRank(state) {
        return FRESHNESS_RANK[state] ?? FRESHNESS_RANK.unknown;
    }
}
