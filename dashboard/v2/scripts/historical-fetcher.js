/**
 * Historical Event Fetcher - REAL DATA ONLY
 * Slow, respectful fetching with rate limiting
 * 
 * Rate limits respected:
 * - USGS: ~10 req/sec (we use 1 req/sec to be polite)
 * - GDACS: No explicit limit (we use 1 req/2sec)
 * - OFAC: Download once per day
 * - All others: 1 req/sec minimum
 */

const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { XMLParser } = require('fast-xml-parser');
const gzip = promisify(zlib.gzip);

const HISTORICAL_SOURCES = {
    usgs: {
        name: 'USGS Earthquake Hazards Program',
        type: 'seismic',
        retention_years: 1,
        rate_limit: { requests: 1, perSeconds: 1 }, // 1 req/sec (very polite)
        base_url: 'https://earthquake.usgs.gov/fdsnws/event/1/query'
    },
    gdacs: {
        name: 'GDACS Disaster Alert System',
        type: 'disaster', 
        retention_years: 2,
        rate_limit: { requests: 1, perSeconds: 2 }, // 1 req/2sec
        base_url: 'https://www.gdacs.org/xml/rss.json'
    },
    ofac: {
        name: 'OFAC SDN List',
        type: 'sanctions',
        retention_years: 5,
        rate_limit: { requests: 1, perSeconds: 86400 }, // Once per day
        url: 'https://www.treasury.gov/ofac/downloads/sdn.csv'
    }
};

class HistoricalFetcher {
    constructor(options = {}) {
        this.sources = options.sources || ['usgs', 'gdacs'];
        this.startDate = options.startDate || this.getDefaultStartDate();
        this.endDate = options.endDate || new Date().toISOString().split('T')[0];
        this.outputDir = options.outputDir || './chunks/';
        this.events = [];
        this.errors = [];
        this.lastRequestTime = {};
        this.stats = { fetched: 0, failed: 0, bySource: {} };
    }

