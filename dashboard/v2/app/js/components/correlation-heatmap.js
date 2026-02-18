import { formatNumber, pointerPosition, roundRect, scaleCanvas } from "../utils/chart-helpers.js";

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function interpolateColor(a, b, t) {
    return {
        r: Math.round(a.r + ((b.r - a.r) * t)),
        g: Math.round(a.g + ((b.g - a.g) * t)),
        b: Math.round(a.b + ((b.b - a.b) * t))
    };
}

function colorForR(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "rgba(150, 160, 180, 0.2)";
    }

    const clamped = Math.max(-1, Math.min(1, value));
    const neutral = { r: 245, g: 247, b: 250 };
    const negative = { r: 66, g: 133, b: 244 };
    const positive = { r: 244, g: 96, b: 96 };

    if (clamped < 0) {
        const c = interpolateColor(neutral, negative, Math.abs(clamped));
        return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }

    const c = interpolateColor(neutral, positive, clamped);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function significanceLabel(cell) {
    if (!cell) return "unknown";
    if (cell.isSignificant) return "significant";
    return "not significant";
}

export class CorrelationHeatmap {
    constructor(mount, options = {}) {
        this.mount = mount;
        this.snapshot = null;
        this.themeMetrics = new Map();
        this.onPairSelect = typeof options.onPairSelect === "function" ? options.onPairSelect : null;

        this.hoverCell = null;
        this.activeRow = 0;
        this.activeCol = 0;
        this.layout = null;
        this.cellIndex = new Map();

        this.buildScaffold();
        this.bindEvents();
    }

    buildScaffold() {
        if (!this.mount) return;

        this.mount.innerHTML = `
            <div class="chart-shell">
                <div class="chart-legend-row">
                    <div class="legend-chip">Negative</div>
                    <div class="legend-gradient" aria-hidden="true"></div>
                    <div class="legend-chip">Positive</div>
                </div>
                <p class="chart-meta correlation-source">Correlation source: --</p>
                <div class="heatmap-stage">
                    <canvas class="heatmap-canvas" tabindex="0" aria-label="Correlation heatmap" role="grid"></canvas>
                    <div class="chart-tooltip hidden"></div>
                </div>
                <aside class="pair-drawer hidden" aria-live="polite"></aside>
                <p class="empty-state hidden"></p>
            </div>
        `;

        this.canvas = this.mount.querySelector(".heatmap-canvas");
        this.tooltip = this.mount.querySelector(".chart-tooltip");
        this.drawer = this.mount.querySelector(".pair-drawer");
        this.emptyState = this.mount.querySelector(".empty-state");
        this.sourceLabel = this.mount.querySelector(".correlation-source");
    }

    bindEvents() {
        if (!this.canvas) return;

        this.canvas.addEventListener("mousemove", (event) => {
            const cell = this.cellAtPointer(event);
            this.hoverCell = cell;
            this.render();
        });

        this.canvas.addEventListener("mouseleave", () => {
            this.hoverCell = null;
            this.tooltip.classList.add("hidden");
            this.render();
        });

        this.canvas.addEventListener("click", (event) => {
            const cell = this.cellAtPointer(event);
            if (!cell) return;
            this.selectCell(cell.rowIdx, cell.colIdx, true);
        });

        this.canvas.addEventListener("keydown", (event) => {
            if (!this.snapshot || this.snapshot.themes.length === 0) return;
            const maxIndex = this.snapshot.themes.length - 1;
            let handled = true;

            if (event.key === "ArrowLeft") this.activeCol = Math.max(0, this.activeCol - 1);
            else if (event.key === "ArrowRight") this.activeCol = Math.min(maxIndex, this.activeCol + 1);
            else if (event.key === "ArrowUp") this.activeRow = Math.max(0, this.activeRow - 1);
            else if (event.key === "ArrowDown") this.activeRow = Math.min(maxIndex, this.activeRow + 1);
            else if (event.key === "Enter" || event.key === " ") this.openPairDrawer(this.activeRow, this.activeCol, true);
            else handled = false;

            if (handled) {
                event.preventDefault();
                this.render();
            }
        });

        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(this.canvas);
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot ?? null;
        this.activeRow = 0;
        this.activeCol = 0;
        this.hoverCell = null;
        if (this.sourceLabel) {
            this.sourceLabel.textContent = this.snapshot ? `Correlation source: ${this.snapshot.source}` : "Correlation source: --";
        }
        this.render();
    }

