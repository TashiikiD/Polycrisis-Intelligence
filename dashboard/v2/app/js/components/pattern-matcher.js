import { clamp, formatNumber, scaleCanvas } from "../utils/chart-helpers.js";

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function confidenceClass(value) {
    if (value === "high") return "confidence-high";
    if (value === "medium") return "confidence-medium";
    if (value === "low") return "confidence-low";
    return "confidence-unknown";
}

function confidenceNorm(value) {
    if (value === "high") return 1;
    if (value === "medium") return 0.67;
    if (value === "low") return 0.33;
    return 0.2;
}

function toList(values) {
    return Array.isArray(values) ? values.map((item) => String(item)) : [];
}

function radarModel(match) {
    const overlap = toList(match?.diagnostics?.overlap);
    const missing = toList(match?.diagnostics?.missingIndicators);
    const overlapCount = overlap.length;
    const missingCount = missing.length;
    const requiredOverlapMin = Math.max(1, Number(match?.requiredOverlapMin) || 1);

    return {
        selectedEpisodeId: match?.episodeId ?? "",
        axes: [
            { key: "similarity", label: "Similarity", value01: clamp((Number(match?.similarityPct) || 0) / 100, 0, 1) },
            { key: "cosine", label: "Raw Cosine", value01: clamp(Number(match?.diagnostics?.rawCosine) || 0, 0, 1) },
            { key: "penalty", label: "Penalty", value01: clamp(Number(match?.diagnostics?.penalty) || 0, 0, 1) },
            { key: "overlap", label: "Overlap Strength", value01: clamp(overlapCount / requiredOverlapMin, 0, 1) },
            { key: "coverage", label: "Coverage", value01: clamp(overlapCount / Math.max(1, overlapCount + missingCount), 0, 1) },
            { key: "confidence", label: "Confidence", value01: confidenceNorm(match?.confidenceTier) }
        ]
    };
}

export class PatternMatcher {
    constructor(mount) {
        this.mount = mount;
        this.snapshot = null;
        this.selectedEpisodeId = null;
        this.resizeObserver = null;

        this.buildScaffold();
        this.bindEvents();
    }

    buildScaffold() {
        if (!this.mount) return;

        this.mount.innerHTML = `
            <section class="pattern-shell">
                <header class="pattern-header">
                    <h3 class="pattern-headline">No pattern matches available.</h3>
                    <p class="pattern-subhead">
                        Historical analogs are not predictions; they indicate structural similarity under current data coverage.
                    </p>
                </header>

                <div class="pattern-body">
                    <section class="pattern-list-block">
                        <h4>Top historical analogs</h4>
                        <div class="pattern-list"></div>
                    </section>

                    <section class="pattern-radar-block">
                        <div class="pattern-meta">
                            <span class="pattern-source">Pattern source: --</span>
                            <span class="pattern-method">Method: --</span>
                        </div>
                        <div class="pattern-stage">
                            <canvas class="pattern-radar-canvas" aria-label="Pattern diagnostic proxy radar"></canvas>
                        </div>
                        <p class="pattern-proxy-note">Radar is a diagnostic proxy built from similarity diagnostics, not full vector parity.</p>
                    </section>
                </div>

                <section class="pattern-diagnostics"></section>
                <p class="empty-state hidden"></p>
            </section>
        `;

        this.headline = this.mount.querySelector(".pattern-headline");
        this.list = this.mount.querySelector(".pattern-list");
        this.metaSource = this.mount.querySelector(".pattern-source");
        this.metaMethod = this.mount.querySelector(".pattern-method");
        this.canvas = this.mount.querySelector(".pattern-radar-canvas");
        this.diagnostics = this.mount.querySelector(".pattern-diagnostics");
        this.emptyState = this.mount.querySelector(".empty-state");
    }

    bindEvents() {
        if (!this.canvas) return;
        this.resizeObserver = new ResizeObserver(() => this.renderRadar());
        this.resizeObserver.observe(this.canvas);
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot ?? null;
        const matches = this.snapshot?.matches ?? [];

        if (!this.selectedEpisodeId || !matches.some((item) => item.episodeId === this.selectedEpisodeId)) {
            this.selectedEpisodeId = matches[0]?.episodeId ?? null;
        }

        this.render();
    }

    get selectedMatch() {
        const matches = this.snapshot?.matches ?? [];
        if (!this.selectedEpisodeId) return matches[0] ?? null;
        return matches.find((item) => item.episodeId === this.selectedEpisodeId) ?? matches[0] ?? null;
    }

    selectEpisode(episodeId) {
        this.selectedEpisodeId = episodeId;
        this.render();
    }

    renderList() {
        const matches = this.snapshot?.matches ?? [];
        const topThree = matches.slice(0, 3);
        this.list.innerHTML = topThree.map((item) => `
            <button type="button" class="pattern-item ${item.episodeId === this.selectedEpisodeId ? "is-active" : ""}" data-episode-id="${escapeHtml(item.episodeId)}">
                <div class="pattern-item-main">
                    <span class="pattern-item-label">${escapeHtml(item.label)}</span>
                    <span class="pattern-item-period">${escapeHtml(item.period || "Unknown period")}</span>
                </div>
                <div class="pattern-item-side">
                    <span class="pattern-similarity">${formatNumber(item.similarityPct, 1)}%</span>
                    <span class="pattern-confidence ${confidenceClass(item.confidenceTier)}">${escapeHtml(item.confidenceTier)}</span>
                </div>
            </button>
        `).join("");

        this.list.querySelectorAll(".pattern-item").forEach((button) => {
            const episodeId = button.dataset.episodeId;
            button.addEventListener("click", () => this.selectEpisode(episodeId));
        });
    }

