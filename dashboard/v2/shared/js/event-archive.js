/**
 * EventArchive - 5-Year Event Database Manager
 * 
 * Features:
 * - SQLite (sql.js) for structured queries
 * - IndexedDB for persistence
 * - Tiered access control (free: 30d, paid: 5yr)
 * - Compressed monthly chunks for efficient loading
 * - Timeline-optimized aggregations
 */

class EventArchive {
    constructor(options = {}) {
        this.db = null;
        this.SQL = null;
        this.idb = null;
        this.idbName = options.idbName || 'polycrisis-archive-v1';
        this.chunkBaseUrl = options.chunkBaseUrl || './chunks/';
        
        // Access tier (set by auth/paywall)
        this.tier = options.tier || 'free';
        this.maxDays = { free: 30, premium: 1825, enterprise: 3650 }[this.tier] || 30;
        
        // Cache loaded chunks
        this.loadedChunks = new Set();
        this.chunkCache = new Map();
        
        this.initialized = false;
    }

    /**
     * Initialize the archive database
     */
    async init() {
        if (this.initialized) return;

        // Load sql.js
        await this._loadSqlJs();
        
        // Initialize SQLite
        this.db = new this.SQL.Database();
        
        // Create schema
        await this._createSchema();
        
        // Initialize IndexedDB
        await this._initIndexedDB();
        
        // Restore persisted data
        await this._restoreFromIndexedDB();
        
        this.initialized = true;
        console.log(`[Archive] Initialized (${this.tier} tier, ${this.maxDays} days)`);
    }