    getDefaultStartDate() {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1); // USGS: 1 year
        return d.toISOString().split('T')[0];
    }

    /**
     * Sleep helper for rate limiting
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Enforce rate limit for a source
     */
    async enforceRateLimit(sourceKey) {
        const source = HISTORICAL_SOURCES[sourceKey];
        const limit = source.rate_limit;
        const now = Date.now();
        const lastRequest = this.lastRequestTime[sourceKey] || 0;
        const minInterval = (limit.perSeconds * 1000) / limit.requests;
        const timeSinceLast = now - lastRequest;
        
        if (timeSinceLast < minInterval) {
            const waitMs = minInterval - timeSinceLast;
            console.log(`[${sourceKey}] Rate limit: waiting ${waitMs}ms...`);
            await this.sleep(waitMs);
        }
        
        this.lastRequestTime[sourceKey] = Date.now();
    }

    /**
     * Fetch with retry logic and exponential backoff
     */
    async fetchWithRetry(url, options = {}, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, options);
                
                if (response.status === 429) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`  Rate limited (429), backing off ${delay}ms...`);
                    await this.sleep(delay);
                    continue;
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return response;
            } catch (err) {
                if (attempt === retries) throw err;
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`  Error: ${err.message}, retry ${attempt}/${retries} in ${delay}ms...`);
                await this.sleep(delay);
            }
        }
    }

    /**
     * Main fetch loop
     */
    async fetchAll() {
        console.log(`\n[Fetcher] Starting historical fetch`);
        console.log(`[Fetcher] Date range: ${this.startDate} to ${this.endDate}`);
        console.log(`[Fetcher] Sources: ${this.sources.join(', ')}\n`);
        
        for (const sourceKey of this.sources) {
            const source = HISTORICAL_SOURCES[sourceKey];
            if (!source) {
                console.warn(`[Fetcher] Unknown source: ${sourceKey}`);
                continue;
            }

            console.log(`\n[${sourceKey}] Starting fetch from ${source.name}`);
            console.log(`[${sourceKey}] Rate limit: ${source.rate_limit.requests} req/${source.rate_limit.perSeconds}s`);
            
            try {
                const startTime = Date.now();
                const events = await this.fetchSource(sourceKey, source);
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                
                this.events.push(...events);
                this.stats.fetched += events.length;
                this.stats.bySource[sourceKey] = events.length;
                
                console.log(`[${sourceKey}] ✓ Complete: ${events.length} events in ${duration}s`);
            } catch (err) {
                console.error(`[${sourceKey}] ✗ Failed: ${err.message}`);
                this.errors.push({ source: sourceKey, error: err.message });
                this.stats.failed++;
            }
        }

        console.log(`\n[Fetcher] Total fetched: ${this.stats.fetched} events`);
        return this.events;
    }

    /**
     * Route to specific source fetcher
     */
    async fetchSource(sourceKey, source) {
        switch (sourceKey) {
            case 'usgs':
                return await this.fetchUSGS(source);
            case 'gdacs':
                return await this.fetchGDACS(source);
            case 'ofac':
                return await this.fetchOFAC(source);
            default:
                throw new Error(`No fetcher for ${sourceKey}`);
        }
    }

    /**
     * USGS: Earthquake events
     * Fetches in monthly chunks to avoid huge responses
     */
    async fetchUSGS(source) {
        const events = [];
        const minMagnitude = 4.5; // Only significant events
        
        // Split date range into months
        const months = this.getMonthRanges(this.startDate, this.endDate);
        console.log(`[usgs] Fetching ${months.length} months of data (mag >= ${minMagnitude})`);
        
        for (let i = 0; i < months.length; i++) {
            const { start, end } = months[i];
            
            await this.enforceRateLimit('usgs');
            
            const url = new URL(source.base_url);
            url.searchParams.set('format', 'geojson');
            url.searchParams.set('starttime', start);
            url.searchParams.set('endtime', end);
            url.searchParams.set('minmagnitude', minMagnitude.toString());
            url.searchParams.set('orderby', 'time');
            
            try {
                console.log(`[usgs] Fetching ${start} to ${end} (${i + 1}/${months.length})...`);
                const response = await this.fetchWithRetry(url.toString());
                const data = await response.json();
                
                if (data.features && data.features.length > 0) {
                    const parsed = data.features.map(f => this.parseUSGSEvent(f));
                    events.push(...parsed);
                    console.log(`  → ${parsed.length} events`);
                } else {
                    console.log(`  → No events`);
                }
            } catch (err) {
                console.error(`  → Error: ${err.message}`);
                // Continue with other months
            }
        }
        
        return events;
    }

    parseUSGSEvent(feature) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        
        return {
            id: `usgs-${feature.id}`,
            source: 'usgs',
            source_id: feature.id,
            source_url: props.url,
            fetched_at: new Date().toISOString(),
            
            event_type: 'earthquake',
            title: props.title,
            description: `Magnitude ${props.mag} earthquake at ${props.place}`,
            
            date: new Date(props.time).toISOString().split('T')[0],
            timestamp: props.time,
            
            latitude: coords[1],
            longitude: coords[0],
            depth_km: coords[2],
            
            severity: this.magnitudeToSeverity(props.mag),
            magnitude: props.mag,
            
            country_code: null, // USGS doesn't provide this directly
            
            source_metadata: {
                magType: props.magType,
                sig: props.sig,
                status: props.status,
                tsunami: props.tsunami,
                alert: props.alert,
                types: props.types,
                sources: props.sources
            }
        };
    }

    magnitudeToSeverity(mag) {
        if (mag >= 7) return 'critical';
        if (mag >= 6) return 'high';
        if (mag >= 5) return 'medium';
        return 'low';
    }

    /**
     * GDACS: Disasters (floods, storms, earthquakes, wildfires)
     * Returns XML RSS feed - parse with fast-xml-parser
     */
    async fetchGDACS(source) {
        const events = [];
        
        await this.enforceRateLimit('gdacs');
        
        console.log(`[gdacs] Fetching RSS feed...`);
        
        try {
            const response = await this.fetchWithRetry(source.base_url.replace('.json', '.xml'));
            const xmlText = await response.text();
            
            // Parse XML
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '@_',
                parseAttributeValue: true
            });
            const data = parser.parse(xmlText);
            
            if (data.rss?.channel?.item) {
                const items = Array.isArray(data.rss.channel.item) 
                    ? data.rss.channel.item 
                    : [data.rss.channel.item];
                
                console.log(`[gdacs] ${items.length} total events in feed`);
                
                // Filter by date range
                const filtered = items.filter(item => {
                    if (!item.pubDate) return false;
                    const itemDate = new Date(item.pubDate);
                    const start = new Date(this.startDate);
                    const end = new Date(this.endDate);
                    return itemDate >= start && itemDate <= end;
                });
                
                console.log(`[gdacs] ${filtered.length} events in date range (${this.startDate} to ${this.endDate})`);
                
                for (let i = 0; i < filtered.length; i++) {
                    const item = filtered[i];
                    try {
                        const event = this.parseGDACSEvent(item);
                        if (event) events.push(event);
                    } catch (err) {
                        console.warn(`[gdacs] Failed to parse event ${i}: ${err.message}`);
                    }
                    
                    // Progress indicator
                    if (i % 50 === 0 && i > 0) {
                        process.stdout.write('.');
                        await this.sleep(10);
                    }
                }
                console.log('');
            } else {
                console.log('[gdacs] No items found in feed');
            }
        } catch (err) {
            throw new Error(`GDACS fetch failed: ${err.message}`);
        }
        
        return events;
    }

    parseGDACSEvent(item) {
        // Parse geo:lat and geo:long from the item
        const lat = parseFloat(item['geo:lat'] || item.lat);
        const lon = parseFloat(item['geo:long'] || item.long || item.lon);
        
        // Extract event type from title or category
        const eventType = this.classifyGDACSEvent(item.title, item.category);
        
        // Parse GDACS severity (0-3 scale typically)
        const severity = this.parseGDACSSeverity(item.title, item.description);
        
        return {
            id: `gdacs-${item.guid || item.link}`,
            source: 'gdacs',
            source_id: item.guid || item.link,
            source_url: item.link,
            fetched_at: new Date().toISOString(),
            
            event_type: eventType,
            title: item.title,
            description: item.description,
            
            date: new Date(item.pubDate).toISOString().split('T')[0],
            timestamp: new Date(item.pubDate).getTime(),
            
            latitude: lat,
            longitude: lon,
            
            severity: severity,
            
            country_code: null, // Extract from description if possible
            
            source_metadata: {
                category: item.category,
                pubDate: item.pubDate,
                iso3: item.iso3 || null
            }
        };
    }

    classifyGDACSEvent(title, category) {
        const t = (title || '').toLowerCase();
        const c = (category || '').toLowerCase();
        
        if (t.includes('earthquake') || c.includes('earthquake')) return 'earthquake';
        if (t.includes('flood') || c.includes('flood')) return 'flood';
        if (t.includes('storm') || t.includes('cyclone') || t.includes('hurricane') || c.includes('storm')) return 'storm';
        if (t.includes('wildfire') || t.includes('fire') || c.includes('fire')) return 'wildfire';
        if (t.includes('drought') || c.includes('drought')) return 'drought';
        if (t.includes('tsunami') || c.includes('tsunami')) return 'tsunami';
        if (t.includes('volcano') || c.includes('volcano')) return 'volcanic';
        
        return 'disaster';
    }

    parseGDACSSeverity(title, description) {
        const t = (title + ' ' + description).toLowerCase();
        
        // GDACS uses color codes in titles typically
        if (t.includes('red')) return 'critical';
        if (t.includes('orange')) return 'high';
        if (t.includes('yellow')) return 'medium';
        if (t.includes('green')) return 'low';
        
        return 'medium';
    }

    /**
     * OFAC: Sanctions list
     * Single CSV download, not time-ranged
     */
    async fetchOFAC(source) {
        const events = [];
        
        await this.enforceRateLimit('ofac');
        
        console.log(`[ofac] Downloading SDN list...`);
        
        try {
            const response = await this.fetchWithRetry(source.url);
            const csvText = await response.text();
            
            // Parse CSV (simple parser)
            const lines = csvText.split('\n');
            console.log(`[ofac] ${lines.length} lines in CSV`);
            
            // OFAC CSV format: ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vessel_Type,Tonnage,Gross_Tonnage,Vessel_Flag,Vessel_Owner,Remarks
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                try {
                    const event = this.parseOFACEvent(line, i);
                    if (event) events.push(event);
                } catch (err) {
                    // Skip malformed lines
                    continue;
                }
                
                // Progress indicator
                if (i % 1000 === 0) {
                    console.log(`[ofac] Processed ${i}/${lines.length}...`);
                    await this.sleep(10); // Brief pause
                }
            }
        } catch (err) {
            throw new Error(`OFAC fetch failed: ${err.message}`);
        }
        
        return events;
    }

    parseOFACEvent(line, index) {
        // Simple CSV parsing (OFAC uses commas, fields may be quoted)
        const fields = this.parseCSVLine(line);
        if (fields.length < 4) return null;
        
        const entNum = fields[0];
        const name = fields[1];
        const type = fields[2]; // Individual, Entity, Vessel, Aircraft
        const program = fields[3];
        const remarks = fields[11] || '';
        
        // Try to extract date from remarks
        const dateMatch = remarks.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        let eventDate = this.endDate; // Default to now if no date found
        
        if (dateMatch) {
            const [_, month, day, year] = dateMatch;
            const fullYear = year.length === 2 ? (parseInt(year) > 50 ? '19' : '20') + year : year;
            eventDate = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        // Skip if outside our date range
        if (eventDate < this.startDate || eventDate > this.endDate) {
            return null;
        }
        
        return {
            id: `ofac-${entNum}`,
            source: 'ofac',
            source_id: entNum,
            source_url: 'https://sanctionssearch.ofac.treas.gov/',
            fetched_at: new Date().toISOString(),
            
            event_type: 'sanction',
            title: `OFAC Sanction: ${name}`,
            description: `${type} sanctioned under ${program}. ${remarks.substring(0, 200)}`,
            
            date: eventDate,
            timestamp: new Date(eventDate).getTime(),
            
            latitude: null, // OFAC doesn't have geo
            longitude: null,
            
            severity: 'high', // All sanctions are high severity
            
            country_code: null, // Could extract from remarks in future
            
            source_metadata: {
                entity_type: type,
                program: program,
                remarks: remarks.substring(0, 500)
            }
        };
    }

    parseCSVLine(line) {
        const fields = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++; // Skip next quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        fields.push(current.trim());
        return fields;
    }

    /**
     * Export events to compressed monthly chunks
     */
    async exportChunks() {
        console.log(`\n[Exporter] Processing ${this.events.length} events...`);
        
        if (this.events.length === 0) {
            console.log('[Exporter] No events to export');
            return;
        }

        // Group by month
        const byMonth = {};
        for (const event of this.events) {
            const month = event.date.substring(0, 7); // YYYY-MM
            if (!byMonth[month]) byMonth[month] = [];
            byMonth[month].push(event);
        }

        await fs.mkdir(this.outputDir, { recursive: true });

        for (const [month, events] of Object.entries(byMonth)) {
            await this.exportChunk(month, events);
            await this.sleep(100); // Brief pause between writes
        }

        console.log(`\n[Exporter] Complete: ${Object.keys(byMonth).length} chunks`);
    }

    async exportChunk(month, events) {
        const [year, mon] = month.split('-');
        
        const chunk = {
            chunk_id: month,
            year: parseInt(year),
            month: parseInt(mon),
            generated_at: new Date().toISOString(),
            start_date: `${month}-01`,
            end_date: this.getMonthEnd(year, mon),
            event_count: events.length,
            source_breakdown: this.getSourceBreakdown(events),
            events: events
        };

        const filename = path.join(this.outputDir, `events-${month}.json.gz`);
        const json = JSON.stringify(chunk, null, 2);
        const compressed = await gzip(json);
        await fs.writeFile(filename, compressed);
        
        const ratio = ((1 - compressed.length / json.length) * 100).toFixed(1);
        console.log(`  ${month}: ${events.length.toString().padStart(4)} events, ${compressed.length.toString().padStart(7)} bytes (saved ${ratio}%)`);
    }

    getMonthEnd(year, month) {
        const d = new Date(year, month, 0);
        return d.toISOString().split('T')[0];
    }

    getSourceBreakdown(events) {
        const counts = {};
        for (const e of events) {
            counts[e.source] = (counts[e.source] || 0) + 1;
        }
        return counts;
    }

    getMonthRanges(startDate, endDate) {
        const ranges = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        let current = new Date(start);
        while (current <= end) {
            const year = current.getFullYear();
            const month = current.getMonth();
            
            const monthStart = new Date(year, month, 1);
            const monthEnd = new Date(year, month + 1, 0);
            
            ranges.push({
                start: monthStart.toISOString().split('T')[0],
                end: monthEnd.toISOString().split('T')[0]
            });
            
            current.setMonth(current.getMonth() + 1);
        }
        
        return ranges;
    }

    getSummary() {
        return {
            total_events: this.stats.fetched,
            sources_succeeded: this.sources.length - this.errors.length,
            sources_failed: this.errors.length,
            by_source: this.stats.bySource,
            errors: this.errors,
            date_range: { start: this.startDate, end: this.endDate }
        };
    }
}

// CLI usage
async function main() {
    const fetcher = new HistoricalFetcher({
        sources: ['usgs', 'gdacs'], // Start with these (no API keys needed)
        startDate: '2025-01-01',   // Recent data for testing
        outputDir: './chunks/'
    });

    try {
        await fetcher.fetchAll();
        await fetcher.exportChunks();
        
        console.log('\n' + '='.repeat(50));
        console.log('FETCH SUMMARY');
        console.log('='.repeat(50));
        console.log(JSON.stringify(fetcher.getSummary(), null, 2));
    } catch (err) {
        console.error('\n[FATAL]', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { HistoricalFetcher, HISTORICAL_SOURCES };
