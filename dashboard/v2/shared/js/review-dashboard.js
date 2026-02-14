/**
 * ReviewDashboard - Collaborative paper review interface
 * 
 * Phase 1: Review UI with paper cards, scoring breakdown, PRISMA metadata
 * 
 * Features:
 * - Paper card display with full metadata
 * - Visual scoring breakdown
 * - PRISMA fields (search_string, search_date, search_engine)
 * - Filter and sort
 * - Batch selection
 * - Single-click approve/reject/skip
 * 
 * Usage:
 *   const dashboard = new ReviewDashboard('#app', {
 *     queuePath: './data/research/intake-queue.json'
 *   });
 *   await dashboard.init();
 */

class ReviewDashboard {
    constructor(containerSelector, options = {}) {
        this.container = document.querySelector(containerSelector);
        this.queuePath = options.queuePath || './data/research/intake-queue.json';
        this.onAction = options.onAction || (() => {});
        
        // State
        this.papers = [];
        this.filteredPapers = [];
        this.selectedIds = new Set();
        this.sortBy = 'score';
        this.sortAsc = false;
        this.filterDomain = 'all';
        this.filterMinScore = 0;
        
        // Stats
        this.stats = {
            pending: 0,
            approved: 0,
            rejected: 0,
            total: 0
        };
    }

    /**
     * Initialize dashboard
     */
    async init() {
        if (!this.container) {
            throw new Error(`Container not found: ${this.container}`);
        }
        
        await this.loadQueue();
        this.render();
        
        return this;
    }

    /**
     * Load intake queue
     */
    async loadQueue() {
        try {
            const response = await fetch(this.queuePath);
            const data = await response.json();
            this.papers = data.papers || [];
            this.filteredPapers = [...this.papers];
            this.updateStats();
        } catch (err) {
            console.error('Failed to load queue:', err);
            // Use demo data for development
            this.papers = this._generateDemoData();
            this.filteredPapers = [...this.papers];
            this.updateStats();
        }
    }

    /**
     * Update statistics
     */
    updateStats() {
        this.stats = {
            pending: this.papers.filter(p => p.status === 'pending_review').length,
            approved: this.papers.filter(p => p.status === 'approved').length,
            rejected: this.papers.filter(p => p.status === 'rejected').length,
            total: this.papers.length
        };
    }

    /**
     * Render full dashboard
     */
    render() {
        this.container.innerHTML = `
            <div class="review-dashboard">
                ${this._renderHeader()}
                ${this._renderFilters()}
                ${this._renderStats()}
                ${this._renderAddPapersGuide()}
                ${this._renderBatchActions()}
                <div class="papers-grid">
                    ${this.filteredPapers.map(paper => this._renderPaperCard(paper)).join('')}
                </div>
            </div>
        `;
        
        this._attachEventListeners();
    }

    /**
     * Render header
     */
    _renderHeader() {
        return `
            <header class="review-header">
                <h1>📚 Research Review Dashboard</h1>
                <p class="subtitle">Collaborative curation for polycrisis intelligence</p>
            </header>
        `;
    }

