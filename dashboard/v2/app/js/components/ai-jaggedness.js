import { formatNumber } from "../utils/chart-helpers.js";

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function compareByDifficulty(left, right) {
    return Number(left.difficultyBin) - Number(right.difficultyBin);
}

export class AiJaggednessPanel {
    constructor(mount) {
        this.mount = mount;
        this.snapshot = null;
        this.selectedKey = "";
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot && typeof snapshot === "object" ? snapshot : null;
        const metrics = Array.isArray(this.snapshot?.metrics) ? this.snapshot.metrics : [];
        if (!metrics.some((metric) => metric.key === this.selectedKey)) {
            this.selectedKey = metrics[0]?.key ?? "";
        }
        this.render();
    }

    bindEvents() {
        if (!this.mount) return;

        const selector = this.mount.querySelector(".ai-jaggedness-selector");
        if (selector) {
            selector.addEventListener("change", (event) => {
                this.selectedKey = String(event.target.value ?? "");
                this.render();
            });
        }

        this.mount.querySelectorAll("[data-ai-jaggedness-key]").forEach((row) => {
            row.addEventListener("click", () => {
                this.selectedKey = String(row.getAttribute("data-ai-jaggedness-key") ?? "");
                this.render();
            });
        });
    }

    renderPrimarySvg(metric) {
        const observed = Array.isArray(metric?.observedPoints) ? [...metric.observedPoints] : [];
        const baseline = Array.isArray(metric?.isotonicBaseline) ? [...metric.isotonicBaseline] : [];
        const residuals = Array.isArray(metric?.residualBars) ? [...metric.residualBars] : [];
        const coverage = Array.isArray(metric?.coverageStrip) ? [...metric.coverageStrip] : [];

        if (observed.length === 0) {
            return '<p class="ai-jaggedness-empty">No observed points for selected series.</p>';
        }

        observed.sort(compareByDifficulty);
        baseline.sort(compareByDifficulty);
        residuals.sort(compareByDifficulty);
        coverage.sort(compareByDifficulty);

        const bins = observed.map((point) => Number(point.difficultyBin));
        const minBin = Math.min(...bins);
        const maxBin = Math.max(...bins);

        const width = 560;
        const height = 260;
        const padLeft = 56;
        const padRight = 14;
        const padTop = 12;
        const padBottom = 62;
        const chartWidth = width - padLeft - padRight;
        const chartHeight = height - padTop - padBottom;

        const xFor = (bin) => {
            const ratio = (Number(bin) - minBin) / Math.max(1, maxBin - minBin);
            return padLeft + (ratio * chartWidth);
        };
        const yFor = (score) => {
            const value = Math.max(0, Math.min(1, toNumber(score) ?? 0));
            return padTop + ((1 - value) * chartHeight);
        };

        const observedPolyline = observed
            .map((point) => `${xFor(point.difficultyBin).toFixed(2)},${yFor(point.score).toFixed(2)}`)
            .join(" ");
        const baselinePolyline = baseline
            .map((point) => `${xFor(point.difficultyBin).toFixed(2)},${yFor(point.score).toFixed(2)}`)
            .join(" ");

        const residualByBin = new Map(residuals.map((point) => [Number(point.difficultyBin), point]));
        const baselineByBin = new Map(baseline.map((point) => [Number(point.difficultyBin), point]));

        const residualLines = observed.map((point) => {
            const baselinePoint = baselineByBin.get(Number(point.difficultyBin));
            if (!baselinePoint) return "";
            const x = xFor(point.difficultyBin).toFixed(2);
            return `<line class="residual" x1="${x}" y1="${yFor(baselinePoint.score).toFixed(2)}" x2="${x}" y2="${yFor(point.score).toFixed(2)}"></line>`;
        }).join("");

        const observedDots = observed.map((point) => {
            const x = xFor(point.difficultyBin).toFixed(2);
            const y = yFor(point.score).toFixed(2);
            const residual = residualByBin.get(Number(point.difficultyBin));
            const residualLabel = residual ? formatNumber(residual.residual, 3) : "--";
            return `
                <g class="observed-point">
                    <circle cx="${x}" cy="${y}" r="4"></circle>
                    <title>Bin ${point.difficultyBin} | Score ${formatNumber(point.score, 3)} | Residual ${residualLabel}</title>
                </g>
            `;
        }).join("");

        const maxCoverage = Math.max(1, ...coverage.map((point) => toNumber(point.nTasks) ?? 0));
        const stripTop = padTop + chartHeight + 8;
        const stripHeight = 20;
        const coverageBars = coverage.map((point) => {
            const x = xFor(point.difficultyBin);
            const ratio = (toNumber(point.nTasks) ?? 0) / maxCoverage;
            const barHeight = Math.max(1, ratio * stripHeight);
            return `<rect class="coverage-bar" x="${(x - 8).toFixed(2)}" y="${(stripTop + stripHeight - barHeight).toFixed(2)}" width="16" height="${barHeight.toFixed(2)}"></rect>`;
        }).join("");

        const axisTicks = [0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = yFor(tick).toFixed(2);
            return `
                <line class="grid" x1="${padLeft}" y1="${y}" x2="${padLeft + chartWidth}" y2="${y}"></line>
                <text class="tick" x="${padLeft - 8}" y="${(Number(y) + 3).toFixed(2)}">${formatNumber(tick, 2)}</text>
            `;
        }).join("");

