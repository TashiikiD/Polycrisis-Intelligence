/**
 * Data Freshness Module
 * Displays last updated timestamps and data age indicators
 */

(function() {
    'use strict';

    const DataFreshness = {
        // Configuration
        config: {
            warningThreshold: 7,  // days - show warning if older
            staleThreshold: 30,   // days - show stale if older
            dateFormat: 'en-US'
        },

        /**
         * Calculate freshness status based on date
         * @param {Date|string} date - The date to check
         * @returns {Object} - { status: 'fresh'|'recent'|'warning'|'stale', days: number, label: string }
         */
        getFreshness(date) {
            const checkDate = new Date(date);
            const now = new Date();
            const diffMs = now - checkDate;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            let status = 'fresh';
            let label = 'Today';

            if (diffDays === 0) {
                status = 'fresh';
                label = 'Today';
            } else if (diffDays === 1) {
                status = 'recent';
                label = 'Yesterday';
            } else if (diffDays < 7) {
                status = 'recent';
                label = `${diffDays} days ago`;
            } else if (diffDays < this.config.warningThreshold) {
                status = 'recent';
                label = `${diffDays} days ago`;
            } else if (diffDays < this.config.staleThreshold) {
                status = 'warning';
                label = `${diffDays} days ago`;
            } else {
                status = 'stale';
                label = `${diffDays} days ago`;
            }

            return { status, days: diffDays, label };
        },

        /**
         * Format date for display
         * @param {Date|string} date 
         * @returns {string}
         */
        formatDate(date) {
            const d = new Date(date);
            return d.toLocaleDateString(this.config.dateFormat, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        },

        /**
         * Format datetime for display
         * @param {Date|string} date 
         * @returns {string}
         */
        formatDateTime(date) {
            const d = new Date(date);
            return d.toLocaleDateString(this.config.dateFormat, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        /**
         * Create freshness indicator element
         * @param {Date|string} date 
         * @param {Object} options - { showTime: boolean, compact: boolean }
         * @returns {HTMLElement}
         */
        createIndicator(date, options = {}) {
            const { showTime = false, compact = false } = options;
            const freshness = this.getFreshness(date);
            
            const el = document.createElement('span');
            el.className = `freshness-indicator freshness-${freshness.status}`;
            el.title = showTime ? this.formatDateTime(date) : this.formatDate(date);
            
            if (compact) {
                el.textContent = freshness.label;
            } else {
                const icon = this.getStatusIcon(freshness.status);
                el.innerHTML = `${icon} Updated ${freshness.label}`;
            }
            
            return el;
        },

        /**
         * Get icon for status
         * @param {string} status 
         * @returns {string}
         */
        getStatusIcon(status) {
            const icons = {
                fresh: '🟢',
                recent: '🟡',
                warning: '🟠',
                stale: '🔴'
            };
            return icons[status] || '⚪';
        },

        /**
         * Create date range display
         * @param {Date|string} startDate 
         * @param {Date|string} endDate 
         * @returns {HTMLElement}
         */
        createDateRange(startDate, endDate) {
            const el = document.createElement('span');
            el.className = 'date-range';
            el.innerHTML = `
                <span class="date-range-label">Data range:</span>
                <span class="date-range-value">
                    ${this.formatDate(startDate)} — ${this.formatDate(endDate)}
                </span>
            `;
            return el;
        },

        /**
         * Initialize freshness display for a container
         * @param {string} containerSelector - CSS selector for container
         * @param {Date|string} date - Last update date
         * @param {Object} options 
         */
        init(containerSelector, date, options = {}) {
            const container = document.querySelector(containerSelector);
            if (!container) return;

            // Clear existing
            const existing = container.querySelector('.freshness-container');
            if (existing) existing.remove();

            const wrapper = document.createElement('div');
            wrapper.className = 'freshness-container';

            // Add freshness indicator
            const indicator = this.createIndicator(date, options);
            wrapper.appendChild(indicator);

            // Add date range if provided
            if (options.dateRange) {
                const rangeEl = this.createDateRange(options.dateRange.start, options.dateRange.end);
                wrapper.appendChild(rangeEl);
            }

            container.appendChild(wrapper);
        }
    };

    // Expose globally
    window.DataFreshness = DataFreshness;
})();