    setThemeMetrics(rows) {
        this.themeMetrics = new Map();
        if (Array.isArray(rows)) {
            for (const row of rows) {
                this.themeMetrics.set(row.themeId, row);
            }
        }
        this.renderDrawer();
    }

    selectCell(rowIdx, colIdx, emitSelection) {
        this.activeRow = rowIdx;
        this.activeCol = colIdx;
        this.openPairDrawer(rowIdx, colIdx, emitSelection);
        this.render();
    }

    openPairDrawer(rowIdx, colIdx, emitSelection) {
        if (!this.snapshot) return;

        const themes = this.snapshot.themes;
        const rowTheme = themes[rowIdx];
        const colTheme = themes[colIdx];
        if (!rowTheme || !colTheme) return;

        const cell = this.getCell(rowTheme.themeId, colTheme.themeId);
        if (!cell) return;

        this.currentPair = {
            rowTheme,
            colTheme,
            cell
        };
        this.renderDrawer();

        if (emitSelection && this.onPairSelect) {
            this.onPairSelect({
                rowThemeId: rowTheme.themeId,
                colThemeId: colTheme.themeId,
                cell
            });
        }
    }

    getCell(rowThemeId, colThemeId) {
        if (!this.snapshot) return null;
        const key = `${rowThemeId}::${colThemeId}`;
        return this.cellIndex.get(key) ?? null;
    }

    renderDrawer() {
        if (!this.drawer) return;
        if (!this.currentPair) {
            this.drawer.classList.add("hidden");
            this.drawer.innerHTML = "";
            return;
        }

        const { rowTheme, colTheme, cell } = this.currentPair;
        const rowMetric = this.themeMetrics.get(rowTheme.themeId);
        const colMetric = this.themeMetrics.get(colTheme.themeId);

        const metricHtml = (theme, metric) => `
            <article class="pair-theme-card">
                <h4>${escapeHtml(theme.themeName)}</h4>
                <p class="pair-theme-meta">${escapeHtml(theme.category)}</p>
                <dl>
                    <div><dt>Stress</dt><dd>${escapeHtml(metric?.stressLevel ?? "unknown")}</dd></div>
                    <div><dt>z</dt><dd>${formatNumber(metric?.zScore)}</dd></div>
                    <div><dt>Momentum 30d</dt><dd>${formatNumber(metric?.trendValue)}</dd></div>
                </dl>
            </article>
        `;

        this.drawer.innerHTML = `
            <div class="pair-drawer-inner">
                <h3>${escapeHtml(rowTheme.themeName)} x ${escapeHtml(colTheme.themeName)}</h3>
                <p class="pair-drawer-subtitle">Pair detail (time-series overlay deferred pending per-theme history endpoint)</p>
                <dl class="pair-stats">
                    <div><dt>r</dt><dd>${formatNumber(cell.pearsonR, 3)}</dd></div>
                    <div><dt>p</dt><dd>${formatNumber(cell.pValue, 4)}</dd></div>
                    <div><dt>n</dt><dd>${formatNumber(cell.sampleN, 0)}</dd></div>
                    <div><dt>Significance</dt><dd>${escapeHtml(significanceLabel(cell))}</dd></div>
                    <div><dt>Pattern</dt><dd>${escapeHtml(cell.patternLabel || "none")}</dd></div>
                </dl>
                <div class="pair-theme-grid">
                    ${metricHtml(rowTheme, rowMetric)}
                    ${metricHtml(colTheme, colMetric)}
                </div>
            </div>
        `;
        this.drawer.classList.remove("hidden");
    }

    cellAtPointer(event) {
        if (!this.layout || !this.snapshot) return null;
        const p = pointerPosition(event, this.canvas);
        const { left, top, cellSize, size } = this.layout;

        if (p.x < left || p.y < top) return null;
        if (p.x > left + (cellSize * size) || p.y > top + (cellSize * size)) return null;

        const colIdx = Math.floor((p.x - left) / cellSize);
        const rowIdx = Math.floor((p.y - top) / cellSize);

        const rowTheme = this.snapshot.themes[rowIdx];
        const colTheme = this.snapshot.themes[colIdx];
        if (!rowTheme || !colTheme) return null;

        const cell = this.getCell(rowTheme.themeId, colTheme.themeId);
        if (!cell) return null;

        return { rowIdx, colIdx, cell, pointer: p };
    }

    drawMissingCell(ctx, x, y, cellSize) {
        ctx.fillStyle = "rgba(125, 136, 156, 0.2)";
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.strokeStyle = "rgba(96, 106, 126, 0.45)";
        ctx.lineWidth = 1;
        for (let i = -cellSize; i <= cellSize; i += 8) {
            ctx.beginPath();
            ctx.moveTo(x + i, y);
            ctx.lineTo(x + i + cellSize, y + cellSize);
            ctx.stroke();
        }
    }