    /**
     * Load sql.js from CDN or local
     */
    async _loadSqlJs() {
        if (typeof initSqlJs !== 'undefined') {
            this.SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
            });
        } else {
            // Fallback: load script dynamically
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js');
            this.SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
            });
        }
    }

    /**
     * Create database schema
     */
    async _createSchema() {
        const schema = await fetch('./archive-schema.sql').then(r => r.text());
        
        // Split and execute statements
        const statements = schema.split(';').filter(s => s.trim());
        for (const stmt of statements) {
            try {
                this.db.exec(stmt);
            } catch (e) {
                // Ignore errors for CREATE TABLE IF NOT EXISTS, etc.
                if (!e.message.includes('already exists')) {
                    console.warn('[Archive] Schema error:', e.message);
                }
            }
        }
    }

    /**
     * Initialize IndexedDB
     */
    async _initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.idbName, 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.idb = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Store for SQLite database file
                if (!db.objectStoreNames.contains('database')) {
                    db.createObjectStore('database');
                }
                
                // Store for chunk metadata
                if (!db.objectStoreNames.contains('chunks')) {
                    db.createObjectStore('chunks', { keyPath: 'chunk_id' });
                }
                
                // Store for settings
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
            };
        });
    }

    /**
     * Restore database from IndexedDB
     */
    async _restoreFromIndexedDB() {
        try {
            const transaction = this.idb.transaction(['database'], 'readonly');
            const store = transaction.objectStore('database');
            const request = store.get('main');
            
            const data = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            if (data) {
                // Restore SQLite database from Uint8Array
                this.db = new this.SQL.Database(data);
                console.log('[Archive] Restored from IndexedDB');
            }
        } catch (e) {
            console.warn('[Archive] Could not restore:', e);
        }
    }

    /**
     * Persist database to IndexedDB
     */
    async persist() {
        if (!this.idb || !this.db) return;
        
        const data = this.db.export();
        
        const transaction = this.idb.transaction(['database'], 'readwrite');
        const store = transaction.objectStore('database');
        await new Promise((resolve, reject) => {
            const request = store.put(data, 'main');
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
        });
        
        console.log('[Archive] Persisted to IndexedDB');
    }

    /**
     * Load a monthly chunk
     */
    async loadChunk(year, month) {
        const chunkId = `${year}-${String(month).padStart(2, '0')}`;
        
        if (this.loadedChunks.has(chunkId)) {
            return; // Already loaded
        }
        
        // Check tier access
        const chunkDate = new Date(year, month - 1, 1);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.maxDays);
        
        if (chunkDate < cutoffDate && this.tier === 'free') {
            throw new Error('PAYWALL_REQUIRED');
        }
        
        try {
            // Fetch compressed chunk
            const response = await fetch(`${this.chunkBaseUrl}${chunkId}.json.gz`);
            if (!response.ok) throw new Error(`Chunk not found: ${chunkId}`);
            
            // Decompress (using pako or native)
            const compressed = await response.arrayBuffer();
            const decompressed = await this._decompress(compressed);
            const chunk = JSON.parse(new TextDecoder().decode(decompressed));
            
            // Import events
            this._importChunk(chunk);
            
            this.loadedChunks.add(chunkId);
            
            // Update chunk metadata
            this.db.run(`
                INSERT OR REPLACE INTO archive_chunks 
                (chunk_id, year, month, start_date, end_date, event_count, is_loaded, loaded_at)
                VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)
            `, [chunkId, year, month, chunk.start_date, chunk.end_date, chunk.events.length, Date.now()]);
            
            console.log(`[Archive] Loaded chunk ${chunkId} (${chunk.events.length} events)`);
            
        } catch (e) {
            console.error(`[Archive] Failed to load chunk ${chunkId}:`, e);
            throw e;
        }
    }

    /**
     * Import chunk data into database
     */
    _importChunk(chunk) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO events 
            (event_id, source, source_type, title, description, event_date, event_timestamp,
             latitude, longitude, country_code, region, severity, status, wssi_theme_id, source_metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const event of chunk.events) {
            stmt.run([
                event.id,
                event.source,
                event.type,
                event.title,
                event.description || null,
                event.date,
                event.timestamp,
                event.lat || null,
                event.lon || null,
                event.country || null,
                event.region || null,
                event.severity || 'medium',
                event.status || 'active',
                event.theme_id || null,
                JSON.stringify(event.metadata || {})
            ]);
        }
        
        stmt.free();
    }

    /**
     * Query events by date range
     */
    queryEvents(options = {}) {
        const { 
            from, 
            to, 
            sources = [], 
            severity = [], 
            themes = [],
            limit = 1000,
            offset = 0
        } = options;
        
        // Enforce tier limits
        const requestedFrom = from ? new Date(from) : new Date();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.maxDays);
        
        const effectiveFrom = this.tier === 'free' 
            ? new Date(Math.max(requestedFrom.getTime(), cutoffDate.getTime()))
            : requestedFrom;
        
        let sql = `
            SELECT e.*, t.theme_name, t.category as theme_category
            FROM events e
            LEFT JOIN wssi_themes t ON e.wssi_theme_id = t.theme_id
            WHERE e.event_date BETWEEN ? AND ?
        `;
        const params = [effectiveFrom.toISOString().split('T')[0], to || '9999-12-31'];
        
        if (sources.length > 0) {
            sql += ` AND e.source IN (${sources.map(() => '?').join(',')})`;
            params.push(...sources);
        }
        
        if (severity.length > 0) {
            sql += ` AND e.severity IN (${severity.map(() => '?').join(',')})`;
            params.push(...severity);
        }
        
        if (themes.length > 0) {
            sql += ` AND e.wssi_theme_id IN (${themes.map(() => '?').join(',')})`;
            params.push(...themes);
        }
        
        sql += ` ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const result = this.db.exec(sql, params);
        
        if (!result.length) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    }

    /**
     * Get daily aggregation for timeline
     */
    getTimelineData(from, to) {
        // Enforce tier limits
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.maxDays);
        
        const effectiveFrom = this.tier === 'free'
            ? new Date(Math.max(new Date(from).getTime(), cutoffDate.getTime())).toISOString().split('T')[0]
            : from;
        
        const result = this.db.exec(`
            SELECT 
                date,
                total_count,
                ucdp_count,
                ofac_count,
                gdacs_count,
                usgs_count,
                cisa_count,
                critical_count,
                high_count,
                conflict_intensity,
                environmental_stress
            FROM daily_stats
            WHERE date BETWEEN ? AND ?
            ORDER BY date
        `, [effectiveFrom, to]);
        
        if (!result.length) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    }

    /**
     * Get available date range based on tier
     */
    getAvailableRange() {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - this.maxDays);
        
        return {
            from: from.toISOString().split('T')[0],
            to: to.toISOString().split('T')[0],
            days: this.maxDays,
            tier: this.tier
        };
    }

    /**
     * Upgrade tier (called by paywall)
     */
    upgradeTier(newTier) {
        this.tier = newTier;
        this.maxDays = { free: 30, premium: 1825, enterprise: 3650 }[newTier] || 30;
        console.log(`[Archive] Upgraded to ${newTier} tier`);
    }

    /**
     * Get database stats
     */
    getStats() {
        const result = this.db.exec(`
            SELECT 
                COUNT(*) as total_events,
                COUNT(DISTINCT source) as sources,
                MIN(event_date) as earliest,
                MAX(event_date) as latest
            FROM events
        `);
        
        if (!result.length) return null;
        
        const cols = result[0].columns;
        const vals = result[0].values[0];
        const stats = {};
        cols.forEach((col, i) => stats[col] = vals[i]);
        
        stats.loaded_chunks = this.loadedChunks.size;
        stats.tier = this.tier;
        stats.max_days = this.maxDays;
        
        return stats;
    }

    /**
     * Decompress data (placeholder - implement with pako)
     */
    async _decompress(data) {
        // If pako is available
        if (typeof pako !== 'undefined') {
            return pako.ungzip(new Uint8Array(data));
        }
        
        // If CompressionStream API is available
        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Response(data).body
                .pipeThrough(new DecompressionStream('gzip'));
            return new Response(stream).arrayBuffer();
        }
        
        // Fallback: return as-is (uncompressed)
        return data;
    }

    /**
     * Load script dynamically
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventArchive;
} else {
    window.EventArchive = EventArchive;
}
