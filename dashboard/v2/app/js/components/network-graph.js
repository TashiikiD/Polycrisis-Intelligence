import { formatNumber, pointerPosition, scaleCanvas } from "../utils/chart-helpers.js";

const CATEGORY_ORDER = [
    "Economic-Financial",
    "Climate-Environmental",
    "Geopolitical-Conflict",
    "Technological",
    "Biological-Health",
    "Cross-System"
];

const STRESS_COLORS = {
    stable: "#00d4aa",
    watch: "#f4c542",
    approaching: "#ff6b35",
    critical: "#ff2d55",
    unknown: "#8f9aad",
    bridge: "#6e7688"
};

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function edgeDash(evidence) {
    if (evidence === "established") return [];
    if (evidence === "documented") return [6, 4];
    if (evidence === "emerging") return [2, 4];
    return [4, 4];
}

function edgeAlpha(evidence) {
    if (evidence === "established") return 0.68;
    if (evidence === "documented") return 0.56;
    if (evidence === "emerging") return 0.48;
    return 0.35;
}

export class NetworkGraph {
    constructor(mount, options = {}) {
        this.mount = mount;
        this.snapshot = null;
        this.themeById = new Map();
        this.onThemeSelect = typeof options.onThemeSelect === "function" ? options.onThemeSelect : null;
        this.activeNodeId = null;
        this.hoverNode = null;
        this.highlightedThemeIds = new Set();
        this.visibleCategories = new Set(CATEGORY_ORDER);
        this.focusIndex = 0;
        this.drawnNodes = [];

        this.buildScaffold();
        this.bindEvents();
    }

    buildScaffold() {
        if (!this.mount) return;
        this.mount.innerHTML = `
            <div class="chart-shell network-shell">
                <div class="chart-toolbar network-toolbar">
                    <div class="chart-meta-stack">
                        <span class="chart-meta network-source">Network source: --</span>
                        <span class="chart-meta network-count">Nodes: 0 · Edges: 0</span>
                    </div>
                </div>
                <div class="network-toggle-row" role="group" aria-label="Network categories"></div>
                <div class="network-stage">
                    <canvas class="network-canvas" tabindex="0" aria-label="System network graph"></canvas>
                    <div class="chart-tooltip hidden"></div>
                </div>
                <p class="network-legend-text">Node color = stress tier. Edge line style = evidence tier.</p>
                <p class="empty-state hidden"></p>
            </div>
        `;
        this.canvas = this.mount.querySelector(".network-canvas");
        this.tooltip = this.mount.querySelector(".chart-tooltip");
        this.emptyState = this.mount.querySelector(".empty-state");
        this.sourceLabel = this.mount.querySelector(".network-source");
        this.countLabel = this.mount.querySelector(".network-count");
        this.toggleRow = this.mount.querySelector(".network-toggle-row");
    }

