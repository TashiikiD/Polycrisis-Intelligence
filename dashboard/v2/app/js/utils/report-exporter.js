function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function formatNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "N/A";
    return n.toFixed(digits);
}

function formatDateTime(value) {
    if (!value) return "Unknown";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "Unknown";
    return dt.toLocaleString();
}

function severityBadgeClass(value) {
    if (value === "critical") return "severity-critical";
    if (value === "warning") return "severity-warning";
    if (value === "info") return "severity-info";
    return "severity-unknown";
}

function sectionStaleBadge(model, key) {
    const state = model?.dataFreshness?.[key]?.freshnessState ?? "unknown";
    if (state !== "stale") return "";
    return '<span class="brief-section-stale">Stale section</span>';
}

function renderStressRows(model) {
    const rows = model?.topThemes ?? [];
    if (rows.length === 0) return '<p class="brief-empty">No stress rows available in the last-good snapshot.</p>';
    return `
        <table class="brief-table">
            <thead>
                <tr>
                    <th>Theme</th>
                    <th>Category</th>
                    <th>Stress Level</th>
                    <th>z Score</th>
                    <th>Trend (30d)</th>
                    <th>Freshness</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.themeName)}</td>
                        <td>${escapeHtml(row.category)}</td>
                        <td>${escapeHtml(row.stressLevel)}</td>
                        <td>${formatNumber(row.zScore, 2)}</td>
                        <td>${escapeHtml(row.trendLabel ?? "No 30d momentum")}</td>
                        <td>${escapeHtml(row.freshnessLabel ?? "Unknown")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderAlertRows(model) {
    const rows = model?.alertSummary?.latest ?? [];
    if (rows.length === 0) return '<p class="brief-empty">No alert rows available in the current snapshot.</p>';
    return `
        <table class="brief-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Themes</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.relativeTimeLabel ?? "Unknown")}</td>
                        <td>${escapeHtml(row.title)}</td>
                        <td><span class="brief-badge ${severityBadgeClass(row.severity)}">${escapeHtml(row.severity)}</span></td>
                        <td>${escapeHtml(row.status)}</td>
                        <td>${escapeHtml((row.themeIds ?? []).join(", ") || "N/A")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderCorrelationRows(model) {
    const rows = model?.strongCorrelations ?? [];
    if (rows.length === 0) return '<p class="brief-empty">No strong correlation pairs available.</p>';
    return `
        <table class="brief-table">
            <thead>
                <tr>
                    <th>Theme Pair</th>
                    <th>r</th>
                    <th>p</th>
                    <th>n</th>
                    <th>Label</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.pairLabel)}</td>
                        <td>${formatNumber(row.pearsonR, 3)}</td>
                        <td>${formatNumber(row.pValue, 4)}</td>
                        <td>${formatNumber(row.sampleN, 0)}</td>
                        <td>${escapeHtml(row.patternLabel || "")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderNetworkRows(model) {
    const nodes = model?.networkHighlights?.topNodes ?? [];
    const edges = model?.networkHighlights?.topEdges ?? [];
    return `
        <div class="brief-split">
            <div>
                <h4>Top Nodes</h4>
                ${nodes.length === 0 ? '<p class="brief-empty">No network nodes available.</p>' : `
                    <table class="brief-table">
                        <thead>
                            <tr>
                                <th>Node</th>
                                <th>Category</th>
                                <th>Stress</th>
                                <th>Size</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${nodes.map((node) => `
                                <tr>
                                    <td>${escapeHtml(node.label)}</td>
                                    <td>${escapeHtml(node.category)}</td>
                                    <td>${escapeHtml(node.stressLevel || "unknown")}</td>
                                    <td>${formatNumber(node.sizeScore, 2)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                `}
            </div>
            <div>
                <h4>Top Edges</h4>
                ${edges.length === 0 ? '<p class="brief-empty">No network edges available.</p>' : `
                    <table class="brief-table">
                        <thead>
                            <tr>
                                <th>Connection</th>
                                <th>Weight</th>
                                <th>Evidence</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${edges.map((edge) => `
                                <tr>
                                    <td>${escapeHtml(`${edge.sourceId} -> ${edge.targetId}`)}</td>
                                    <td>${formatNumber(edge.weight, 2)}</td>
                                    <td>${escapeHtml(edge.evidence)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                `}
            </div>
        </div>
    `;
}

function renderPatternRows(model) {
    const rows = model?.patternHighlights ?? [];
    if (rows.length === 0) return '<p class="brief-empty">No analog pattern matches available.</p>';
    return `
        <table class="brief-table">
            <thead>
                <tr>
                    <th>Episode</th>
                    <th>Period</th>
                    <th>Similarity</th>
                    <th>Confidence</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.label)}</td>
                        <td>${escapeHtml(row.period || "Unknown period")}</td>
                        <td>${formatNumber(row.similarityPct, 1)}%</td>
                        <td>${escapeHtml(row.confidenceTier)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderAppendix(model) {
    const appendix = model?.indicatorAppendix ?? { themes: [], isLocked: true, lockedMessage: "Upgrade required." };
    if (appendix.isLocked) {
        return `
            <div class="brief-upgrade-placeholder">
                <p class="brief-upgrade-title">Upgrade required</p>
                <p>${escapeHtml(appendix.lockedMessage || "Full indicator appendix is available on paid tiers.")}</p>
            </div>
        `;
    }
    if (!appendix.themes?.length) {
        return '<p class="brief-empty">No indicator appendix rows available.</p>';
    }
    return appendix.themes.map((theme) => `
        <section class="brief-appendix-theme">
            <h4>${escapeHtml(theme.themeName)} <span>${escapeHtml(theme.themeId)}</span></h4>
            <p class="brief-appendix-meta">
                ${escapeHtml(theme.category)} · Stress ${escapeHtml(theme.stressLevel)} · z ${formatNumber(theme.zScore, 2)} · Freshness ${escapeHtml(theme.freshnessLabel)}
            </p>
            ${theme.indicators?.length ? `
                <table class="brief-table">
                    <thead>
                        <tr>
                            <th>Indicator</th>
                            <th>Source</th>
                            <th>z Score</th>
                            <th>30d Momentum Proxy</th>
                            <th>Freshness</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${theme.indicators.map((indicator) => `
                            <tr>
                                <td>${escapeHtml(indicator.name)}</td>
                                <td>${escapeHtml(indicator.source)}</td>
                                <td>${formatNumber(indicator.zScore, 2)}</td>
                                <td>${formatNumber(indicator.momentum30d, 2)}</td>
                                <td>${escapeHtml(indicator.freshness)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            ` : '<p class="brief-empty">No indicator details available for this theme.</p>'}
        </section>
    `).join("");
}

function renderSourceRows(model) {
    const labels = model?.sourceLabels ?? {};
    const rows = [
        ["WSSI Snapshot", labels.snapshot],
        ["Correlations", labels.correlations],
        ["Timeline", labels.timeline],
        ["Alerts", labels.alerts],
        ["Network", labels.network],
        ["Patterns", labels.patterns]
    ];
    return `
        <table class="brief-table source-table">
            <thead>
                <tr>
                    <th>Dataset</th>
                    <th>Source Label</th>
                    <th>Freshness</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(([label, source], index) => {
        const keys = ["snapshot", "correlations", "timeline", "alerts", "network", "patterns"];
        const key = keys[index];
        const freshness = model?.dataFreshness?.[key];
        const freshnessLabel = freshness ? `${freshness.freshnessState} (${freshness.freshnessLabel})` : "Unknown";
        return `
                        <tr>
                            <td>${escapeHtml(label)}</td>
                            <td>${escapeHtml(source || "Unavailable")}</td>
                            <td>${escapeHtml(freshnessLabel)}</td>
                        </tr>
                    `;
    }).join("")}
            </tbody>
        </table>
    `;
}

function renderUpgradePlaceholder(title, detail) {
    return `
        <div class="brief-upgrade-placeholder">
            <p class="brief-upgrade-title">${escapeHtml(title)}</p>
            <p>${escapeHtml(detail)}</p>
        </div>
    `;
}

export function renderFragilityBriefHtml(model) {
    const tierLabel = model?.tierContext?.tierLabel ?? "Free";
    const isPaid = Boolean(model?.tierContext?.isPaid);
    const alerts = model?.alertSummary?.counts ?? { critical: 0, warning: 0, info: 0, unknown: 0 };
    const summary = model?.wssiSummary ?? {};
    return `
        <article class="fragility-brief" data-report-depth="${escapeHtml(model?.tierContext?.reportDepth || "limited")}">
            <header class="brief-header">
                <div>
                    <p class="brief-brand-kicker">Polycrisis Intelligence</p>
                    <h1 class="brief-brand-title">${escapeHtml(model?.brandTitle || "The Fragility Brief")}</h1>
                    <p class="brief-brand-subtitle">Integrated systemic risk brief across WSSI, indicators, alerts, correlations, network and patterns.</p>
                </div>
                <div class="brief-header-meta">
                    <p><strong>Generated:</strong> ${escapeHtml(formatDateTime(model?.generatedAt))}</p>
                    <p><strong>Tier:</strong> <span class="brief-tier-label">${escapeHtml(tierLabel)}</span></p>
                    <p><strong>Confidentiality:</strong> Internal briefing material.</p>
                </div>
            </header>

            <section class="brief-section">
                <h2>Executive Snapshot ${sectionStaleBadge(model, "snapshot")}</h2>
                <div class="brief-kpi-grid">
                    <article><h3>WSSI Value</h3><p>${formatNumber(summary.wssiValue, 2)}</p></article>
                    <article><h3>WSSI Score</h3><p>${formatNumber(summary.wssiScore, 1)}</p></article>
                    <article><h3>Trend</h3><p>${escapeHtml(summary.trendLabel || "Unknown")}</p></article>
                    <article><h3>Above Warning</h3><p>${escapeHtml(String(summary.aboveWarningCount ?? 0))}</p></article>
                </div>
                <p class="brief-section-note">
                    Active themes: ${escapeHtml(String(summary.activeThemes ?? 0))} ·
                    Headline stress: ${escapeHtml(summary.stressHeadline || "N/A")} ·
                    Snapshot timestamp: ${escapeHtml(formatDateTime(summary.calculationTimestamp))}
                </p>
            </section>

            <section class="brief-section">
                <h2>Stress Overview ${sectionStaleBadge(model, "snapshot")}</h2>
                ${renderStressRows(model)}
            </section>

            <section class="brief-section">
                <h2>Alerts Overview ${sectionStaleBadge(model, "alerts")}</h2>
                <p class="brief-section-note">
                    Critical: ${escapeHtml(String(alerts.critical))} ·
                    Warning: ${escapeHtml(String(alerts.warning))} ·
                    Info: ${escapeHtml(String(alerts.info))} ·
                    Unknown: ${escapeHtml(String(alerts.unknown))}
                </p>
                ${renderAlertRows(model)}
            </section>

            <section class="brief-section">
                <h2>Correlation Highlights ${sectionStaleBadge(model, "correlations")}</h2>
                ${isPaid ? renderCorrelationRows(model) : renderUpgradePlaceholder(
        "Free-tier limited",
        "Upgrade to unlock the full strong-pair set and significance context."
    )}
            </section>

            <section class="brief-section">
                <h2>Network Highlights ${sectionStaleBadge(model, "network")}</h2>
                ${isPaid ? renderNetworkRows(model) : renderUpgradePlaceholder(
        "Free-tier limited",
        "Upgrade to unlock expanded network centrality and edge evidence details."
    )}
            </section>

            <section class="brief-section">
                <h2>Pattern Highlights ${sectionStaleBadge(model, "patterns")}</h2>
                ${renderPatternRows(model)}
                <p class="brief-section-note">Historical analogs are structural similarity, not prediction.</p>
            </section>

            <section class="brief-section">
                <h2>Indicator Appendix ${sectionStaleBadge(model, "snapshot")}</h2>
                <p class="brief-section-note">Indicator mini-trends use 30d momentum proxy labels.</p>
                ${renderAppendix(model)}
            </section>

            <section class="brief-section">
                <h2>Data Sources and Freshness</h2>
                ${renderSourceRows(model)}
            </section>

            <footer class="brief-footer">
                <p>Historical analogs are structural similarity, not prediction.</p>
                <p>Source labels are derived from the active dashboard adapter chain and last-good snapshots.</p>
            </footer>
        </article>
    `;
}

export function renderFragilityBriefDom(model, mountEl) {
    if (!mountEl) throw new Error("Report mount element is required.");
    mountEl.innerHTML = renderFragilityBriefHtml(model);
    return mountEl.querySelector(".fragility-brief");
}

function ensurePdfLibraries() {
    const html2canvasRef = window.html2canvas;
    const jsPdfCtor = window.jspdf?.jsPDF;
    if (!html2canvasRef || !jsPdfCtor) {
        throw new Error("PDF libraries unavailable (html2canvas/jsPDF missing).");
    }
    return { html2canvasRef, jsPdfCtor };
}

async function canvasToPdf(node, fileName) {
    const { html2canvasRef, jsPdfCtor } = ensurePdfLibraries();
    const canvas = await html2canvasRef(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
    });

    const pdf = new jsPdfCtor({ orientation: "p", unit: "pt", format: "a4" });
    const margin = 24;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const renderWidth = pageWidth - (margin * 2);
    const renderHeightPerPage = pageHeight - (margin * 2);
    const sourceSliceHeight = Math.floor((renderHeightPerPage * canvas.width) / renderWidth);

    const pageCanvas = document.createElement("canvas");
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) throw new Error("Unable to create page rendering context.");

    let offsetY = 0;
    let pageIndex = 0;
    while (offsetY < canvas.height) {
        const sliceHeight = Math.min(sourceSliceHeight, canvas.height - offsetY);
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeight;
        pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageCtx.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        if (pageIndex > 0) pdf.addPage();
        const imageData = pageCanvas.toDataURL("image/png");
        const renderedSliceHeight = (sliceHeight * renderWidth) / canvas.width;
        pdf.addImage(imageData, "PNG", margin, margin, renderWidth, renderedSliceHeight);
        offsetY += sliceHeight;
        pageIndex += 1;
    }

    pdf.save(fileName);
    return { pageCount: pageIndex };
}

function openPrintFallback(model, options) {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) throw new Error("Print fallback popup blocked.");
    const stylesheetHrefs = Array.isArray(options?.stylesheetHrefs) && options.stylesheetHrefs.length > 0
        ? options.stylesheetHrefs
        : ["css/report.css"];
    const links = stylesheetHrefs.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${escapeHtml(model?.brandTitle || "Fragility Brief")}</title>
    ${links}
</head>
<body class="fragility-print-body">
${renderFragilityBriefHtml(model)}
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
        win.print();
    }, 80);
}

export async function exportFragilityBriefPdf(model, options = {}) {
    const mountEl = options.mountEl;
    if (!mountEl) throw new Error("exportFragilityBriefPdf requires options.mountEl.");
    const briefNode = renderFragilityBriefDom(model, mountEl);
    if (!briefNode) throw new Error("Unable to render fragility brief DOM.");
    const fileName = options.fileName || `fragility-brief-${new Date().toISOString().slice(0, 10)}.pdf`;

    try {
        const info = await canvasToPdf(briefNode, fileName);
        return { ok: true, method: "pdf", fileName, pageCount: info.pageCount };
    } catch (error) {
        if (!options.allowPrintFallback) throw error;
        openPrintFallback(model, options);
        return { ok: true, method: "print-fallback", warning: error.message };
    }
}
