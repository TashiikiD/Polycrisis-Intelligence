function escapeHtml(input) {
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function fmtValue(value, digits = 2) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function severityRank(severity) {
    if (severity === "critical") return 3;
    if (severity === "warning") return 2;
    if (severity === "info") return 1;
    return 0;
}

export class AlertRegister {
    constructor(mount, options = {}) {
        this.mount = mount;
        this.onAlertSelect = typeof options.onAlertSelect === "function" ? options.onAlertSelect : null;
        this.records = [];
        this.filtered = [];
        this.selectedAlertId = null;
        this.selectedSync = null;
        this.filters = {
            severity: "all",
            status: "all",
            category: "all"
        };

        this.buildScaffold();
        this.render();
    }

    buildScaffold() {
        if (!this.mount) return;
        this.mount.innerHTML = `
            <section class="alert-register-shell">
                <div class="alert-filter-row">
                    <label>
                        <span>Severity</span>
                        <select data-filter="severity">
                            <option value="all">All</option>
                            <option value="critical">Critical</option>
                            <option value="warning">Warning</option>
                            <option value="info">Info</option>
                        </select>
                    </label>
                    <label>
                        <span>Status</span>
                        <select data-filter="status">
                            <option value="all">All</option>
                            <option value="active">Active</option>
                            <option value="resolved">Resolved</option>
                        </select>
                    </label>
                    <label>
                        <span>Category</span>
                        <select data-filter="category"></select>
                    </label>
                </div>
                <div class="alert-table-wrap">
                    <table class="alert-table" aria-label="Alert register">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Title</th>
                                <th>Category</th>
                                <th>Severity</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
                <aside class="alert-drawer hidden" aria-live="polite"></aside>
                <p class="empty-state hidden"></p>
            </section>
        `;

        this.filterInputs = {
            severity: this.mount.querySelector('select[data-filter="severity"]'),
            status: this.mount.querySelector('select[data-filter="status"]'),
            category: this.mount.querySelector('select[data-filter="category"]')
        };
        this.tbody = this.mount.querySelector("tbody");
        this.drawer = this.mount.querySelector(".alert-drawer");
        this.emptyState = this.mount.querySelector(".empty-state");

        Object.values(this.filterInputs).forEach((input) => {
            input.addEventListener("change", () => {
                this.filters[input.dataset.filter] = input.value;
                this.applyFilters();
                this.renderTable();
                this.renderDrawer();
            });
        });
    }

    setSnapshot(snapshot) {
        this.records = Array.isArray(snapshot?.records) ? [...snapshot.records] : [];
        this.records.sort((a, b) => {
            const aTime = a.createdAtMs ?? Number.NEGATIVE_INFINITY;
            const bTime = b.createdAtMs ?? Number.NEGATIVE_INFINITY;
            if (aTime !== bTime) return bTime - aTime;
            return severityRank(b.severity) - severityRank(a.severity);
        });
        this.refreshCategoryFilter();
        this.applyFilters();

        if (!this.selectedAlertId && this.filtered.length > 0) {
            this.selectedAlertId = this.filtered[0].alertId;
        } else if (this.selectedAlertId && !this.records.some((record) => record.alertId === this.selectedAlertId)) {
            this.selectedAlertId = this.filtered[0]?.alertId ?? null;
        }

        this.render();
    }

    refreshCategoryFilter() {
        const categories = ["all", ...new Set(this.records.map((record) => record.category).filter(Boolean))];
        const prev = this.filters.category;
        this.filterInputs.category.innerHTML = categories
            .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value === "all" ? "All" : value)}</option>`)
            .join("");
        this.filters.category = categories.includes(prev) ? prev : "all";
        this.filterInputs.category.value = this.filters.category;
    }

    applyFilters() {
        this.filtered = this.records.filter((record) => {
            if (this.filters.severity !== "all" && record.severity !== this.filters.severity) return false;
            if (this.filters.status !== "all" && record.status !== this.filters.status) return false;
            if (this.filters.category !== "all" && record.category !== this.filters.category) return false;
            return true;
        });
    }

    getSelectedRecord() {
        return this.records.find((record) => record.alertId === this.selectedAlertId) ?? null;
    }

    selectAlert(alertId) {
        this.selectedAlertId = alertId;
        this.selectedSync = null;
        this.renderTable();
        this.renderDrawer();

        const selected = this.getSelectedRecord();
        if (!selected || !this.onAlertSelect) return;

        const syncResult = this.onAlertSelect(selected);
        Promise.resolve(syncResult).then((result) => {
            if (this.selectedAlertId !== selected.alertId) return;
            this.selectedSync = (result && typeof result === "object") ? result : null;
            this.renderDrawer();
        }).catch(() => {
            this.selectedSync = null;
            this.renderDrawer();
        });
    }

    renderTable() {
        if (!this.tbody || !this.emptyState) return;
        if (this.filtered.length === 0) {
            this.tbody.innerHTML = "";
            this.emptyState.textContent = "No alerts match the current filters.";
            this.emptyState.classList.remove("hidden");
            return;
        }

        this.emptyState.classList.add("hidden");
        this.tbody.innerHTML = this.filtered.map((record) => `
            <tr class="alert-row ${record.alertId === this.selectedAlertId ? "is-selected" : ""}" data-alert-id="${escapeHtml(record.alertId)}" tabindex="0">
                <td>${escapeHtml(record.relativeTimeLabel)}</td>
                <td>${escapeHtml(record.title)}</td>
                <td>${escapeHtml(record.category)}</td>
                <td><span class="alert-severity severity-${escapeHtml(record.severity)}">${escapeHtml(record.severity)}</span></td>
                <td><span class="alert-status status-${escapeHtml(record.status)}">${escapeHtml(record.status)}</span></td>
            </tr>
        `).join("");

        this.tbody.querySelectorAll(".alert-row").forEach((rowEl) => {
            const alertId = rowEl.dataset.alertId;
            rowEl.addEventListener("click", () => this.selectAlert(alertId));
            rowEl.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.selectAlert(alertId);
                }
            });
        });
    }

    renderDrawer() {
        if (!this.drawer) return;
        const selected = this.getSelectedRecord();
        if (!selected) {
            this.drawer.classList.add("hidden");
            this.drawer.innerHTML = "";
            return;
        }

        const syncNotes = [];
        if (this.selectedSync?.timelineMatched === false) {
            syncNotes.push("Timeline focus unavailable for this alert date in current 90-day window.");
        }
        if (this.selectedSync?.networkMatched === false) {
            syncNotes.push("No matching network theme nodes available for this alert selection.");
        }
        if (syncNotes.length === 0) {
            syncNotes.push("Timeline and network sync attempted from this alert selection.");
        }

        this.drawer.innerHTML = `
            <div class="alert-drawer-inner">
                <h3>${escapeHtml(selected.title)}</h3>
                <p class="alert-drawer-meta">${escapeHtml(selected.category)} · ${escapeHtml(selected.severity)} · ${escapeHtml(selected.status)}</p>
                <p class="alert-drawer-description">${escapeHtml(selected.description)}</p>
                <dl class="alert-meta-grid">
                    <div><dt>Alert ID</dt><dd>${escapeHtml(selected.alertId)}</dd></div>
                    <div><dt>Created</dt><dd>${escapeHtml(selected.createdAt ?? "Unknown")}</dd></div>
                    <div><dt>Relative</dt><dd>${escapeHtml(selected.relativeTimeLabel)}</dd></div>
                    <div><dt>Theme IDs</dt><dd>${escapeHtml(selected.themeIds.join(", ") || "None")}</dd></div>
                    <div><dt>Indicator</dt><dd>${escapeHtml(selected.indicatorId ?? "None")}</dd></div>
                    <div><dt>Threshold</dt><dd>${fmtValue(selected.threshold)}</dd></div>
                    <div><dt>Trigger</dt><dd>${fmtValue(selected.triggerValue)}</dd></div>
                </dl>
                <p class="alert-sync-note">${escapeHtml(syncNotes.join(" "))}</p>
            </div>
        `;
        this.drawer.classList.remove("hidden");
    }

    render() {
        if (!this.mount) return;
        this.renderTable();
        this.renderDrawer();
    }
}
