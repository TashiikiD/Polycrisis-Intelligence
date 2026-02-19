const STRESS_RANK = { unknown: 0, stable: 1, watch: 2, approaching: 3, critical: 4 };
const FRESHNESS_ORDER = { fresh: 0, recent: 1, warning: 2, stale: 3, unknown: 4 };

const FREE_LIMITS = {
    topThemes: 5,
    alertRows: 3,
    correlations: 1,
    networkNodes: 3,
    networkEdges: 2,
    patterns: 1,
    appendixThemes: 1,
    appendixIndicatorsPerTheme: 2
};

const PAID_LIMITS = {
    topThemes: 12,
    alertRows: 5,
    correlations: 8,
    networkNodes: 8,
    networkEdges: 8,
    patterns: 3,
    appendixThemes: 6,
    appendixIndicatorsPerTheme: 8
};

function normalizeTier(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (raw === "developer") return "basic";
    if (raw === "professional" || raw === "premium") return "pro";
    return ["free", "basic", "pro", "enterprise"].includes(raw) ? raw : "free";
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

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatDateTime(value) {
    if (!value) return "Unknown";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "Unknown";
    return dt.toLocaleString();
}

function minutesSince(value) {
    if (!value) return null;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    return Math.max(0, (Date.now() - dt.getTime()) / 60000);
}

function freshnessStateFromMinutes(minutes) {
    if (minutes === null) return "unknown";
    if (minutes <= 10) return "fresh";
    if (minutes <= 60) return "recent";
    if (minutes <= 240) return "warning";
    return "stale";
}

function severityRank(level) {
    if (level === "critical") return 3;
    if (level === "warning") return 2;
    if (level === "info") return 1;
    return 0;
}

function getDatasetInfo(snapshot, label, statusHint = "") {
    const normalizedHint = String(statusHint ?? "").trim().toLowerCase();
    const hintSaysStale = normalizedHint.includes("stale") || normalizedHint.includes("unavailable");
    if (!snapshot) {
        return {
            label,
            source: "Unavailable",
            fetchedAt: null,
            freshnessState: "stale",
            freshnessLabel: "Unavailable",
            staleReason: "No last-good snapshot."
        };
    }
    const ageMinutes = minutesSince(snapshot.fetchedAt);
    let freshnessState = freshnessStateFromMinutes(ageMinutes);
    if (hintSaysStale) freshnessState = "stale";
    return {
        label,
        source: String(snapshot.source ?? "unknown"),
        fetchedAt: snapshot.fetchedAt ?? null,
        freshnessState,
        freshnessLabel: ageMinutes === null ? "Unknown age" : `${Math.round(ageMinutes)}m ago`,
        staleReason: freshnessState === "stale"
            ? (hintSaysStale ? "Refresh cycle marked this dataset as stale or unavailable." : "Older than expected refresh window.")
            : ""
    };
}

function sortThemesByStress(rows) {
    const copy = Array.isArray(rows) ? [...rows] : [];
    copy.sort((a, b) => {
        const stressDiff = (STRESS_RANK[b.stressLevel] ?? 0) - (STRESS_RANK[a.stressLevel] ?? 0);
        if (stressDiff !== 0) return stressDiff;
        const bAbs = typeof b.zScore === "number" ? Math.abs(b.zScore) : -1;
        const aAbs = typeof a.zScore === "number" ? Math.abs(a.zScore) : -1;
        if (bAbs !== aAbs) return bAbs - aAbs;
        return String(a.themeName ?? "").localeCompare(String(b.themeName ?? ""));
    });
    return copy;
}

function summarizeAlerts(records, limit) {
    const counts = { critical: 0, warning: 0, info: 0, unknown: 0 };
    const rows = Array.isArray(records) ? records : [];
    rows.forEach((record) => {
        const key = ["critical", "warning", "info"].includes(record.severity) ? record.severity : "unknown";
        counts[key] += 1;
    });
    const latest = [...rows]
        .sort((a, b) => (b.createdAtMs ?? Number.NEGATIVE_INFINITY) - (a.createdAtMs ?? Number.NEGATIVE_INFINITY))
        .slice(0, limit);
    return { counts, latest, totalRecords: rows.length };
}

function buildStrongCorrelations(correlationSnapshot, limit) {
    if (!correlationSnapshot?.pairs?.length) return [];
    return [...correlationSnapshot.pairs]
        .filter((pair) => pair.isStrong)
        .sort((a, b) => {
            if (b.absR !== a.absR) return b.absR - a.absR;
            return `${a.rowThemeId}:${a.colThemeId}`.localeCompare(`${b.rowThemeId}:${b.colThemeId}`);
        })
        .slice(0, limit)
        .map((pair) => ({
            pairLabel: `${pair.rowThemeId} vs ${pair.colThemeId}`,
            pearsonR: pair.pearsonR,
            pValue: pair.pValue,
            sampleN: pair.sampleN,
            isSignificant: pair.isSignificant,
            patternLabel: pair.patternLabel || "Emerging Pattern"
        }));
}

function buildNetworkHighlights(networkSnapshot, limitNodes, limitEdges) {
    if (!networkSnapshot) return { topNodes: [], topEdges: [] };
    const topNodes = [...(networkSnapshot.nodes ?? [])]
        .sort((a, b) => (toNumber(b.sizeScore) ?? 0) - (toNumber(a.sizeScore) ?? 0))
        .slice(0, limitNodes)
        .map((node) => ({
            nodeId: node.id,
            label: node.label,
            category: node.category,
            themeId: node.themeId,
            stressLevel: node.stressLevel,
            sizeScore: toNumber(node.sizeScore)
        }));

    const topEdges = [...(networkSnapshot.edges ?? [])]
        .sort((a, b) => (toNumber(b.weight) ?? 0) - (toNumber(a.weight) ?? 0))
        .slice(0, limitEdges)
        .map((edge) => ({
            edgeId: edge.id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            weight: toNumber(edge.weight),
            evidence: edge.evidence,
            type: edge.type
        }));

    return { topNodes, topEdges };
}

function buildPatternHighlights(patternSnapshot, limit) {
    if (!patternSnapshot?.matches?.length) return [];
    return patternSnapshot.matches.slice(0, limit).map((match) => ({
        episodeId: match.episodeId,
        label: match.label,
        period: match.period,
        similarityPct: toNumber(match.similarityPct),
        confidenceTier: match.confidenceTier,
        description: match.description
    }));
}

function buildIndicatorAppendix(rows, tierLimits, paid) {
    const rankedThemes = sortThemesByStress(rows).slice(0, tierLimits.appendixThemes);
    const themes = rankedThemes.map((row) => {
        const indicators = [...(row.indicatorDetails ?? [])]
            .sort((a, b) => {
                const aFresh = FRESHNESS_ORDER[String(a.freshness ?? "unknown").toLowerCase()] ?? FRESHNESS_ORDER.unknown;
                const bFresh = FRESHNESS_ORDER[String(b.freshness ?? "unknown").toLowerCase()] ?? FRESHNESS_ORDER.unknown;
                if (aFresh !== bFresh) return aFresh - bFresh;
                const bAbs = typeof b.zScore === "number" ? Math.abs(b.zScore) : -1;
                const aAbs = typeof a.zScore === "number" ? Math.abs(a.zScore) : -1;
                if (bAbs !== aAbs) return bAbs - aAbs;
                return String(a.name ?? "").localeCompare(String(b.name ?? ""));
            })
            .slice(0, tierLimits.appendixIndicatorsPerTheme);
        return {
            themeId: row.themeId,
            themeName: row.themeName,
            category: row.category,
            stressLevel: row.stressLevel,
            zScore: row.zScore,
            freshnessLabel: row.freshnessLabel,
            indicators
        };
    });

    return {
        isLocked: !paid,
        lockedMessage: paid ? "" : "Upgrade required for the full indicator appendix.",
        themes
    };
}

function resolveWssiTrend(lastSuccessful) {
    const points = lastSuccessful?.timeline?.points ?? [];
    if (points.length < 2) return { trendLabel: "insufficient history", latestDelta: null };
    const latest = points[points.length - 1];
    const prev = points[points.length - 2];
    const latestScore = toNumber(latest.wssiScore);
    const prevScore = toNumber(prev.wssiScore);
    if (latestScore === null || prevScore === null) return { trendLabel: "insufficient history", latestDelta: null };
    const delta = Number((latestScore - prevScore).toFixed(2));
    if (delta > 0) return { trendLabel: `up +${delta.toFixed(2)}`, latestDelta: delta };
    if (delta < 0) return { trendLabel: `down ${delta.toFixed(2)}`, latestDelta: delta };
    return { trendLabel: "flat 0.00", latestDelta: delta };
}

function deriveStaleSectionKeys(dataFreshness) {
    return Object.entries(dataFreshness)
        .filter(([, item]) => item.freshnessState === "stale")
        .map(([key]) => key);
}

export function buildFragilityBriefModel(lastSuccessful, authState, options = {}) {
    const tier = normalizeTier(authState?.tier);
    const paid = isPaidTier(tier);
    const limits = paid ? PAID_LIMITS : FREE_LIMITS;
    const snapshot = lastSuccessful?.snapshot ?? null;
    const rows = snapshot?.rows ?? [];
    const rankedThemes = sortThemesByStress(rows);
    const topThemes = rankedThemes.slice(0, limits.topThemes);
    const trend = resolveWssiTrend(lastSuccessful);
    const alerts = summarizeAlerts(lastSuccessful?.alerts?.records ?? [], limits.alertRows);
    const strongCorrelations = buildStrongCorrelations(lastSuccessful?.correlations, limits.correlations);
    const networkHighlights = buildNetworkHighlights(lastSuccessful?.network, limits.networkNodes, limits.networkEdges);
    const patternHighlights = buildPatternHighlights(lastSuccessful?.patterns, limits.patterns);
    const indicatorAppendix = buildIndicatorAppendix(rankedThemes, limits, paid);

    const panelStatus = options?.panelStatus ?? {};
    const dataFreshness = {
        snapshot: getDatasetInfo(lastSuccessful?.snapshot, "WSSI", panelStatus.stressLedger),
        correlations: getDatasetInfo(lastSuccessful?.correlations, "Correlations", panelStatus.correlation),
        timeline: getDatasetInfo(lastSuccessful?.timeline, "Timeline", panelStatus.timeline),
        alerts: getDatasetInfo(lastSuccessful?.alerts, "Alerts", panelStatus.alerts),
        network: getDatasetInfo(lastSuccessful?.network, "Network", panelStatus.network),
        patterns: getDatasetInfo(lastSuccessful?.patterns, "Patterns", panelStatus.patterns)
    };

    const staleSectionKeys = deriveStaleSectionKeys(dataFreshness);
    const aboveWarningCount = rankedThemes.filter((row) => (STRESS_RANK[row.stressLevel] ?? 0) >= STRESS_RANK.watch).length;
    const stressHeadline = rankedThemes[0]
        ? `${rankedThemes[0].themeName} (${rankedThemes[0].stressLevel})`
        : "No stress rows available";

    return {
        generatedAt: new Date().toISOString(),
        brandTitle: "The Fragility Brief",
        wssiSummary: {
            wssiValue: snapshot?.wssiValue ?? null,
            wssiScore: snapshot?.wssiScore ?? null,
            calculationTimestamp: snapshot?.calculationTimestamp ?? null,
            trendLabel: trend.trendLabel,
            latestDelta: trend.latestDelta,
            activeThemes: rows.length,
            aboveWarningCount,
            stressHeadline
        },
        topThemes,
        alertSummary: alerts,
        strongCorrelations,
        networkHighlights,
        patternHighlights,
        indicatorAppendix,
        dataFreshness,
        staleSectionKeys,
        sourceLabels: {
            snapshot: snapshot?.source ?? "Unavailable",
            correlations: lastSuccessful?.correlations?.source ?? "Unavailable",
            timeline: lastSuccessful?.timeline?.source ?? "Unavailable",
            alerts: lastSuccessful?.alerts?.source ?? "Unavailable",
            network: lastSuccessful?.network?.source ?? "Unavailable",
            patterns: lastSuccessful?.patterns?.source ?? "Unavailable"
        },
        tierContext: {
            tier,
            tierLabel: tierLabel(tier),
            isPaid: paid,
            limits: { ...limits },
            hiddenSections: paid ? [] : ["full-correlations", "full-network", "full-patterns", "full-indicator-appendix"],
            reportDepth: paid ? "full" : "limited"
        }
    };
}