    /**
     * Render filter controls
     */
    _renderFilters() {
        const domains = [...new Set(this.papers.flatMap(p => p.domains || []))];
        
        return `
            <div class="review-filters">
                <div class="filter-group">
                    <label>Sort by</label>
                    <select id="sort-by" class="filter-select">
                        <option value="score" ${this.sortBy === 'score' ? 'selected' : ''}>Relevance Score</option>
                        <option value="citations" ${this.sortBy === 'citations' ? 'selected' : ''}>Citations</option>
                        <option value="date" ${this.sortBy === 'date' ? 'selected' : ''}>Date Added</option>
                        <option value="year" ${this.sortBy === 'year' ? 'selected' : ''}>Publication Year</option>
                    </select>
                    <button id="sort-direction" class="sort-btn" title="Toggle direction">
                        ${this.sortAsc ? '↑' : '↓'}
                    </button>
                </div>
                
                <div class="filter-group">
                    <label>Domain</label>
                    <select id="filter-domain" class="filter-select">
                        <option value="all">All Domains</option>
                        ${domains.map(d => `
                            <option value="${d}" ${this.filterDomain === d ? 'selected' : ''}>${d}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="filter-group">
                    <label>Min Score</label>
                    <input type="range" id="min-score" min="0" max="300" value="${this.filterMinScore}" class="filter-range">
                    <span class="range-value">${this.filterMinScore}</span>
                </div>
                
                <div class="filter-group">
                    <label>Status</label>
                    <div class="status-filters">
                        <button class="status-btn active" data-status="pending_review">
                            Pending (${this.stats.pending})
                        </button>
                        <button class="status-btn" data-status="approved">
                            Approved (${this.stats.approved})
                        </button>
                        <button class="status-btn" data-status="rejected">
                            Rejected (${this.stats.rejected})
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render "How to Add Papers" guide
     */
    _renderAddPapersGuide() {
        return `
            <div class="add-papers-guide">
                <h3>📥 How to Add Papers</h3>
                <div class="add-papers-methods">
                    <div class="add-method">
                        <h4>1. Google Scholar Alerts</h4>
                        <p>Export your Scholar alerts as CSV, then import:</p>
                        <code>node research_intake.js --add-google-scholar export.csv</code>
                        <span class="note">Best for: Regular automated feeds from saved searches</span>
                    </div>
                    
                    <div class="add-method">
                        <h4>2. Manual Entry</h4>
                        <p>Add a paper you found directly with full metadata:</p>
                        <code>node research_intake.js --add-manual @paper.json</code>
                        <span class="note">Include: search_string, search_date for PRISMA tracking</span>
                    </div>
                    
                    <div class="add-method">
                        <h4>3. Direct URL</h4>
                        <p>Quick add from communities, Twitter, or email:</p>
                        <code>node research_intake.js --add-manual '{"title":"...","link":"..."}'</code>
                        <span class="note">Use when you just have a DOI or link</span>
                    </div>
                    
                    <div class="add-method">
                        <h4>4. Auto-Fetch (SerpAPI)</h4>
                        <p>Run weekly automated Google Scholar search:</p>
                        <code>node research_intake.js --fetch-scholar</code>
                        <span class="note">8 targeted queries configured; 250 searches/mo free tier</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render statistics bar
     */
    _renderStats() {
        return `
            <div class="review-stats">
                <div class="stat-item">
                    <span class="stat-value">${this.filteredPapers.length}</span>
                    <span class="stat-label">Showing</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${this.stats.total}</span>
                    <span class="stat-label">Total Papers</span>
                </div>
                <div class="stat-item approved">
                    <span class="stat-value">${this.stats.approved}</span>
                    <span class="stat-label">Approved</span>
                </div>
                <div class="stat-item pending">
                    <span class="stat-value">${this.stats.pending}</span>
                    <span class="stat-label">Pending</span>
                </div>
                <div class="stat-item rejected">
                    <span class="stat-value">${this.stats.rejected}</span>
                    <span class="stat-label">Rejected</span>
                </div>
                <div class="stat-item avg-score">
                    <span class="stat-value">${Math.round(this._getAverageScore())}</span>
                    <span class="stat-label">Avg Score</span>
                </div>
            </div>
        `;
    }

    /**
     * Render batch action buttons
     */
    _renderBatchActions() {
        const selectedCount = this.selectedIds.size;
        
        return `
            <div class="batch-actions ${selectedCount > 0 ? 'active' : ''}">
                <span class="selection-count">${selectedCount} selected</span>
                <div class="batch-buttons">
                    <button class="batch-btn approve" data-action="approve-selected">
                        ✓ Approve Selected
                    </button>
                    <button class="batch-btn reject" data-action="reject-selected">
                        ✕ Reject Selected
                    </button>
                    <button class="batch-btn skip" data-action="skip-selected">
                        → Skip Selected
                    </button>
                    <button class="batch-btn clear" data-action="clear-selection">
                        Clear
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render single paper card
     */
    _renderPaperCard(paper) {
        const isSelected = this.selectedIds.has(paper.id);
        const scoreColor = this._getScoreColor(paper.score);
        
        return `
            <article class="paper-card ${paper.status} ${isSelected ? 'selected' : ''}" data-id="${paper.id}">
                <div class="paper-select">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${paper.id}">
                </div>
                
                <div class="paper-main">
                    <div class="paper-header">
                        <div class="paper-score ${scoreColor}" title="Relevance Score">
                            ${paper.score || 0}
                        </div>
                        <h3 class="paper-title">${paper.title}</h3>
                        <div class="paper-status-badge ${paper.status}">
                            ${paper.status.replace('_', ' ')}
                        </div>
                    </div>
                    
                    <div class="paper-meta">
                        <span class="paper-authors">${(paper.authors || []).slice(0, 3).join(', ')}${(paper.authors || []).length > 3 ? ' et al.' : ''}</span>
                        <span class="paper-journal">${paper.journal || 'Unknown Journal'}</span>
                        <span class="paper-year">${paper.year || 'N/A'}</span>
                        <span class="paper-citations">📚 ${paper.citations || 0} citations</span>
                    </div>
                    
                    <div class="paper-domains">
                        ${(paper.domains || []).map(d => `<span class="domain-tag">${d}</span>`).join('')}
                    </div>
                    
                    <p class="paper-abstract">${paper.abstract || 'No abstract available'}</p>
                    
                    <div class="paper-scoring">
                        <h4>Scoring Breakdown</h4>
                        ${this._renderScoringBreakdown(paper)}
                    </div>
                    
                    <div class="paper-prisma">
                        <h4>PRISMA Metadata</h4>
                        <div class="prisma-fields">
                            <div class="prisma-field">
                                <span class="prisma-label">Search Query:</span>
                                <code class="prisma-value">${paper.search_string || paper.query_name || 'N/A'}</code>
                            </div>
                            <div class="prisma-field">
                                <span class="prisma-label">Search Date:</span>
                                <span class="prisma-value">${paper.search_date || 'N/A'}</span>
                            </div>
                            <div class="prisma-field">
                                <span class="prisma-label">Engine:</span>
                                <span class="prisma-value">${paper.search_engine || paper.source || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="paper-link">
                        <a href="${paper.link || paper.pdf_link || '#' }" target="_blank" rel="noopener">
                            View Paper →
                        </a>
                    </div>
                </div>
                
                <div class="paper-actions">
                    ${paper.status === 'pending_review' ? `
                        <button class="action-btn approve" data-action="approve" data-id="${paper.id}">
                            ✓ Approve
                        </button>
                        <button class="action-btn reject" data-action="reject" data-id="${paper.id}">
                            ✕ Reject
                        </button>
                        <button class="action-btn skip" data-action="skip" data-id="${paper.id}">
                            → Skip
                        </button>
                    ` : `
                        <button class="action-btn reset" data-action="reset" data-id="${paper.id}">
                            ↺ Reset
                        </button>
                    `}
                    <button class="action-btn discuss" data-action="discuss" data-id="${paper.id}">
                        💬 Discuss
                    </button>
                </div>
            </article>
        `;
    }

    /**
     * Render scoring breakdown visualization
     */
    _renderScoringBreakdown(paper) {
        const reasons = paper.scoring_reasons || [];
        
        // Parse reasons to extract points
        const breakdown = reasons.map(reason => {
            const match = reason.match(/([+-]?\d+)pts?\s*\(([^)]+)\)/);
            if (match) {
                return {
                    points: parseInt(match[1]),
                    reason: match[2],
                    positive: parseInt(match[1]) > 0
                };
            }
            return { points: 0, reason, positive: false };
        }).filter(item => item.points !== 0);
        
        const maxPoints = Math.max(...breakdown.map(b => Math.abs(b.points)), 100);
        
        return `
            <div class="scoring-breakdown">
                ${breakdown.map(item => `
                    <div class="score-bar-row">
                        <span class="score-reason">${item.reason}</span>
                        <div class="score-bar-container">
                            <div class="score-bar ${item.positive ? 'positive' : 'negative'}" 
                                 style="width: ${(Math.abs(item.points) / maxPoints * 100)}%">
                            </div>
                        </div>
                        <span class="score-points ${item.positive ? 'positive' : 'negative'}">
                            ${item.points > 0 ? '+' : ''}${item.points}
                        </span>
                    </div>
                `).join('')}
                <div class="score-total">
                    <span>Total</span>
                    <span class="score-total-value">${paper.score || 0}</span>
                </div>
            </div>
        `;
    }

    /**
     * Attach event listeners
     */
    _attachEventListeners() {
        // Sort and filter changes
        const sortBy = this.container.querySelector('#sort-by');
        const sortDirection = this.container.querySelector('#sort-direction');
        const filterDomain = this.container.querySelector('#filter-domain');
        const minScore = this.container.querySelector('#min-score');
        const rangeValue = this.container.querySelector('.range-value');
        
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.applyFilters();
            });
        }
        
        if (sortDirection) {
            sortDirection.addEventListener('click', () => {
                this.sortAsc = !this.sortAsc;
                this.applyFilters();
            });
        }
        
        if (filterDomain) {
            filterDomain.addEventListener('change', (e) => {
                this.filterDomain = e.target.value;
                this.applyFilters();
            });
        }
        
        if (minScore) {
            minScore.addEventListener('input', (e) => {
                this.filterMinScore = parseInt(e.target.value);
                if (rangeValue) rangeValue.textContent = this.filterMinScore;
                this.applyFilters();
            });
        }
        
        // Paper actions
        this.container.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const id = e.target.dataset.id;
                this.handleAction(action, id);
            });
        });
        
        // Checkbox selection
        this.container.querySelectorAll('.paper-select input').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                if (e.target.checked) {
                    this.selectedIds.add(id);
                } else {
                    this.selectedIds.delete(id);
                }
                this.render();
            });
        });
        
        // Batch actions
        this.container.querySelectorAll('.batch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleBatchAction(action);
            });
        });
        
        // Status filters
        this.container.querySelectorAll('.status-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.container.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                // Apply status filter
                const status = e.target.dataset.status;
                this.filterStatus = status;
                this.applyFilters();
            });
        });
    }

    /**
     * Handle single paper action
     */
    handleAction(action, id) {
        const paper = this.papers.find(p => p.id === id);
        if (!paper) return;
        
        switch (action) {
            case 'approve':
                paper.status = 'approved';
                paper.approved_at = new Date().toISOString();
                break;
            case 'reject':
                paper.status = 'rejected';
                paper.rejected_at = new Date().toISOString();
                break;
            case 'skip':
                // Keep pending but mark as skipped for this session
                paper.skipped = true;
                break;
            case 'reset':
                paper.status = 'pending_review';
                delete paper.approved_at;
                delete paper.rejected_at;
                break;
            case 'discuss':
                this.onAction('discuss', paper);
                return;
        }
        
        this.onAction(action, paper);
        this.updateStats();
        this.applyFilters();
    }

    /**
     * Handle batch action
     */
    handleBatchAction(action) {
        const selectedPapers = this.papers.filter(p => this.selectedIds.has(p.id));
        
        switch (action) {
            case 'approve-selected':
                selectedPapers.forEach(p => {
                    p.status = 'approved';
                    p.approved_at = new Date().toISOString();
                });
                break;
            case 'reject-selected':
                selectedPapers.forEach(p => {
                    p.status = 'rejected';
                    p.rejected_at = new Date().toISOString();
                });
                break;
            case 'skip-selected':
                selectedPapers.forEach(p => {
                    p.skipped = true;
                });
                break;
            case 'clear-selection':
                this.selectedIds.clear();
                this.render();
                return;
        }
        
        this.selectedIds.clear();
        this.onAction(action, selectedPapers);
        this.updateStats();
        this.applyFilters();
    }

    /**
     * Apply filters and sort
     */
    applyFilters() {
        // Filter
        this.filteredPapers = this.papers.filter(paper => {
            // Status filter
            if (this.filterStatus && paper.status !== this.filterStatus) {
                return false;
            }
            
            // Domain filter
            if (this.filterDomain !== 'all' && !(paper.domains || []).includes(this.filterDomain)) {
                return false;
            }
            
            // Min score filter
            if ((paper.score || 0) < this.filterMinScore) {
                return false;
            }
            
            return true;
        });
        
        // Sort
        this.filteredPapers.sort((a, b) => {
            let comparison = 0;
            
            switch (this.sortBy) {
                case 'score':
                    comparison = (a.score || 0) - (b.score || 0);
                    break;
                case 'citations':
                    comparison = (a.citations || 0) - (b.citations || 0);
                    break;
                case 'date':
                    comparison = new Date(a.added || 0) - new Date(b.added || 0);
                    break;
                case 'year':
                    comparison = (a.year || 0) - (b.year || 0);
                    break;
            }
            
            return this.sortAsc ? comparison : -comparison;
        });
        
        this.render();
    }

    /**
     * Get score color class
     */
    _getScoreColor(score) {
        if (score >= 150) return 'excellent';
        if (score >= 100) return 'good';
        if (score >= 80) return 'acceptable';
        return 'low';
    }

    /**
     * Get average score
     */
    _getAverageScore() {
        const scores = this.papers.map(p => p.score || 0);
        return scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    }

    /**
     * Generate demo data
     */
    _generateDemoData() {
        return [
            {
                id: 'demo-1',
                title: 'Global Tipping Points in the Earth System',
                authors: ['Tim Lenton', 'Johan Rockström'],
                journal: 'Nature',
                year: 2023,
                citations: 2450,
                abstract: 'The Earth system may exhibit critical transitions or tipping points, where small changes in forcing can lead to abrupt and irreversible changes in the state of the system...',
                score: 245,
                domains: ['climate', 'tipping_points'],
                status: 'pending_review',
                added: new Date().toISOString(),
                scoring_reasons: ['+100pts (citations)', '+10pts (2 authors)', '+50pts (nature)', '+85pts ("tipping point")'],
                search_string: '"tipping point" AND climate',
                search_date: '2026-02-13',
                search_engine: 'Google Scholar via SerpAPI',
                query_name: 'tipping_points',
                link: 'https://doi.org/10.1038/example'
            },
            {
                id: 'demo-2',
                title: 'Global polycrisis: the causal mechanisms of crisis entanglement',
                authors: ['M Lawrence', 'T Homer-Dixon', 'S Janzwood'],
                journal: 'Global Sustainability',
                year: 2024,
                citations: 671,
                abstract: 'This paper examines how crises become causally entangled, creating polycrisis conditions that are more than the sum of individual crises...',
                score: 185,
                domains: ['polycrisis', 'systems'],
                status: 'pending_review',
                added: new Date().toISOString(),
                scoring_reasons: ['+60pts (citations)', '+15pts (3 authors)', '+10pts (recent)', '+100pts ("polycrisis")'],
                search_string: '"polycrisis" OR "multiple crisis"',
                search_date: '2026-02-13',
                search_engine: 'Google Scholar via SerpAPI',
                query_name: 'polycrisis',
                link: 'https://www.cambridge.org/core/journals/global-sustainability/article/example'
            }
        ];
    }

    /**
     * Export current queue state
     */
    exportQueue() {
        return {
            papers: this.papers,
            stats: this.stats,
            exported_at: new Date().toISOString()
        };
    }

    /**
     * Save queue to server
     */
    async saveQueue() {
        // This would be implemented to sync with server
        console.log('Saving queue...', this.exportQueue());
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReviewDashboard;
} else {
    window.ReviewDashboard = ReviewDashboard;
}