    bindEvents() {
        if (!this.canvas) return;
        this.canvas.addEventListener("mousemove", (event) => {
            this.hoverNode = this.nodeAtPointer(event);
            this.render();
        });
        this.canvas.addEventListener("mouseleave", () => {
            this.hoverNode = null;
            this.tooltip.classList.add("hidden");
            this.render();
        });
        this.canvas.addEventListener("click", (event) => {
            const hit = this.nodeAtPointer(event);
            if (!hit) return;
            this.selectNode(hit.node.id, true);
        });
        this.canvas.addEventListener("keydown", (event) => {
            const visibleNodes = this.getVisibleNodes();
            if (visibleNodes.length === 0) return;

            let handled = true;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                this.focusIndex = (this.focusIndex + 1) % visibleNodes.length;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                this.focusIndex = (this.focusIndex - 1 + visibleNodes.length) % visibleNodes.length;
            } else if (event.key === "Enter" || event.key === " ") {
                this.selectNode(visibleNodes[this.focusIndex].id, true);
            } else {
                handled = false;
            }

            if (handled) {
                event.preventDefault();
                this.activeNodeId = visibleNodes[this.focusIndex].id;
                this.render();
            }
        });

        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(this.canvas);
    }

    setSnapshot(snapshot) {
        this.snapshot = snapshot ?? null;
        this.hoverNode = null;
        if (this.sourceLabel) {
            this.sourceLabel.textContent = this.snapshot ? `Network source: ${this.snapshot.source}` : "Network source: --";
        }
        if (this.countLabel) {
            const nodeCount = this.snapshot?.nodeCount ?? 0;
            const edgeCount = this.snapshot?.edgeCount ?? 0;
            this.countLabel.textContent = `Nodes: ${nodeCount} · Edges: ${edgeCount}`;
        }
        this.renderCategoryToggles();
        this.render();
    }

    setThemeMetrics(rows) {
        this.themeById = new Map();
        if (Array.isArray(rows)) {
            rows.forEach((row) => this.themeById.set(row.themeId, row));
        }
        this.render();
    }

    highlightThemes(themeIds) {
        this.highlightedThemeIds = new Set((themeIds ?? []).map((item) => String(item)));
        const matchingNode = this.getVisibleNodes().find((node) => node.themeId && this.highlightedThemeIds.has(node.themeId));
        if (matchingNode) {
            this.activeNodeId = matchingNode.id;
            this.focusIndex = Math.max(0, this.getVisibleNodes().findIndex((n) => n.id === matchingNode.id));
        }
        this.render();
        return Boolean(matchingNode);
    }

    renderCategoryToggles() {
        if (!this.toggleRow) return;
        const categories = new Set(CATEGORY_ORDER);
        (this.snapshot?.nodes ?? []).forEach((node) => categories.add(node.category));
        const ordered = [...categories];
        ordered.sort((a, b) => {
            const ai = CATEGORY_ORDER.indexOf(a);
            const bi = CATEGORY_ORDER.indexOf(b);
            if (ai >= 0 && bi >= 0) return ai - bi;
            if (ai >= 0) return -1;
            if (bi >= 0) return 1;
            return a.localeCompare(b);
        });

        this.toggleRow.innerHTML = ordered.map((category) => `
            <label class="network-toggle">
                <input type="checkbox" data-category="${escapeHtml(category)}" ${this.visibleCategories.has(category) ? "checked" : ""}>
                <span>${escapeHtml(category)}</span>
            </label>
        `).join("");

        this.toggleRow.querySelectorAll("input[data-category]").forEach((input) => {
            input.addEventListener("change", () => {
                const category = input.dataset.category;
                if (!category) return;
                if (input.checked) this.visibleCategories.add(category);
                else this.visibleCategories.delete(category);

                if (this.visibleCategories.size === 0) {
                    this.visibleCategories.add(category);
                    input.checked = true;
                }

                this.focusIndex = 0;
                this.render();
            });
        });
    }

    nodeAtPointer(event) {
        const pointer = pointerPosition(event, this.canvas);
        for (let i = this.drawnNodes.length - 1; i >= 0; i -= 1) {
            const candidate = this.drawnNodes[i];
            const dx = pointer.x - candidate.x;
            const dy = pointer.y - candidate.y;
            if ((dx * dx) + (dy * dy) <= candidate.radius * candidate.radius) {
                return candidate;
            }
        }
        return null;
    }

    selectNode(nodeId, emitTheme) {
        this.activeNodeId = nodeId;
        const nodes = this.getVisibleNodes();
        this.focusIndex = Math.max(0, nodes.findIndex((node) => node.id === nodeId));
        const selected = nodes[this.focusIndex];
        if (emitTheme && selected?.themeId && this.onThemeSelect) {
            this.onThemeSelect(selected.themeId);
        }
        this.render();
    }

    getVisibleNodes() {
        if (!this.snapshot) return [];
        return this.snapshot.nodes.filter((node) => this.visibleCategories.has(node.category));
    }

    getVisibleEdges(visibleNodeIds) {
        if (!this.snapshot) return [];
        let edges = this.snapshot.edges.filter((edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId));
        const isMobile = window.innerWidth <= 768;
        if (isMobile && edges.length > 24) {
            edges = [...edges].sort((a, b) => b.weight - a.weight).slice(0, 24);
        }
        return edges;
    }

    computeLayout(width, height, nodes) {
        const pad = 36;
        const minX = Math.min(...nodes.map((node) => node.xHint));
        const maxX = Math.max(...nodes.map((node) => node.xHint));
        const minY = Math.min(...nodes.map((node) => node.yHint));
        const maxY = Math.max(...nodes.map((node) => node.yHint));
        const rangeX = Math.max(1, maxX - minX);
        const rangeY = Math.max(1, maxY - minY);

        const sizeValues = nodes.map((node) => node.sizeScore);
        const minSize = Math.min(...sizeValues);
        const maxSize = Math.max(...sizeValues);
        const sizeRange = Math.max(0.0001, maxSize - minSize);

        const positions = new Map();
        nodes.forEach((node) => {
            const x = pad + (((node.xHint - minX) / rangeX) * (width - (pad * 2)));
            const y = pad + (((node.yHint - minY) / rangeY) * (height - (pad * 2)));
            const radius = 6 + (((node.sizeScore - minSize) / sizeRange) * 10);
            positions.set(node.id, { x, y, radius, node });
        });
        return positions;
    }

    stressForNode(node) {
        if (!node.themeId) return "bridge";
        const row = this.themeById.get(node.themeId);
        if (row?.stressLevel) return row.stressLevel;
        return node.stressLevel ?? "unknown";
    }

    drawTooltip(hit) {
        if (!hit || !this.tooltip || !this.snapshot) {
            this.tooltip.classList.add("hidden");
            return;
        }

        const stress = this.stressForNode(hit.node);
        const metric = this.snapshot.metricsByNodeId?.[hit.node.id] ?? {};
        this.tooltip.innerHTML = `
            <p><strong>${escapeHtml(hit.node.label)}</strong></p>
            <p>${escapeHtml(hit.node.category)}</p>
            <p>Stress: ${escapeHtml(stress)}</p>
            <p>Degree: ${formatNumber(metric.degree_total, 0)}</p>
            <p>PageRank: ${formatNumber(metric.pagerank, 3)}</p>
        `;
        this.tooltip.style.left = `${hit.x + 12}px`;
        this.tooltip.style.top = `${hit.y + 12}px`;
        this.tooltip.classList.remove("hidden");
    }

    render() {
        if (!this.canvas || !this.emptyState) return;
        const scaled = scaleCanvas(this.canvas);
        if (!scaled) return;
        const { ctx, width, height } = scaled;
        ctx.clearRect(0, 0, width, height);
        this.tooltip.classList.add("hidden");
        this.drawnNodes = [];

        const nodes = this.getVisibleNodes();
        if (!this.snapshot || nodes.length === 0) {
            this.emptyState.textContent = "No network nodes available.";
            this.emptyState.classList.remove("hidden");
            return;
        }
        this.emptyState.classList.add("hidden");

        const visibleNodeIds = new Set(nodes.map((node) => node.id));
        const edges = this.getVisibleEdges(visibleNodeIds);
        const positions = this.computeLayout(width, height, nodes);

        const adjacency = new Map();
        edges.forEach((edge) => {
            if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
            if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
            adjacency.get(edge.sourceId).add(edge.targetId);
            adjacency.get(edge.targetId).add(edge.sourceId);
        });

        const activeAdj = this.activeNodeId ? adjacency.get(this.activeNodeId) ?? new Set() : new Set();

        edges.forEach((edge) => {
            const src = positions.get(edge.sourceId);
            const tgt = positions.get(edge.targetId);
            if (!src || !tgt) return;

            const connectedToActive = this.activeNodeId && (edge.sourceId === this.activeNodeId || edge.targetId === this.activeNodeId);
            const dimmedByActive = this.activeNodeId && !connectedToActive;
            const alpha = dimmedByActive ? 0.15 : edgeAlpha(edge.evidence);

            ctx.save();
            ctx.strokeStyle = `rgba(158, 176, 200, ${alpha})`;
            ctx.lineWidth = 1 + (edge.weight * 2.8);
            ctx.setLineDash(edgeDash(edge.evidence));
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(tgt.x, tgt.y);
            ctx.stroke();
            ctx.restore();
        });

        nodes.forEach((node) => {
            const positioned = positions.get(node.id);
            if (!positioned) return;
            const stress = this.stressForNode(node);
            const fill = STRESS_COLORS[stress] ?? STRESS_COLORS.unknown;
            const isActive = node.id === this.activeNodeId;
            const isHover = this.hoverNode?.node?.id === node.id;
            const isAdjacent = this.activeNodeId && activeAdj.has(node.id);
            const isHighlightedTheme = node.themeId && this.highlightedThemeIds.has(node.themeId);

            ctx.save();
            ctx.fillStyle = fill;
            ctx.globalAlpha = (this.activeNodeId && !isActive && !isAdjacent && !isHighlightedTheme) ? 0.45 : 0.95;
            ctx.beginPath();
            ctx.arc(positioned.x, positioned.y, positioned.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            ctx.strokeStyle = isActive ? "#ffffff" : (isHover || isHighlightedTheme ? "#7dd3fc" : "rgba(15, 18, 28, 0.95)");
            ctx.lineWidth = isActive ? 2.6 : 1.3;
            ctx.stroke();
            ctx.restore();

            if (isHover || isActive) {
                ctx.save();
                ctx.font = "11px var(--font-mono)";
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                ctx.fillStyle = "rgba(236, 241, 252, 0.95)";
                ctx.fillText(node.label, positioned.x, positioned.y - (positioned.radius + 6));
                ctx.restore();
            }

            this.drawnNodes.push({ ...positioned, node });
        });

        const focusTarget = this.getVisibleNodes()[this.focusIndex];
        if (focusTarget) {
            const p = positions.get(focusTarget.id);
            if (p) {
                ctx.save();
                ctx.strokeStyle = "rgba(0, 212, 170, 0.85)";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius + 4, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        this.drawTooltip(this.hoverNode);
    }
}