    drawTooltip(cellInfo) {
        if (!cellInfo || !this.tooltip || !this.snapshot) {
            this.tooltip.classList.add("hidden");
            return;
        }

        const rowTheme = this.snapshot.themes[cellInfo.rowIdx];
        const colTheme = this.snapshot.themes[cellInfo.colIdx];
        const cell = cellInfo.cell;

        this.tooltip.innerHTML = `
            <p><strong>${escapeHtml(rowTheme.themeName)}</strong> vs <strong>${escapeHtml(colTheme.themeName)}</strong></p>
            <p>r: ${formatNumber(cell.pearsonR, 3)}</p>
            <p>p: ${formatNumber(cell.pValue, 4)}</p>
            <p>n: ${formatNumber(cell.sampleN, 0)}</p>
            <p>${escapeHtml(significanceLabel(cell))}${cell.patternLabel ? ` • ${escapeHtml(cell.patternLabel)}` : ""}</p>
        `;

        const offsetX = cellInfo.pointer.x + 14;
        const offsetY = cellInfo.pointer.y + 14;
        this.tooltip.style.left = `${offsetX}px`;
        this.tooltip.style.top = `${offsetY}px`;
        this.tooltip.classList.remove("hidden");
    }

    render() {
        if (!this.canvas || !this.emptyState) return;

        const result = scaleCanvas(this.canvas);
        if (!result) return;
        const { ctx, width, height } = result;

        ctx.clearRect(0, 0, width, height);
        this.tooltip.classList.add("hidden");

        if (!this.snapshot || this.snapshot.themes.length === 0) {
            this.emptyState.textContent = "No correlation data available.";
            this.emptyState.classList.remove("hidden");
            return;
        }

        this.emptyState.classList.add("hidden");

        const themes = this.snapshot.themes;
        const size = themes.length;
        const leftPad = 150;
        const topPad = 24;
        const rightPad = 24;
        const bottomPad = 100;

        const gridSize = Math.min(width - leftPad - rightPad, height - topPad - bottomPad);
        const cellSize = Math.max(10, gridSize / size);

        this.layout = {
            left: leftPad,
            top: topPad,
            cellSize,
            size
        };

        this.cellIndex = new Map();
        for (const cell of this.snapshot.cells) {
            this.cellIndex.set(`${cell.rowThemeId}::${cell.colThemeId}`, cell);
        }

        ctx.save();
        ctx.font = "12px var(--font-mono)";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;

        for (let row = 0; row < size; row += 1) {
            for (let col = 0; col < size; col += 1) {
                const rowTheme = themes[row];
                const colTheme = themes[col];
                const cell = this.getCell(rowTheme.themeId, colTheme.themeId);
                const x = leftPad + (col * cellSize);
                const y = topPad + (row * cellSize);

                if (!cell || cell.pearsonR === null) {
                    this.drawMissingCell(ctx, x, y, cellSize);
                } else {
                    ctx.fillStyle = colorForR(cell.pearsonR);
                    ctx.fillRect(x, y, cellSize, cellSize);
                }

                ctx.strokeRect(x, y, cellSize, cellSize);

                if (cell?.isStrong) {
                    ctx.fillStyle = "rgba(255, 214, 10, 0.9)";
                    ctx.beginPath();
                    ctx.arc(x + cellSize - 5, y + 5, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // axis labels
        ctx.fillStyle = "rgba(216, 220, 230, 0.95)";
        ctx.textAlign = "right";
        for (let row = 0; row < size; row += 1) {
            const y = topPad + (row * cellSize) + (cellSize / 2);
            const themeLabel = themes[row].themeName ?? themes[row].themeId;
            ctx.fillText(themeLabel, leftPad - 10, y);
        }

        ctx.textAlign = "left";
        for (let col = 0; col < size; col += 1) {
            const x = leftPad + (col * cellSize) + (cellSize / 2);
            const y = topPad + (size * cellSize) + 8;
            const label = themes[col].themeName ?? themes[col].themeId;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 3);
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }

        // active cell focus
        const activeX = leftPad + (this.activeCol * cellSize);
        const activeY = topPad + (this.activeRow * cellSize);
        roundRect(ctx, activeX + 1, activeY + 1, cellSize - 2, cellSize - 2, 4);
        ctx.strokeStyle = "rgba(0, 212, 170, 0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        this.drawTooltip(this.hoverCell);
    }
}
