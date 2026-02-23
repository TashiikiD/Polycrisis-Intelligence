import { formatNumber } from "../utils/chart-helpers.js";

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export class AiModelFrontier {
    constructor(mount) {
        this.mount = mount;
        this.snapshot = null;
        this.selectedModelId = "";
        this.bindRootEvents = this.bindRootEvents.bind(this);
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot && typeof snapshot === "object" ? snapshot : null;
        const top = Array.isArray(this.snapshot?.topModels) ? this.snapshot.topModels : [];
        if (!top.some((row) => row.id === this.selectedModelId)) {
            this.selectedModelId = top[0]?.id ?? "";
        }
        this.render();
    }

    bindRootEvents() {
        if (!this.mount) return;

        const selector = this.mount.querySelector(".ai-model-selector");
        if (selector) {
            selector.addEventListener("change", (event) => {
                this.selectedModelId = String(event.target.value ?? "");
                this.render();
            });
        }

        this.mount.querySelectorAll("[data-ai-model-id]").forEach((el) => {
            el.addEventListener("click", () => {
                this.selectedModelId = String(el.getAttribute("data-ai-model-id") ?? "");
                this.render();
            });
        });
    }

    renderScatterSvg(rows) {
        const width = 520;
        const height = 240;
        const padLeft = 52;
        const padBottom = 38;
        const padTop = 14;
        const padRight = 12;
        const chartWidth = width - padLeft - padRight;
        const chartHeight = height - padTop - padBottom;

        const speedVals = rows.map((row) => toNumber(row.outputTps)).filter((value) => value !== null);
        const intelVals = rows.map((row) => toNumber(row.intelligenceProxy)).filter((value) => value !== null);
        const minSpeed = speedVals.length > 0 ? Math.min(...speedVals) : 0;
        const maxSpeed = speedVals.length > 0 ? Math.max(...speedVals) : 1;
        const minIntel = intelVals.length > 0 ? Math.min(...intelVals) : 0;
        const maxIntel = intelVals.length > 0 ? Math.max(...intelVals) : 1;

        const xFor = (value) => {
            const v = toNumber(value);
            if (v === null) return null;
            const ratio = (v - minSpeed) / Math.max(1e-9, maxSpeed - minSpeed);
            return padLeft + (ratio * chartWidth);
        };
        const yFor = (value) => {
            const v = toNumber(value);
            if (v === null) return null;
            const ratio = (v - minIntel) / Math.max(1e-9, maxIntel - minIntel);
            return padTop + ((1 - ratio) * chartHeight);
        };

        const dots = rows.map((row) => {
            const cx = xFor(row.outputTps);
            const cy = yFor(row.intelligenceProxy);
            if (cx === null || cy === null) return "";
            const selected = row.id === this.selectedModelId;
            return `
                <g class="ai-scatter-dot${selected ? " selected" : ""}">
                    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${selected ? 6 : 4.5}"></circle>
                    <text x="${(cx + 8).toFixed(2)}" y="${(cy - 8).toFixed(2)}">${escapeHtml(row.name)}</text>
                </g>
            `;
        }).join("");

        return `
            <svg class="ai-scatter-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI model frontier scatter">
                <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartHeight}" class="axis"></line>
                <line x1="${padLeft}" y1="${padTop + chartHeight}" x2="${padLeft + chartWidth}" y2="${padTop + chartHeight}" class="axis"></line>
                <text x="${padLeft}" y="${height - 10}" class="axis-label">Output tokens/sec</text>
                <text x="14" y="${padTop + 4}" class="axis-label">Intelligence proxy</text>
                <text x="${padLeft}" y="${padTop + chartHeight + 14}" class="tick">${formatNumber(minSpeed, 1)}</text>
                <text x="${padLeft + chartWidth - 2}" y="${padTop + chartHeight + 14}" class="tick">${formatNumber(maxSpeed, 1)}</text>
                <text x="${padLeft - 6}" y="${padTop + chartHeight}" class="tick">${formatNumber(minIntel, 1)}</text>
                <text x="${padLeft - 6}" y="${padTop + 6}" class="tick">${formatNumber(maxIntel, 1)}</text>
                ${dots}
            </svg>
        `;
    }

    renderTrendSvg(selectedRow) {
        const points = Array.isArray(selectedRow?.historyPoints) ? selectedRow.historyPoints : [];
        if (points.length < 2) {
            return '<p class="ai-trend-empty">Insufficient history for selected model.</p>';
        }

        const width = 520;
        const height = 150;
        const padLeft = 44;
        const padBottom = 24;
        const padTop = 10;
        const padRight = 10;
        const chartWidth = width - padLeft - padRight;
        const chartHeight = height - padTop - padBottom;

        const values = points.map((point) => toNumber(point.intelligenceProxy)).filter((value) => value !== null);
        const minValue = values.length > 0 ? Math.min(...values) : 0;
        const maxValue = values.length > 0 ? Math.max(...values) : 1;
        const xFor = (idx) => padLeft + (idx / Math.max(1, points.length - 1)) * chartWidth;
        const yFor = (value) => {
            const v = toNumber(value) ?? minValue;
            const ratio = (v - minValue) / Math.max(1e-9, maxValue - minValue);
            return padTop + ((1 - ratio) * chartHeight);
        };

        const polyline = points
            .map((point, idx) => `${xFor(idx).toFixed(2)},${yFor(point.intelligenceProxy).toFixed(2)}`)
            .join(" ");
        const firstDate = points[0]?.generatedAt ? String(points[0].generatedAt).slice(0, 10) : "--";
        const lastDate = points[points.length - 1]?.generatedAt ? String(points[points.length - 1].generatedAt).slice(0, 10) : "--";

        return `
            <svg class="ai-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Selected model intelligence trend">
                <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartHeight}" class="axis"></line>
                <line x1="${padLeft}" y1="${padTop + chartHeight}" x2="${padLeft + chartWidth}" y2="${padTop + chartHeight}" class="axis"></line>
                <polyline points="${polyline}" class="trend-line"></polyline>
                <text x="${padLeft}" y="${height - 6}" class="tick">${escapeHtml(firstDate)}</text>
                <text x="${padLeft + chartWidth - 2}" y="${height - 6}" class="tick">${escapeHtml(lastDate)}</text>
                <text x="${padLeft - 6}" y="${padTop + chartHeight}" class="tick">${formatNumber(minValue, 1)}</text>
                <text x="${padLeft - 6}" y="${padTop + 4}" class="tick">${formatNumber(maxValue, 1)}</text>
            </svg>
        `;
    }

    render() {
        if (!this.mount) return;
        const snapshot = this.snapshot;
        const rows = Array.isArray(snapshot?.topModels) ? snapshot.topModels : [];
        if (!snapshot || rows.length === 0) {
            this.mount.innerHTML = '<p class="empty-state">No AI model frontier data available.</p>';
            return;
        }

        const selectedRow = rows.find((row) => row.id === this.selectedModelId) ?? rows[0];
        const selectorOptions = rows.map((row) => {
            const selected = row.id === selectedRow.id ? "selected" : "";
            return `<option value="${escapeHtml(row.id)}" ${selected}>${escapeHtml(row.name)}</option>`;
        }).join("");

        const tableRows = rows.map((row, idx) => {
            const selected = row.id === selectedRow.id;
            return `
                <tr class="ai-model-row${selected ? " is-selected" : ""}" data-ai-model-id="${escapeHtml(row.id)}">
                    <td>${idx + 1}</td>
                    <td>
                        <span class="model-name">${escapeHtml(row.name)}</span>
                        <span class="model-creator">${escapeHtml(row.creatorName)}</span>
                    </td>
                    <td>${formatNumber(row.intelligenceProxy, 2)}</td>
                    <td>${formatNumber(row.outputTps, 1)}</td>
                    <td>${formatNumber(row.inputPricePerMillion, 2)}</td>
                    <td>${formatNumber(row.outputPricePerMillion, 2)}</td>
                </tr>
            `;
        }).join("");

        this.mount.innerHTML = `
            <section class="ai-frontier-shell">
                <div class="ai-frontier-meta">
                    <p class="ai-frontier-badge">Research signal, not WSSI-weighted</p>
                    <p class="ai-frontier-note">Attribution: artificialanalysis.ai</p>
                    <p class="ai-frontier-note">Last updated: ${escapeHtml(snapshot.generatedAt ?? "--")}</p>
                    <p class="ai-frontier-note">Models tracked: ${escapeHtml(String(snapshot.modelCount ?? rows.length))}</p>
                </div>
                <div class="ai-frontier-grid">
                    <section class="ai-frontier-card">
                        <h3>Top model frontier</h3>
                        ${this.renderScatterSvg(rows)}
                    </section>
                    <section class="ai-frontier-card">
                        <div class="ai-trend-header">
                            <h3>Selected model trend</h3>
                            <select class="ai-model-selector" aria-label="Select model trend">${selectorOptions}</select>
                        </div>
                        <p class="ai-trend-summary">
                            Model: <strong>${escapeHtml(selectedRow.name)}</strong>
                            · Δ proxy: ${formatNumber(selectedRow.trendDelta, 2)}
                        </p>
                        ${this.renderTrendSvg(selectedRow)}
                    </section>
                </div>
                <div class="ai-frontier-table-wrap">
                    <table class="ai-frontier-table" aria-label="Top AI models">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Model</th>
                                <th>Intelligence</th>
                                <th>Speed (tok/s)</th>
                                <th>Input $/M</th>
                                <th>Output $/M</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
                <p class="ai-frontier-footnote">${escapeHtml(snapshot.usageNote ?? "")}</p>
            </section>
        `;

        this.bindRootEvents();
    }
}
