/**
 * Polycrisis Intelligence API Client
 * Live data connector for WSSI dashboard
 */

class PolycrisisAPI {
    constructor(baseURL = 'http://localhost:8000') {
        this.baseURL = baseURL;
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds
    }

    /**
     * Generic fetch with error handling and caching
     */
    async fetch(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const cacheKey = `${endpoint}:${JSON.stringify(options)}`;

        // Check cache
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Cache successful response
            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data
            });

            return data;
        } catch (error) {
            console.error(`API fetch failed for ${url}:`, error);

            // Return cached data if available, even if expired
            if (this.cache.has(cacheKey)) {
                console.warn('Using stale cache due to fetch error');
                return this.cache.get(cacheKey).data;
            }

            // Check for fallback data
            if (typeof FALLBACK_WSSI !== 'undefined') {
                console.warn('Using fallback data due to API error');
                return this._getFallback(endpoint);
            }

            throw error;
        }
    }

    /**
     * Get fallback data for offline/demo mode
     */
    _getFallback(endpoint) {
        if (endpoint.includes('/intelligence/wssi') && !endpoint.includes('/history')) {
            return FALLBACK_WSSI;
        }
        if (endpoint.includes('/intelligence/themes')) {
            return FALLBACK_THEMES;
        }
        if (endpoint.includes('/intelligence/alerts')) {
            return FALLBACK_ALERTS;
        }
        if (endpoint.includes('/intelligence/summary')) {
            return FALLBACK_SUMMARY;
        }
        if (endpoint.includes('/causal-loops') && !endpoint.includes('/')) {
            return { diagrams: FALLBACK_CLDS };
        }
        if (endpoint.includes('/causal-loops/themes')) {
            return { themes: ['economic-financial', 'environmental', 'governance'] };
        }
        return null;
    }

    /**
     * Get current WSSI score
     */
    async getWSSI() {
        const response = await this.fetch('/api/v1/intelligence/wssi');
        return response;
    }

    /**
     * Get WSSI history
     * @param {number} days - Number of days of history
     */
    async getWSSIHistory(days = 30) {
        const response = await this.fetch(`/api/v1/intelligence/wssi/history?days=${days}`);
        return response.history;
    }

    /**
     * Get theme breakdown
     */
    async getThemes() {
        const response = await this.fetch('/api/v1/intelligence/themes');
        return response;
    }

    /**
     * Get active alerts
     */
    async getAlerts() {
        const response = await this.fetch('/api/v1/intelligence/alerts');
        return response;
    }

    /**
     * Get executive summary
     */
    async getSummary() {
        const response = await this.fetch('/api/v1/intelligence/summary');
        return response;
    }

    /**
     * Get conflict events
     * @param {number} limit - Max number of events
     */
    async getConflictEvents(limit = 50) {
        const response = await this.fetch(`/api/v1/conflict?limit=${limit}`);
        return response.data;
    }

    /**
     * Get sanctions list
     * @param {number} limit - Max number of entities
     */
    async getSanctions(limit = 100) {
        const response = await this.fetch(`/api/v1/sanctions?limit=${limit}`);
        return response.data;
    }

    /**
     * Get governance indicators
     * @param {string} countryCode - Country code filter
     */
    async getGovernance(countryCode = null) {
        const endpoint = countryCode
            ? `/api/v1/governance?country_code=${countryCode}`
            : '/api/v1/governance?limit=50';
        const response = await this.fetch(endpoint);
        return response.data;
    }

    /**
     * Get SDG indicators
     * @param {number} goal - SDG goal number
     */
    async getSDGIndicators(goal = null) {
        const endpoint = goal
            ? `/api/v1/sdg?goal=${goal}`
            : '/api/v1/sdg?limit=100';
        const response = await this.fetch(endpoint);
        return response.data;
    }

    /**
     * List Causal Loop Diagrams
     * @param {string} theme - Filter by WSSI theme
     * @param {string} tag - Filter by tag
     * @param {number} limit - Max number of diagrams
     */
    async listCLDs(theme = null, tag = null, limit = 20) {
        let endpoint = `/api/v1/causal-loops?limit=${limit}`;
        if (theme) endpoint += `&theme=${encodeURIComponent(theme)}`;
        if (tag) endpoint += `&tag=${encodeURIComponent(tag)}`;

        const response = await this.fetch(endpoint);
        return response.diagrams;
    }

    /**
     * Get specific Causal Loop Diagram
     * @param {string} diagramId - CLD ID
     */
    async getCLD(diagramId) {
        return await this.fetch(`/api/v1/causal-loops/${diagramId}`);
    }

    /**
     * Get CLD feedback loops
     * @param {string} diagramId - CLD ID
     */
    async getCLDLoops(diagramId) {
        return await this.fetch(`/api/v1/causal-loops/${diagramId}/loops`);
    }

    /**
     * Get CLD nodes
     * @param {string} diagramId - CLD ID
     */
    async getCLDNodes(diagramId) {
        return await this.fetch(`/api/v1/causal-loops/${diagramId}/nodes`);
    }

    /**
     * Get CLD export info
     * @param {string} diagramId - CLD ID
     */
    async getCLDExport(diagramId) {
        return await this.fetch(`/api/v1/causal-loops/${diagramId}/export/svg`);
    }

    /**
     * Get available CLD themes
     */
    async getCLDThemes() {
        const response = await this.fetch('/api/v1/causal-loops/themes');
        return response.themes;
    }

    /**
     * Check API health
     */
    async health() {
        try {
            const response = await this.fetch('/health');
            return response.status === 'healthy';
        } catch {
            return false;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

// Create singleton instance
const api = new PolycrisisAPI();

// Export for both browser and Node.js (with conditional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    window.PolycrisisAPI = api;
}
