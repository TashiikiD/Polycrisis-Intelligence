import { clamp, formatNumber, nearestIndexByX, pointerPosition, roundRect, scaleCanvas } from "../utils/chart-helpers.js";

function formatDateLabel(raw) {
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function annotationColor(severity) {
    if (severity === "critical") return "#ff2d55";
    if (severity === "warning") return "#ff9f1c";
    if (severity === "info") return "#5bc0eb";
    return "#a5adba";
}

export class WssiTimeline {
    constructor(mount) {
        this.mount = mount;
        this.points = [];
        this.annotations = [];
        this.hoverIndex = -1;
        this.viewStart = 0;
        this.viewEnd = 0;
        this.dragging = false;
        this.dragStartX = 0;
        this.dragStartWindow = null;
        this.lastFocusAlertId = null;

        this.buildScaffold();
        this.bindEvents();
    }

    buildScaffold() {
        if (!this.mount) return;

        this.mount.innerHTML = `
            <div class="chart-shell">
                <div class="chart-toolbar">
                    <div class="chart-meta-stack">
                        <span class="chart-meta">Metric: WSSI score (0-100)</span>
                        <span class="chart-meta timeline-source">Timeline source: --</span>
                        <span class="chart-meta timeline-annotation-count">Annotations: 0</span>
                    </div>
                    <button type="button" class="chart-reset-btn">Reset zoom</button>
                </div>
                <div class="timeline-stage">
                    <canvas class="timeline-canvas" aria-label="WSSI timeline chart"></canvas>
                    <div class="chart-tooltip hidden"></div>
                </div>
                <p class="empty-state hidden"></p>
            </div>
        `;

        this.canvas = this.mount.querySelector(".timeline-canvas");
        this.tooltip = this.mount.querySelector(".chart-tooltip");
        this.emptyState = this.mount.querySelector(".empty-state");
        this.resetBtn = this.mount.querySelector(".chart-reset-btn");
        this.timelineSource = this.mount.querySelector(".timeline-source");
        this.annotationCount = this.mount.querySelector(".timeline-annotation-count");
    }

    bindEvents() {
        if (!this.canvas) return;

        this.resetBtn.addEventListener("click", () => {
            this.resetView();
            this.render();
        });

        this.canvas.addEventListener("mousemove", (event) => {
            const hit = this.hoverPoint(event);
            this.hoverIndex = hit.index;
            this.render();
        });

        this.canvas.addEventListener("mouseleave", () => {
            this.hoverIndex = -1;
            this.tooltip.classList.add("hidden");
            this.render();
        });

        this.canvas.addEventListener("wheel", (event) => {
            if (this.points.length < 5 || !this.layout) return;
            event.preventDefault();

            const visibleCount = this.viewEnd - this.viewStart + 1;
            const zoomIn = event.deltaY < 0;
            let nextCount = zoomIn ? Math.max(8, Math.floor(visibleCount * 0.85)) : Math.min(this.points.length, Math.ceil(visibleCount * 1.15));
            nextCount = clamp(nextCount, 8, this.points.length);

            const p = pointerPosition(event, this.canvas);
            const ratio = clamp((p.x - this.layout.chartLeft) / this.layout.chartWidth, 0, 1);
            const center = this.viewStart + Math.floor(ratio * visibleCount);

            let nextStart = center - Math.floor(nextCount / 2);
            let nextEnd = nextStart + nextCount - 1;
            if (nextStart < 0) {
                nextStart = 0;
                nextEnd = nextCount - 1;
            }
            if (nextEnd >= this.points.length) {
                nextEnd = this.points.length - 1;
                nextStart = Math.max(0, nextEnd - nextCount + 1);
            }

            this.viewStart = nextStart;
            this.viewEnd = nextEnd;
            this.render();
        }, { passive: false });

        this.canvas.addEventListener("mousedown", (event) => {
            if (this.points.length < 8 || !this.layout) return;
            this.dragging = true;
            this.dragStartX = event.clientX;
            this.dragStartWindow = { start: this.viewStart, end: this.viewEnd };
        });

        window.addEventListener("mouseup", () => {
            this.dragging = false;
        });

        window.addEventListener("mousemove", (event) => {
            if (!this.dragging || !this.dragStartWindow || !this.layout) return;
            const deltaPx = event.clientX - this.dragStartX;
            const visibleCount = this.dragStartWindow.end - this.dragStartWindow.start + 1;
            const perIndex = this.layout.chartWidth / Math.max(1, visibleCount - 1);
            const shift = Math.round(-deltaPx / Math.max(1, perIndex));

            let nextStart = this.dragStartWindow.start + shift;
            let nextEnd = this.dragStartWindow.end + shift;
            if (nextStart < 0) {
                nextStart = 0;
                nextEnd = visibleCount - 1;
            }
            if (nextEnd >= this.points.length) {
                nextEnd = this.points.length - 1;
                nextStart = Math.max(0, nextEnd - visibleCount + 1);
            }

            this.viewStart = nextStart;
            this.viewEnd = nextEnd;
            this.render();
        });

        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(this.canvas);
    }

    resetView() {
        this.viewStart = 0;
        this.viewEnd = Math.max(0, this.points.length - 1);
    }

    setData(historySnapshot, alertsSnapshot) {
        this.points = Array.isArray(historySnapshot?.points) ? historySnapshot.points : [];
        this.annotations = Array.isArray(alertsSnapshot?.annotations) ? alertsSnapshot.annotations : [];
        if (this.timelineSource) {
            this.timelineSource.textContent = historySnapshot?.source ? `Timeline source: ${historySnapshot.source}` : "Timeline source: --";
        }
        if (this.annotationCount) {
            this.annotationCount.textContent = `Annotations: ${this.annotations.length}`;
        }
        this.resetView();
        this.hoverIndex = -1;
        this.render();
    }

    focusByAlert(alertRecord) {
        if (!alertRecord || this.points.length === 0) {
            return false;
        }

        const targetDate = typeof alertRecord.createdAt === "string"
            ? alertRecord.createdAt.slice(0, 10)
            : (alertRecord.date ?? null);

        if (!targetDate) {
            return false;
        }

        let idx = this.points.findIndex((point) => point.date === targetDate);
        if (idx < 0) {
            const targetMs = new Date(targetDate).getTime();
            if (!Number.isNaN(targetMs)) {
                let bestIdx = -1;
                let bestDistance = Infinity;
                for (let i = 0; i < this.points.length; i += 1) {
                    const pointMs = Number(this.points[i].timestampMs);
                    if (!Number.isFinite(pointMs)) continue;
                    const distance = Math.abs(pointMs - targetMs);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestIdx = i;
                    }
                }
                idx = bestIdx;
            }
        }

        if (idx < 0) {
            return false;
        }

        this.hoverIndex = idx;
        this.lastFocusAlertId = alertRecord.alertId ?? null;

        const visibleCount = this.viewEnd - this.viewStart + 1;
        if (visibleCount > 0 && (idx < this.viewStart || idx > this.viewEnd)) {
            let nextStart = idx - Math.floor(visibleCount / 2);
            let nextEnd = nextStart + visibleCount - 1;

            if (nextStart < 0) {
                nextStart = 0;
                nextEnd = visibleCount - 1;
            }
            if (nextEnd >= this.points.length) {
                nextEnd = this.points.length - 1;
                nextStart = Math.max(0, nextEnd - visibleCount + 1);
            }

            this.viewStart = nextStart;
            this.viewEnd = nextEnd;
        }

        this.render();
        return true;
    }

    getVisiblePoints() {
        if (this.points.length === 0) return [];
        return this.points.slice(this.viewStart, this.viewEnd + 1);
    }

    hoverPoint(event) {
        if (!this.layout) return { index: -1 };
        const visible = this.getVisiblePoints();
        if (visible.length === 0) return { index: -1 };

        const p = pointerPosition(event, this.canvas);
        if (
            p.x < this.layout.chartLeft ||
            p.x > this.layout.chartLeft + this.layout.chartWidth ||
            p.y < this.layout.chartTop ||
            p.y > this.layout.chartTop + this.layout.chartHeight
        ) {
            return { index: -1 };
        }

        const idxInVisible = nearestIndexByX(
            visible,
            (_, idx) => this.layout.chartLeft + (idx * this.layout.xStep),
            p.x
        );
        const globalIndex = this.viewStart + idxInVisible;
        return { index: globalIndex, point: this.points[globalIndex], pointer: p };
    }

    drawTooltip(hoverData) {
        if (!hoverData?.point || hoverData.index < 0) {
            this.tooltip.classList.add("hidden");
            return;
        }

        const point = hoverData.point;
        this.tooltip.innerHTML = `
            <p><strong>${formatDateLabel(point.date)}</strong></p>
            <p>Score: ${formatNumber(point.wssiScore, 1)}</p>
            <p>Value: ${formatNumber(point.wssiValue, 2)}</p>
            <p>Delta: ${formatNumber(point.wssiDelta, 2)}</p>
            <p>Trend: ${point.trend}</p>
        `;
        this.tooltip.style.left = `${hoverData.pointer.x + 14}px`;
        this.tooltip.style.top = `${hoverData.pointer.y + 14}px`;
        this.tooltip.classList.remove("hidden");
    }

    render() {
        if (!this.canvas || !this.emptyState) return;
        const scaled = scaleCanvas(this.canvas);
        if (!scaled) return;
        const { ctx, width, height } = scaled;
        ctx.clearRect(0, 0, width, height);
        this.tooltip.classList.add("hidden");

        if (this.points.length === 0) {
            this.emptyState.textContent = "No timeline data available.";
            this.emptyState.classList.remove("hidden");
            return;
        }
        this.emptyState.classList.add("hidden");

        const chartLeft = 56;
        const chartTop = 20;
        const chartRight = 16;
        const chartBottom = 38;
        const chartWidth = width - chartLeft - chartRight;
        const chartHeight = height - chartTop - chartBottom;

        const visible = this.getVisiblePoints();
        const xStep = visible.length > 1 ? chartWidth / (visible.length - 1) : chartWidth;

        this.layout = {
            chartLeft,
            chartTop,
            chartWidth,
            chartHeight,
            xStep
        };

        // Bands
        const bandRanges = [
            { name: "critical", min: 75, max: 100, color: "rgba(255,45,85,0.16)" },
            { name: "high", min: 60, max: 75, color: "rgba(255,107,53,0.14)" },
            { name: "elevated", min: 40, max: 60, color: "rgba(244,197,66,0.13)" },
            { name: "stable", min: 0, max: 40, color: "rgba(0,212,170,0.1)" }
        ];
        const yForScore = (score) => chartTop + ((100 - score) / 100) * chartHeight;

        for (const band of bandRanges) {
            const yTop = yForScore(band.max);
            const yBottom = yForScore(band.min);
            ctx.fillStyle = band.color;
            ctx.fillRect(chartLeft, yTop, chartWidth, yBottom - yTop);
        }

        // Grid and y-axis labels
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.fillStyle = "rgba(205,210,220,0.9)";
        ctx.font = "11px var(--font-mono)";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const tick of [0, 25, 50, 75, 100]) {
            const y = yForScore(tick);
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartLeft + chartWidth, y);
            ctx.stroke();
            ctx.fillText(String(tick), chartLeft - 8, y);
        }

        // X-axis labels
        const xTickCount = width <= 480 ? 4 : 7;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(190,196,207,0.85)";
        for (let i = 0; i < xTickCount; i += 1) {
            const ratio = xTickCount === 1 ? 0 : (i / (xTickCount - 1));
            const idx = Math.floor(ratio * (visible.length - 1));
            const x = chartLeft + (idx * xStep);
            const point = visible[idx];
            ctx.fillText(formatDateLabel(point.date), x, chartTop + chartHeight + 6);
        }

        // Timeline line
        ctx.beginPath();
        visible.forEach((point, idx) => {
            const x = chartLeft + (idx * xStep);
            const y = yForScore(point.wssiScore ?? 0);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "rgba(104, 215, 255, 0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Alert annotations
        const visibleDateSet = new Set(visible.map((point) => point.date));
        const filteredAnnotations = this.annotations.filter((item) => visibleDateSet.has(item.date));
        for (const annotation of filteredAnnotations) {
            const idx = visible.findIndex((point) => point.date === annotation.date);
            if (idx < 0) continue;
            const point = visible[idx];
            const x = chartLeft + (idx * xStep);
            const y = yForScore(point.wssiScore ?? 0) - 8;

            ctx.fillStyle = annotationColor(annotation.severity);
            ctx.beginPath();
            ctx.moveTo(x, y - 6);
            ctx.lineTo(x - 5, y + 2);
            ctx.lineTo(x + 5, y + 2);
            ctx.closePath();
            ctx.fill();
        }

        // Hover
        const hover = this.hoverIndex >= this.viewStart && this.hoverIndex <= this.viewEnd
            ? {
                index: this.hoverIndex,
                point: this.points[this.hoverIndex],
                pointer: {
                    x: chartLeft + ((this.hoverIndex - this.viewStart) * xStep),
                    y: yForScore(this.points[this.hoverIndex].wssiScore ?? 0)
                }
            }
            : null;

        if (hover?.point) {
            const hoverX = hover.pointer.x;
            const hoverY = hover.pointer.y;
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hoverX, chartTop);
            ctx.lineTo(hoverX, chartTop + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = "#00d4aa";
            ctx.beginPath();
            ctx.arc(hoverX, hoverY, 4, 0, Math.PI * 2);
            ctx.fill();

            roundRect(ctx, hoverX - 5, hoverY - 5, 10, 10, 4);
            ctx.strokeStyle = "rgba(255,255,255,0.5)";
            ctx.stroke();
        }

        this.drawTooltip(hover);
    }
}
