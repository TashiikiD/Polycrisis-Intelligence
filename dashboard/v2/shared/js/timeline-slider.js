/**
 * TimelineSlider - D3-based timeline component for event filtering
 * 
 * Features:
 * - Brush-based date range selection
 * - Histogram showing event density over time
 * - Tier-aware (shows paywall boundary for free users)
 * - Integrates with EventArchive for data
 * 
 * Usage:
 *   const slider = new TimelineSlider('#timeline-container', {
 *     archive: eventArchiveInstance,
 *     onChange: (range) => console.log(range) // {start, end}
 *   });
 *   await slider.init();
 */

class TimelineSlider {
    constructor(containerSelector, options = {}) {
        this.container = document.querySelector(containerSelector);
        this.archive = options.archive;
        this.onChange = options.onChange || (() => {});
        this.onPaywall = options.onPaywall || (() => {});
        
        // Dimensions
        this.margin = { top: 20, right: 30, bottom: 40, left: 50 };
        this.width = options.width || 800;
        this.height = options.height || 120;
        this.innerWidth = this.width - this.margin.left - this.margin.right;
        this.innerHeight = this.height - this.margin.top - this.margin.bottom;
        
        // State
        this.dateRange = null;
        this.selectedRange = null;
        this.data = [];
        
        // D3 selections
        this.svg = null;
        this.xScale = null;
        this.yScale = null;
        this.brush = null;
        this.brushGroup = null;
    }

    /**
     * Initialize the timeline slider
     */
    async init() {
        if (!this.container) {
            throw new Error(`Container not found: ${this.container}`);
        }
        
        // Load D3 if not present
        if (typeof d3 === 'undefined') {
            await this._loadD3();
        }
        
        // Get data from archive
        await this._loadData();
        
        // Render
        this._render();
        
        return this;
    }

    /**
     * Load event data from archive
     */
    async _loadData() {
        if (!this.archive) {
            // Demo data if no archive
            this.data = this._generateDemoData();
        } else {
            // Get timeline data from archive
            const timelineData = await this.archive.getTimelineData();
            this.data = timelineData.daily || [];
        }
        
        // Determine date range
        if (this.data.length > 0) {
            const dates = this.data.map(d => new Date(d.date));
            this.dateRange = {
                start: new Date(Math.min(...dates)),
                end: new Date(Math.max(...dates))
            };
        } else {
            // Default: last 30 days
            this.dateRange = {
                end: new Date(),
                start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            };
        }
        
        // Initial selection: full range or last 30 days for free tier
        if (this.archive && this.archive.tier === 'free') {
            this.selectedRange = {
                start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                end: new Date()
            };
        } else {
            this.selectedRange = { ...this.dateRange };
        }
    }

    /**
     * Render the timeline
     */
    _render() {
        // Clear container
        this.container.innerHTML = '';
        
        // Create SVG
        this.svg = d3.select(this.container)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('viewBox', `0 0 ${this.width} ${this.height}`);
        
        // Add background
        this.svg.append('rect')
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('fill', 'var(--bg-secondary, #1a1a2e)')
            .attr('rx', 8);
        
        const g = this.svg.append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
        
        // Create scales
        this.xScale = d3.scaleTime()
            .domain([this.dateRange.start, this.dateRange.end])
            .range([0, this.innerWidth]);
        
        const maxCount = d3.max(this.data, d => d.count) || 1;
        this.yScale = d3.scaleLinear()
            .domain([0, maxCount])
            .range([this.innerHeight, 0]);
        
        // Draw histogram
        this._drawHistogram(g);
        
        // Draw paywall boundary if free tier
        if (this.archive && this.archive.tier === 'free') {
            this._drawPaywallBoundary(g);
        }
        
        // Draw brush
        this._drawBrush(g);
        
        // Draw axes
        this._drawAxes(g);
        
        // Add title
        this.svg.append('text')
            .attr('x', this.margin.left)
            .attr('y', 16)
            .attr('fill', 'var(--text-secondary, #8892b0)')
            .attr('font-size', '12px')
            .attr('font-weight', '500')
            .text('Event Timeline');
    }

    /**
     * Draw histogram bars
     */
    _drawHistogram(g) {
        if (this.data.length === 0) return;
        
        // Bin data by month for cleaner visualization
        const binnedData = this._binByMonth(this.data);
        
        const barWidth = this.innerWidth / binnedData.length;
        
        g.selectAll('.histogram-bar')
            .data(binnedData)
            .enter()
            .append('rect')
            .attr('class', 'histogram-bar')
            .attr('x', d => this.xScale(new Date(d.date)) - barWidth / 2)
            .attr('y', d => this.yScale(d.count))
            .attr('width', Math.max(barWidth - 1, 2))
            .attr('height', d => this.innerHeight - this.yScale(d.count))
            .attr('fill', 'var(--accent-primary, #64ffda)')
            .attr('opacity', 0.3);
    }

