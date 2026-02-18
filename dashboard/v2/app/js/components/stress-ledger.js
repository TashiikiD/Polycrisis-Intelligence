import { DashboardApiClient } from "../utils/api-client.js";

const CONFIDENCE_RANK = {
    unknown: 0,
    emerging: 1,
    documented: 2,
    established: 3
};

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function trendArrow(arrow) {
    if (arrow === "up") return "↑";
    if (arrow === "down") return "↓";
    if (arrow === "flat") return "→";
    return "-";
}

function fmtNumber(value, digits = 2) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export class StressLedger {
    constructor(mount, options = {}) {
        this.mount = mount;
        this.rows = [];
        this.sortKey = "stressLevel";
        this.sortDirection = "desc";
        this.expanded = new Set();
        this.onThemeSelect = typeof options.onThemeSelect === "function" ? options.onThemeSelect : null;
    }

    setRows(rows) {
        this.rows = Array.isArray(rows) ? rows : [];
        this.render();
    }

    toggleSort(key) {
        if (this.sortKey === key) {
            this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
            this.sortKey = key;
            this.sortDirection = "desc";
        }
        this.render();
    }

    toggleExpand(themeId) {
        if (this.expanded.has(themeId)) {
            this.expanded.delete(themeId);
        } else {
            this.expanded.add(themeId);
        }

        if (this.onThemeSelect) {
            this.onThemeSelect(themeId);
        }

        this.render();
    }

    setThemeSelectHandler(handler) {
        this.onThemeSelect = typeof handler === "function" ? handler : null;
    }

    getSortedRows() {
        const sign = this.sortDirection === "asc" ? 1 : -1;

        const compare = (a, b) => {
            let aVal;
            let bVal;

            switch (this.sortKey) {
                case "themeName":
                    aVal = a.themeName.toLowerCase();
                    bVal = b.themeName.toLowerCase();
                    break;
                case "zScore":
                    aVal = typeof a.zScore === "number" ? a.zScore : Number.NEGATIVE_INFINITY;
                    bVal = typeof b.zScore === "number" ? b.zScore : Number.NEGATIVE_INFINITY;
                    break;
                case "barRatio":
                    aVal = a.barRatio;
                    bVal = b.barRatio;
                    break;
                case "trendValue":
                    aVal = typeof a.trendValue === "number" ? a.trendValue : Number.NEGATIVE_INFINITY;
                    bVal = typeof b.trendValue === "number" ? b.trendValue : Number.NEGATIVE_INFINITY;
                    break;
                case "confidenceTier":
                    aVal = CONFIDENCE_RANK[String(a.confidenceTier).toLowerCase()] ?? 0;
                    bVal = CONFIDENCE_RANK[String(b.confidenceTier).toLowerCase()] ?? 0;
                    break;
                case "freshnessState":
                    aVal = DashboardApiClient.getFreshnessRank(a.freshnessState);
                    bVal = DashboardApiClient.getFreshnessRank(b.freshnessState);
                    break;
                case "stressLevel":
                default:
                    aVal = DashboardApiClient.getStressRank(a.stressLevel);
                    bVal = DashboardApiClient.getStressRank(b.stressLevel);
                    break;
            }

            if (typeof aVal === "string") {
                if (aVal < bVal) return -1 * sign;
                if (aVal > bVal) return 1 * sign;
            } else if (aVal !== bVal) {
                return (aVal - bVal) * sign;
            }

            const absA = typeof a.zScore === "number" ? Math.abs(a.zScore) : -1;
            const absB = typeof b.zScore === "number" ? Math.abs(b.zScore) : -1;
            return absB - absA;
        };

        return [...this.rows].sort(compare);
    }

    render() {
        if (!this.mount) {
            return;
        }

        if (this.rows.length === 0) {
            this.mount.innerHTML = '<p class="empty-state">No Stress Ledger rows available.</p>';
            return;
        }

        const rows = this.getSortedRows();

        const headers = [
            { key: "themeName", label: "Theme" },
            { key: "zScore", label: "Signal (z)" },
            { key: "barRatio", label: "Stress Bar" },
            { key: "trendValue", label: "Trend (30d)" },
            { key: "confidenceTier", label: "Confidence" },
            { key: "freshnessState", label: "Freshness" }
        ];

        const tableHead = headers.map((header) => {
            const active = this.sortKey === header.key;
            const indicator = active ? (this.sortDirection === "asc" ? "↑" : "↓") : "↕";
            return `
                <th>
                    <button class="sort-button" type="button" data-sort="${header.key}">
                        ${header.label} <span class="sort-indicator">${indicator}</span>
                    </button>
                </th>
            `;
        }).join("");

        const bodyRows = rows.map((row) => {
            const expanded = this.expanded.has(row.themeId);
            const detailRows = row.indicatorDetails.length > 0
                ? row.indicatorDetails.map((detail) => `
                    <tr>
                        <td>${escapeHtml(detail.name)}</td>
                        <td>${escapeHtml(detail.source)}</td>
                        <td class="value-mono">${fmtNumber(detail.zScore)}</td>
                        <td class="value-mono">${fmtNumber(detail.momentum30d)}</td>
                        <td>${escapeHtml(detail.freshness)}</td>
                        <td>${escapeHtml(detail.qualityTier)}</td>
                    </tr>
                `).join("")
                : '<tr><td colspan="6">No indicator detail available.</td></tr>';

            return `
                <tr class="ledger-row" tabindex="0" role="button" aria-expanded="${expanded}" data-theme-id="${escapeHtml(row.themeId)}">
                    <td>
                        <div class="theme-main">
                            <span class="theme-name">${escapeHtml(row.themeName)}</span>
                            <span class="category-chip">${escapeHtml(row.category)}</span>
                        </div>
                    </td>
                    <td>
                        <div class="value-mono">${fmtNumber(row.zScore)}</div>
                        <div class="status-text">${escapeHtml(row.stressLevel)}</div>
                    </td>
                    <td>
                        <div class="stress-bar" aria-label="Stress magnitude">
                            <div class="stress-fill ${escapeHtml(row.stressLevel)}" style="width:${Math.round(row.barRatio * 100)}%"></div>
                        </div>
                    </td>
                    <td>
                        <div class="value-mono">${trendArrow(row.trendArrow)} ${fmtNumber(row.trendValue)}</div>
                        <div class="status-text">${escapeHtml(row.trendLabel)}</div>
                    </td>
                    <td>
                        <div class="confidence-stack">
                            <span class="confidence-tier">${escapeHtml(row.confidenceTier)}</span>
                            <span class="quality-text">Quality: ${row.qualityScore === null ? "--" : row.qualityScore.toFixed(2)}</span>
                        </div>
                    </td>
                    <td>
                        <span class="freshness-chip freshness-${escapeHtml(row.freshnessState)}">${escapeHtml(row.freshnessLabel)}</span>
                    </td>
                </tr>
                <tr class="expansion-row" ${expanded ? "" : "hidden"}>
                    <td class="expansion-cell" colspan="6">
                        <table class="indicator-table" aria-label="Indicator details for ${escapeHtml(row.themeName)}">
                            <thead>
                                <tr>
                                    <th>Indicator</th>
                                    <th>Source</th>
                                    <th>Z</th>
                                    <th>Momentum 30d</th>
                                    <th>Freshness</th>
                                    <th>Quality</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${detailRows}
                            </tbody>
                        </table>
                    </td>
                </tr>
            `;
        }).join("");

        this.mount.innerHTML = `
            <div class="ledger-table-wrap">
                <table class="ledger-table" aria-label="Stress Ledger table">
                    <thead>
                        <tr>${tableHead}</tr>
                    </thead>
                    <tbody>
                        ${bodyRows}
                    </tbody>
                </table>
            </div>
        `;

        this.mount.querySelectorAll(".sort-button").forEach((button) => {
            button.addEventListener("click", () => this.toggleSort(button.dataset.sort));
        });

        this.mount.querySelectorAll(".ledger-row").forEach((rowEl) => {
            const themeId = rowEl.dataset.themeId;
            rowEl.addEventListener("click", () => this.toggleExpand(themeId));
            rowEl.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.toggleExpand(themeId);
                }
            });
        });
    }
}
