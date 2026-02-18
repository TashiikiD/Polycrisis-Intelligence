function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function fmt(value, digits = 2) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function momentumClass(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "momentum-flat";
    if (value > 0.05) return "momentum-up";
    if (value < -0.05) return "momentum-down";
    return "momentum-flat";
}

function momentumArrow(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "→";
    if (value > 0.05) return "↑";
    if (value < -0.05) return "↓";
    return "→";
}

function momentumBar(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.min(100, Math.round((Math.abs(value) / 2) * 100));
}

export class ThemeDetailPanel {
    constructor(mount) {
        this.mount = mount;
        this.themeMap = new Map();
        this.selectedThemeId = null;
        this.pairContext = null;
        this.render();
    }

    setThemes(rows) {
        this.themeMap = new Map();
        if (Array.isArray(rows)) {
            for (const row of rows) {
                this.themeMap.set(row.themeId, row);
            }
        }

        if (!this.selectedThemeId && rows?.length > 0) {
            this.selectedThemeId = rows[0].themeId;
        } else if (this.selectedThemeId && !this.themeMap.has(this.selectedThemeId)) {
            this.selectedThemeId = rows?.[0]?.themeId ?? null;
        }

        this.render();
    }

    selectTheme(themeId) {
        if (!themeId) return;
        this.selectedThemeId = themeId;
        this.render();
    }

    setPairContext(pair) {
        this.pairContext = pair ?? null;
        if (pair?.rowThemeId) {
            this.selectedThemeId = pair.rowThemeId;
        }
        this.render();
    }

    render() {
        if (!this.mount) return;
        const row = this.selectedThemeId ? this.themeMap.get(this.selectedThemeId) : null;

        if (!row) {
            this.mount.innerHTML = `<p class="empty-state">Select a theme in the ledger or heatmap to view indicator detail.</p>`;
            return;
        }

        const indicatorRows = row.indicatorDetails.length > 0
            ? row.indicatorDetails.map((indicator) => {
                const momentum = indicator.momentum30d;
                const glyphClass = momentumClass(momentum);
                return `
                    <tr>
                        <td>${escapeHtml(indicator.name)}</td>
                        <td>${escapeHtml(indicator.source)}</td>
                        <td class="value-mono">${fmt(indicator.zScore)}</td>
                        <td>
                            <div class="momentum-cell ${glyphClass}">
                                <span class="momentum-arrow">${momentumArrow(momentum)}</span>
                                <div class="momentum-proxy-bar">
                                    <span style="width:${momentumBar(momentum)}%"></span>
                                </div>
                                <span class="value-mono">${fmt(momentum)}</span>
                            </div>
                        </td>
                        <td>${escapeHtml(indicator.freshness)}</td>
                        <td>${escapeHtml(indicator.qualityTier)}</td>
                    </tr>
                `;
            }).join("")
            : `<tr><td colspan="6">No indicator detail available.</td></tr>`;

        const pairNote = this.pairContext
            ? `<p class="theme-detail-pair-note">Heatmap pair context: <strong>${escapeHtml(this.pairContext.rowThemeId)}</strong> vs <strong>${escapeHtml(this.pairContext.colThemeId)}</strong></p>`
            : "";

        this.mount.innerHTML = `
            <section class="theme-detail-shell">
                <header class="theme-detail-header">
                    <div>
                        <h3>${escapeHtml(row.themeName)}</h3>
                        <p class="theme-detail-meta">${escapeHtml(row.category)} · ${escapeHtml(row.stressLevel)}</p>
                    </div>
                    <dl class="theme-detail-stats">
                        <div><dt>z-score</dt><dd>${fmt(row.zScore)}</dd></div>
                        <div><dt>Momentum 30d</dt><dd>${fmt(row.trendValue)}</dd></div>
                        <div><dt>Confidence</dt><dd>${escapeHtml(row.confidenceTier)}</dd></div>
                        <div><dt>Freshness</dt><dd>${escapeHtml(row.freshnessLabel)}</dd></div>
                    </dl>
                </header>

                ${pairNote}
                <p class="theme-detail-proxy-note">Mini-trend visuals use 30d momentum proxy (Day 7 default).</p>

                <div class="theme-detail-table-wrap">
                    <table class="indicator-table theme-detail-table" aria-label="Theme indicator detail">
                        <thead>
                            <tr>
                                <th>Indicator</th>
                                <th>Source</th>
                                <th>z</th>
                                <th>Trend proxy</th>
                                <th>Freshness</th>
                                <th>Quality</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${indicatorRows}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }
}