    renderDiagnostics() {
        const match = this.selectedMatch;
        if (!match) {
            this.diagnostics.innerHTML = "";
            return;
        }

        const overlap = toList(match.diagnostics?.overlap);
        const missing = toList(match.diagnostics?.missingIndicators);

        const overlapHtml = overlap.length > 0
            ? overlap.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
            : "<li>None</li>";
        const missingHtml = missing.length > 0
            ? missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
            : "<li>None</li>";

        this.diagnostics.innerHTML = `
            <div class="pattern-diagnostics-grid">
                <article>
                    <h4>${escapeHtml(match.label)}</h4>
                    <p class="pattern-description">${escapeHtml(match.description || "No description available.")}</p>
                    <dl class="pattern-kv">
                        <div><dt>Episode Period</dt><dd>${escapeHtml(match.period || "--")}</dd></div>
                        <div><dt>Method</dt><dd>${escapeHtml(this.snapshot?.method || "--")}</dd></div>
                        <div><dt>Raw Cosine</dt><dd>${formatNumber(match.diagnostics?.rawCosine, 4)}</dd></div>
                        <div><dt>Penalty</dt><dd>${formatNumber(match.diagnostics?.penalty, 2)}</dd></div>
                        <div><dt>Required overlap</dt><dd>${formatNumber(match.requiredOverlapMin, 0)}</dd></div>
                        <div><dt>Current vector size</dt><dd>${formatNumber(this.snapshot?.currentVectorSize, 0)}</dd></div>
                    </dl>
                </article>
                <article>
                    <h5>Overlap indicators</h5>
                    <ul class="pattern-listing">${overlapHtml}</ul>
                    <h5>Missing indicators</h5>
                    <ul class="pattern-listing">${missingHtml}</ul>
                </article>
            </div>
        `;
    }

    renderRadar() {
        if (!this.canvas) return;
        const scaled = scaleCanvas(this.canvas);
        if (!scaled) return;

        const { ctx, width, height } = scaled;
        ctx.clearRect(0, 0, width, height);

        const match = this.selectedMatch;
        if (!match) return;

        const model = radarModel(match);
        const axes = model.axes;
        if (axes.length === 0) return;

        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.32;
        const steps = 4;

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;

        for (let step = 1; step <= steps; step += 1) {
            const stepRadius = (radius * step) / steps;
            ctx.beginPath();
            for (let i = 0; i < axes.length; i += 1) {
                const angle = ((Math.PI * 2) * i / axes.length) - (Math.PI / 2);
                const x = cx + (Math.cos(angle) * stepRadius);
                const y = cy + (Math.sin(angle) * stepRadius);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }

        for (let i = 0; i < axes.length; i += 1) {
            const angle = ((Math.PI * 2) * i / axes.length) - (Math.PI / 2);
            const x = cx + (Math.cos(angle) * radius);
            const y = cy + (Math.sin(angle) * radius);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(x, y);
            ctx.stroke();
        }

        ctx.beginPath();
        for (let i = 0; i < axes.length; i += 1) {
            const axis = axes[i];
            const angle = ((Math.PI * 2) * i / axes.length) - (Math.PI / 2);
            const x = cx + (Math.cos(angle) * (radius * axis.value01));
            const y = cy + (Math.sin(angle) * (radius * axis.value01));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(0, 212, 170, 0.22)";
        ctx.strokeStyle = "rgba(0, 212, 170, 0.95)";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        ctx.font = "11px var(--font-mono)";
        ctx.fillStyle = "rgba(216, 224, 236, 0.95)";
        for (let i = 0; i < axes.length; i += 1) {
            const axis = axes[i];
            const angle = ((Math.PI * 2) * i / axes.length) - (Math.PI / 2);
            const x = cx + (Math.cos(angle) * (radius + 18));
            const y = cy + (Math.sin(angle) * (radius + 18));
            ctx.textAlign = x < cx - 2 ? "right" : (x > cx + 2 ? "left" : "center");
            ctx.textBaseline = y < cy ? "bottom" : "top";
            ctx.fillText(axis.label, x, y);
        }
        ctx.restore();
    }

    render() {
        if (!this.mount) return;

        const matches = this.snapshot?.matches ?? [];
        if (this.metaSource) {
            this.metaSource.textContent = this.snapshot ? `Pattern source: ${this.snapshot.source}` : "Pattern source: --";
        }
        if (this.metaMethod) {
            this.metaMethod.textContent = `Method: ${this.snapshot?.method || "--"}`;
        }

        if (matches.length === 0) {
            this.headline.textContent = "No pattern matches available.";
            this.list.innerHTML = "";
            this.diagnostics.innerHTML = "";
            this.emptyState.textContent = "No pattern matches available.";
            this.emptyState.classList.remove("hidden");
            this.renderRadar();
            return;
        }

        this.emptyState.classList.add("hidden");
        const lead = matches[0];
        this.headline.textContent = `Current conditions show ${formatNumber(lead.similarityPct, 1)}% similarity to ${lead.label}.`;
        this.renderList();
        this.renderDiagnostics();
        this.renderRadar();
    }
}