    /**
     * Draw paywall boundary indicator
     */
    _drawPaywallBoundary(g) {
        const paywallDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const x = this.xScale(paywallDate);
        
        // Vertical line
        g.append('line')
            .attr('x1', x)
            .attr('x2', x)
            .attr('y1', 0)
            .attr('y2', this.innerHeight)
            .attr('stroke', 'var(--warning, #ff6b6b)')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '5,5');
        
        // Label
        g.append('text')
            .attr('x', x - 5)
            .attr('y', -5)
            .attr('text-anchor', 'end')
            .attr('fill', 'var(--warning, #ff6b6b)')
            .attr('font-size', '10px')
            .text('Free limit →');
        
        // Paywall overlay
        g.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', x)
            .attr('height', this.innerHeight)
            .attr('fill', 'var(--warning, #ff6b6b)')
            .attr('opacity', 0.05);
    }

    /**
     * Draw brush for selection
     */
    _drawBrush(g) {
        this.brush = d3.brushX()
            .extent([[0, 0], [this.innerWidth, this.innerHeight]])
            .on('end', (event) => this._onBrushEnd(event));
        
        this.brushGroup = g.append('g')
            .attr('class', 'brush')
            .call(this.brush);
        
        // Style brush selection
        this.brushGroup.selectAll('.selection')
            .attr('fill', 'var(--accent-primary, #64ffda)')
            .attr('fill-opacity', 0.2)
            .attr('stroke', 'var(--accent-primary, #64ffda)');
        
        // Set initial brush position
        const initialSelection = [
            this.xScale(this.selectedRange.start),
            this.xScale(this.selectedRange.end)
        ];
        this.brushGroup.call(this.brush.move, initialSelection);
    }

    /**
     * Draw axes
     */
    _drawAxes(g) {
        // X axis
        const xAxis = d3.axisBottom(this.xScale)
            .ticks(5)
            .tickFormat(d3.timeFormat('%b %Y'));
        
        g.append('g')
            .attr('transform', `translate(0,${this.innerHeight})`)
            .call(xAxis)
            .selectAll('text')
            .attr('fill', 'var(--text-muted, #8892b0)')
            .attr('font-size', '10px');
        
        g.select('.domain').attr('stroke', 'var(--border, #333)');
        g.selectAll('.tick line').attr('stroke', 'var(--border, #333)');
    }

    /**
     * Handle brush end event
     */
    _onBrushEnd(event) {
        if (!event.selection) return;
        
        const [x0, x1] = event.selection;
        const start = this.xScale.invert(x0);
        const end = this.xScale.invert(x1);
        
        // Check paywall for free tier
        if (this.archive && this.archive.tier === 'free') {
            const paywallDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            if (start < paywallDate) {
                // Reset to paywall boundary
                this.brushGroup.call(this.brush.move, [
                    this.xScale(paywallDate),
                    x1
                ]);
                this.onPaywall({ attempted: start, limit: paywallDate });
                return;
            }
        }
        
        this.selectedRange = { start, end };
        this.onChange({ start, end });
    }

    /**
     * Bin data by month
     */
    _binByMonth(data) {
        const bins = new Map();
        
        data.forEach(d => {
            const date = new Date(d.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
            bins.set(key, (bins.get(key) || 0) + d.count);
        });
        
        return Array.from(bins.entries())
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    /**
     * Generate demo data
     */
    _generateDemoData() {
        const data = [];
        const now = new Date();
        
        for (let i = 0; i < 365 * 2; i++) {
            const date = new Date(now - i * 24 * 60 * 60 * 1000);
            // Random event count with some clustering
            const baseCount = Math.random() > 0.7 ? Math.floor(Math.random() * 10) : 0;
            const clusterBonus = i < 30 ? Math.floor(Math.random() * 15) : 0; // More recent events
            
            if (baseCount + clusterBonus > 0) {
                data.push({
                    date: date.toISOString().split('T')[0],
                    count: baseCount + clusterBonus
                });
            }
        }
        
        return data.reverse();
    }

    /**
     * Load D3 from CDN
     */
    _loadD3() {
        return new Promise((resolve, reject) => {
            if (typeof d3 !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://d3js.org/d3.v7.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Update data and re-render
     */
    async update() {
        await this._loadData();
        this._render();
    }

    /**
     * Get current selection
     */
    getSelection() {
        return this.selectedRange;
    }

    /**
     * Set selection programmatically
     */
    setSelection(start, end) {
        this.selectedRange = { start, end };
        
        if (this.brushGroup && this.xScale) {
            this.brushGroup.call(this.brush.move, [
                this.xScale(start),
                this.xScale(end)
            ]);
        }
        
        this.onChange(this.selectedRange);
    }

    /**
     * Destroy the component
     */
    destroy() {
        if (this.svg) {
            this.svg.remove();
        }
        this.container.innerHTML = '';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineSlider;
} else {
    window.TimelineSlider = TimelineSlider;
}