        return `
            <svg class="ai-jaggedness-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI jaggedness observed points and isotonic baseline">
                <line class="axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartHeight}"></line>
                <line class="axis" x1="${padLeft}" y1="${padTop + chartHeight}" x2="${padLeft + chartWidth}" y2="${padTop + chartHeight}"></line>
                ${axisTicks}
                <polyline class="baseline-line" points="${baselinePolyline}"></polyline>
                <polyline class="observed-line" points="${observedPolyline}"></polyline>
                ${residualLines}
                ${observedDots}
                ${coverageBars}
                <text class="axis-label" x="${padLeft}" y="${height - 8}">Difficulty bins (coverage strip below)</text>
                <text class="axis-label" x="14" y="${padTop + 4}">Normalized score</text>
            </svg>
        `;
    }

    renderTrendSvg(metric) {
        const points = Array.isArray(metric?.trendSeries) ? metric.trendSeries : [];
        if (points.length < 2) {
            return '<p class="ai-jaggedness-empty">Insufficient monthly trend history for selected series.</p>';
        }

        const width = 560;
        const height = 160;
        const padLeft = 46;
        const padRight = 12;
        const padTop = 10;
        const padBottom = 28;
        const chartWidth = width - padLeft - padRight;
        const chartHeight = height - padTop - padBottom;

        const numeric = points.map((point) => toNumber(point.roughnessIndex)).filter((value) => value !== null);
        const minValue = Math.min(...numeric);
        const maxValue = Math.max(...numeric);

        const xFor = (idx) => padLeft + ((idx / Math.max(1, points.length - 1)) * chartWidth);
        const yFor = (value) => {
            const safe = toNumber(value) ?? minValue;
            const ratio = (safe - minValue) / Math.max(1e-9, maxValue - minValue);
            return padTop + ((1 - ratio) * chartHeight);
        };

        const linePoints = points.map((point, idx) => `${xFor(idx).toFixed(2)},${yFor(point.roughnessIndex).toFixed(2)}`).join(" ");

        const upper = points.map((point, idx) => `${xFor(idx).toFixed(2)},${yFor(point.ciUpper ?? point.roughnessIndex).toFixed(2)}`).join(" ");
        const lower = [...points]
            .reverse()
            .map((point, revIdx) => {
                const idx = (points.length - 1) - revIdx;
                return `${xFor(idx).toFixed(2)},${yFor(point.ciLower ?? point.roughnessIndex).toFixed(2)}`;
            })
            .join(" ");

        const firstMonth = points[0]?.snapshotMonth ?? "--";
        const lastMonth = points[points.length - 1]?.snapshotMonth ?? "--";

        return `
            <svg class="ai-jaggedness-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI jaggedness monthly trend with confidence band">
                <line class="axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartHeight}"></line>
                <line class="axis" x1="${padLeft}" y1="${padTop + chartHeight}" x2="${padLeft + chartWidth}" y2="${padTop + chartHeight}"></line>
                <polygon class="ci-band" points="${upper} ${lower}"></polygon>
                <polyline class="trend-line" points="${linePoints}"></polyline>
                <text class="tick" x="${padLeft}" y="${height - 8}">${escapeHtml(firstMonth)}</text>
                <text class="tick" x="${padLeft + chartWidth - 2}" y="${height - 8}">${escapeHtml(lastMonth)}</text>
                <text class="tick" x="${padLeft - 8}" y="${padTop + chartHeight}">${formatNumber(minValue, 3)}</text>
                <text class="tick" x="${padLeft - 8}" y="${padTop + 4}">${formatNumber(maxValue, 3)}</text>
            </svg>
        `;
    }

    render() {
        if (!this.mount) return;
        const snapshot = this.snapshot;
        const metrics = Array.isArray(snapshot?.metrics) ? snapshot.metrics : [];
        if (!snapshot || metrics.length === 0) {
            this.mount.innerHTML = '<p class="empty-state">No AI jaggedness data available.</p>';
            return;
        }

        const selected = metrics.find((metric) => metric.key === this.selectedKey) ?? metrics[0];
        const selectorOptions = metrics
            .map((metric) => {
                const selectedAttr = metric.key === selected.key ? "selected" : "";
                return `<option value="${escapeHtml(metric.key)}" ${selectedAttr}>${escapeHtml(metric.modelName)} (${escapeHtml(metric.source)})</option>`;
            })
            .join("");

        const summaryRows = metrics.slice(0, 10).map((metric, idx) => {
            const selectedClass = metric.key === selected.key ? " is-selected" : "";
            const warning = metric.insufficientEvidence ? "insufficient" : "ok";
            return `
                <tr class="ai-jaggedness-row${selectedClass}" data-ai-jaggedness-key="${escapeHtml(metric.key)}">
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(metric.modelName)}<span class="muted-inline">${escapeHtml(metric.source)}</span></td>
                    <td>${formatNumber(metric.roughnessIndex, 3)}</td>
                    <td>${formatNumber(metric.signFlipRate, 3)}</td>
                    <td><span class="jaggedness-pill ${warning}">${metric.insufficientEvidence ? "Insufficient" : "Ready"}</span></td>
                </tr>
            `;
        }).join("");

        const thresholds = snapshot.methodology?.qualityThresholds ?? {};

        this.mount.innerHTML = `
            <section class="ai-jaggedness-shell">
                <div class="ai-jaggedness-meta">
                    <p class="ai-frontier-badge">Research signal, not WSSI-weighted</p>
                    <p class="ai-frontier-note">Observed points only; no fabricated interpolation</p>
                    <p class="ai-frontier-note">Cohort month: ${escapeHtml(snapshot.cohortMonth ?? snapshot.snapshotMonth ?? "--")}</p>
                    <p class="ai-frontier-note">Last updated: ${escapeHtml(snapshot.generatedAt ?? "--")}</p>
                </div>
                <section class="ai-frontier-card">
                    <div class="ai-trend-header">
                        <h3>Capability vs difficulty (observed + isotonic + residuals)</h3>
                        <select class="ai-jaggedness-selector" aria-label="Select model/source jaggedness series">${selectorOptions}</select>
                    </div>
                    <p class="ai-trend-summary">
                        Selected: <strong>${escapeHtml(selected.modelName)}</strong> (${escapeHtml(selected.source)})
                        · roughness ${formatNumber(selected.roughnessIndex, 3)}
                        · bins ${escapeHtml(String(selected.coverage?.binsPresent?.length ?? 0))}
                    </p>
                    ${this.renderPrimarySvg(selected)}
                </section>
                <section class="ai-frontier-card">
                    <h3>Monthly roughness trend (95% CI)</h3>
                    ${this.renderTrendSvg(selected)}
                    <p class="ai-trend-summary">
                        Sufficiency thresholds: bins >= ${escapeHtml(String(thresholds.minimum_bins_present ?? 4))},
                        tasks >= ${escapeHtml(String(thresholds.minimum_tasks_per_model_source_month ?? 40))},
                        trials >= ${escapeHtml(String(thresholds.minimum_total_trials ?? 80))}
                    </p>
                </section>
                <div class="ai-frontier-table-wrap">
                    <table class="ai-frontier-table" aria-label="AI jaggedness summary table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Series</th>
                                <th>Roughness</th>
                                <th>Flip Rate</th>
                                <th>Evidence</th>
                            </tr>
                        </thead>
                        <tbody>${summaryRows}</tbody>
                    </table>
                </div>
                <p class="ai-frontier-footnote">${escapeHtml(snapshot.usageNote ?? "")}</p>
            </section>
        `;

        this.bindEvents();
    }
}
