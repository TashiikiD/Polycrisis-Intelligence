/**
 * Live Feed Fetcher - Real-time event updates
 * Designed for frequent, incremental fetches (hourly/daily)
 * 
 * Sources:
 * - EONET: NASA natural events (hourly) — wildfires, storms, floods, volcanoes
 * - CISA: Cyber advisories (daily) — ICS/OT security alerts
 * - USGS: Recent earthquakes (hourly) — significant events
 * - GDACS: Disaster alerts (daily) — humanitarian focus
 * 
 * Usage:
 *   node live-feed.js --source eonet --days-back 7
 *   node live-feed.js --source all --output-dir ./live-chunks/
 *   node live-feed.js --cron (run all sources with appropriate frequencies)
 */

const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { XMLParser } = require('fast-xml-parser');
const gzip = promisify(zlib.gzip);

const LIVE_SOURCES = {
    eonet: {
        name: 'NASA EONET',
        type: 'natural_events',
        frequency: 'hourly',
        retention_days: 30,
        rate_limit: { requests: 1, perSeconds: 5 },
        base_url: 'https://eonet.gsfc.nasa.gov/api/v3/events'
    },
    cisa: {
        name: 'CISA Cyber Advisories',
        type: 'cyber',
        frequency: 'daily',
        retention_days: 90,
        rate_limit: { requests: 1, perSeconds: 300 }, // 5 min between requests
        base_url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml'
    },
    usgs: {
        name: 'USGS Recent Earthquakes',
        type: 'seismic',
        frequency: 'hourly',
        retention_days: 7,
        rate_limit: { requests: 1, perSeconds: 1 },
        base_url: 'https://earthquake.usgs.gov/fdsnws/event/1/query'
    },
    gdacs: {
        name: 'GDACS Live Alerts',
        type: 'disaster',
        frequency: 'daily',
        retention_days: 30,
        rate_limit: { requests: 1, perSeconds: 30 },
        base_url: 'https://www.gdacs.org/xml/rss.xml'
    }
};

class LiveFeedFetcher {
    constructor(options = {}) {
        this.sources = options.sources || ['eonet', 'usgs'];
        this.daysBack = options.daysBack || 7;
        this.outputDir = options.outputDir || './live-chunks/';
        this.events = [];
        this.errors = [];
        this.lastRequestTime = {};
        this.stats = { fetched: 0, failed: 0, bySource: {} };
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async enforceRateLimit(sourceKey) {
        const source = LIVE_SOURCES[sourceKey];
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

    async fetchAll() {
        console.log(`\n[LiveFeed] Starting live feed fetch`);
        console.log(`[LiveFeed] Days back: ${this.daysBack}`);
        console.log(`[LiveFeed] Sources: ${this.sources.join(', ')}\n`);
        
        for (const sourceKey of this.sources) {
            const source = LIVE_SOURCES[sourceKey];
            if (!source) {
                console.warn(`[LiveFeed] Unknown source: ${sourceKey}`);
                continue;
            }

            console.log(`\n[${sourceKey}] Starting fetch from ${source.name}`);
            console.log(`[${sourceKey}] Frequency: ${source.frequency}`);
            
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

        console.log(`\n[LiveFeed] Total fetched: ${this.stats.fetched} events`);
        return this.events;
    }

    async fetchSource(sourceKey, source) {
        switch (sourceKey) {
            case 'eonet':
                return await this.fetchEONET(source);
            case 'cisa':
                return await this.fetchCISA(source);
            case 'usgs':
                return await this.fetchUSGS(source);
            case 'gdacs':
                return await this.fetchGDACS(source);
            default:
                throw new Error(`No fetcher for ${sourceKey}`);
        }
    }

    /**
     * NASA EONET: Natural events (wildfires, storms, floods, volcanoes, ice)
     * Returns GeoJSON-like structure with event categories
     */
    async fetchEONET(source) {
        const events = [];
        
        await this.enforceRateLimit('eonet');
        
        console.log(`[eonet] Fetching natural events...`);
        
        const url = new URL(source.base_url);
        url.searchParams.set('days', this.daysBack.toString());
        url.searchParams.set('status', 'all'); // Include both open and closed
        
        try {
            const response = await this.fetchWithRetry(url.toString());
            const data = await response.json();
            
            if (data.events && data.events.length > 0) {
                console.log(`[eonet] ${data.events.length} total events`);
                
                for (const event of data.events) {
                    try {
                        const parsed = this.parseEONETEvent(event);
                        if (parsed) events.push(parsed);
                    } catch (err) {
                        console.warn(`[eonet] Failed to parse event: ${err.message}`);
                    }
                }
            } else {
                console.log('[eonet] No events found');
            }
        } catch (err) {
            throw new Error(`EONET fetch failed: ${err.message}`);
        }
        
        return events;
    }

    parseEONETEvent(event) {
        // EONET events have geometry array with coordinates over time
        // Use the first (most recent) geometry entry
        const geometry = event.geometry && event.geometry[0];
        if (!geometry) return null;
        
        const coords = geometry.coordinates;
        const eventDate = new Date(geometry.date);
        
        // Skip if too old
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.daysBack);
        if (eventDate < cutoff) return null;
        
        // Extract categories (event types)
        const categories = event.categories || [];
        const primaryCategory = categories[0] || { id: 'unknown', title: 'Unknown' };
        
        // Map EONET category to our event types
        const eventType = this.mapEONETCategory(primaryCategory.id);
        
        // Determine severity based on category and magnitude if available
        const severity = this.determineEONETSeverity(event, primaryCategory.id);
        
        return {
            id: `eonet-${event.id}`,
            source: 'eonet',
            source_id: event.id,
            source_url: event.link || `https://eonet.gsfc.nasa.gov/api/v3/events/${event.id}`,
            fetched_at: new Date().toISOString(),
            
            event_type: eventType,
            title: event.title,
            description: this.buildEONETDescription(event),
            
            date: eventDate.toISOString().split('T')[0],
            timestamp: eventDate.getTime(),
            
            latitude: coords[1],
            longitude: coords[0],
            
            severity: severity,
            
            country_code: null, // Could extract from coordinates via reverse geocoding
            
            source_metadata: {
                categories: categories.map(c => c.id),
                closed: event.closed || null,
                magnitude: geometry.magnitudeValue || null,
                magnitude_unit: geometry.magnitudeUnit || null,
                geometry_count: event.geometry ? event.geometry.length : 0
            }
        };
    }

    mapEONETCategory(categoryId) {
        const mapping = {
            'wildfires': 'wildfire',
            'severeStorms': 'storm',
            'floods': 'flood',
            'earthquakes': 'earthquake',
            'volcanoes': 'volcanic',
            'drought': 'drought',
            'dustHaze': 'air_quality',
            'landslides': 'landslide',
            'manmade': 'industrial',
            'snow': 'weather',
            'tempExtremes': 'weather',
            'waterColor': 'environmental'
        };
        return mapping[categoryId] || 'natural_event';
    }

    determineEONETSeverity(event, categoryId) {
        const geometry = event.geometry && event.geometry[0];
        const magnitude = geometry ? geometry.magnitudeValue : null;
        
        // Use magnitude if available (e.g., wildfire acres, earthquake magnitude)
        if (magnitude) {
            switch (categoryId) {
                case 'wildfires':
                    if (magnitude > 100000) return 'critical'; // acres
                    if (magnitude > 10000) return 'high';
                    if (magnitude > 1000) return 'medium';
                    return 'low';
                case 'severeStorms':
                    if (magnitude > 100) return 'high'; // wind speed or similar
                    return 'medium';
                default:
                    if (magnitude > 1000) return 'high';
                    return 'medium';
            }
        }
        
        // Default severities by category
        const defaultSeverities = {
            'earthquakes': 'high',
            'volcanoes': 'high',
            'wildfires': 'medium',
            'severeStorms': 'medium',
            'floods': 'medium'
        };
        
        return defaultSeverities[categoryId] || 'low';
    }

    buildEONETDescription(event) {
        const categories = event.categories || [];
        const catNames = categories.map(c => c.title).join(', ');
        let desc = `Natural event: ${catNames}`;
        
        if (event.closed) {
            desc += ` (Closed: ${new Date(event.closed).toLocaleDateString()})`;
        }
        
        return desc;
    }

    /**
     * CISA: Cybersecurity advisories via RSS
     * Focus on ICS/OT security alerts
     */
    async fetchCISA(source) {
        const events = [];
        
        await this.enforceRateLimit('cisa');
        
        console.log(`[cisa] Fetching RSS feed...`);
        
        try {
            const response = await this.fetchWithRetry(source.base_url);
            const xmlText = await response.text();
            
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
                
                console.log(`[cisa] ${items.length} total advisories`);
                
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - this.daysBack);
                
                for (const item of items) {
                    try {
                        const event = this.parseCISAEvent(item);
                        if (event) {
                            const eventDate = new Date(event.timestamp);
                            if (eventDate >= cutoff) {
                                events.push(event);
                            }
                        }
                    } catch (err) {
                        console.warn(`[cisa] Failed to parse advisory: ${err.message}`);
                    }
                }
                
                console.log(`[cisa] ${events.length} advisories within ${this.daysBack} days`);
            } else {
                console.log('[cisa] No advisories found');
            }
        } catch (err) {
            throw new Error(`CISA fetch failed: ${err.message}`);
        }
        
        return events;
    }

    parseCISAEvent(item) {
        const title = item.title || 'Unknown Advisory';
        const link = item.link || '';
        const pubDate = item.pubDate;
        const description = item.description || '';
        
        if (!pubDate) return null;
        
        // Parse date
        const eventDate = new Date(pubDate);
        
        // Determine severity and type from title/content
        const severity = this.determineCISASeverity(title, description);
        const advisoryType = this.classifyCISAAdvisory(title);
        
        return {
            id: `cisa-${Buffer.from(link).toString('base64').substring(0, 16)}`,
            source: 'cisa',
            source_id: link.split('/').pop() || 'unknown',
            source_url: link,
            fetched_at: new Date().toISOString(),
            
            event_type: advisoryType,
            title: title,
            description: this.cleanCISADescription(description),
            
            date: eventDate.toISOString().split('T')[0],
            timestamp: eventDate.getTime(),
            
            latitude: null, // Cyber events have no location
            longitude: null,
            
            severity: severity,
            
            country_code: null,
            
            source_metadata: {
                advisory_type: advisoryType,
                ics: title.includes('ICS') || description.includes('industrial control'),
                kev: title.includes('Known Exploited') || title.includes('KEV')
            }
        };
    }

    determineCISASeverity(title, description) {
        const text = (title + ' ' + description).toLowerCase();
        
        // Known Exploited Vulnerabilities are critical
        if (text.includes('known exploited')) return 'critical';
        if (text.includes('active exploitation')) return 'critical';
        if (text.includes('critical')) return 'critical';
        if (text.includes('remote code execution')) return 'high';
        if (text.includes('arbitrary code')) return 'high';
        if (text.includes('high')) return 'high';
        if (text.includes('medium')) return 'medium';
        
        return 'medium'; // Default for security advisories
    }

    classifyCISAAdvisory(title) {
        const t = title.toLowerCase();
        
        if (t.includes('ics-advisory') || t.includes('icsa-')) return 'ics_advisory';
        if (t.includes('ics-medical')) return 'medical_advisory';
        if (t.includes('known exploited')) return 'kev_catalog_update';
        if (t.includes('alert')) return 'alert';
        if (t.includes('bulletin')) return 'bulletin';
        
        return 'advisory';
    }

    cleanCISADescription(description) {
        if (!description) return '';
        
        // Strip HTML tags
        const text = description.replace(/<[^>]*>/g, ' ');
        
        // Truncate and clean
        const cleaned = text.replace(/\s+/g, ' ').trim();
        return cleaned.length > 300 ? cleaned.substring(0, 300) + '...' : cleaned;
    }

    /**
     * USGS: Recent earthquakes (last 7 days, mag 2.5+)
     * Lightweight version for live feeds
     */
    async fetchUSGS(source) {
        const events = [];
        
        await this.enforceRateLimit('usgs');
        
        console.log(`[usgs] Fetching recent earthquakes...`);
        
        const url = new URL(source.base_url);
        url.searchParams.set('format', 'geojson');
        url.searchParams.set('starttime', new Date(Date.now() - this.daysBack * 24 * 60 * 60 * 1000).toISOString());
        url.searchParams.set('endtime', new Date().toISOString());
        url.searchParams.set('minmagnitude', '2.5'); // Lower threshold for live feed
        url.searchParams.set('orderby', 'time');
        
        try {
            const response = await this.fetchWithRetry(url.toString());
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                console.log(`[usgs] ${data.features.length} earthquakes`);
                
                for (const feature of data.features) {
                    try {
                        const parsed = this.parseUSGSEvent(feature);
                        if (parsed) events.push(parsed);
                    } catch (err) {
                        console.warn(`[usgs] Failed to parse event: ${err.message}`);
                    }
                }
            } else {
                console.log('[usgs] No earthquakes found');
            }
        } catch (err) {
            throw new Error(`USGS fetch failed: ${err.message}`);
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
            
            severity: this.magnitudeToSeverity(props.mag),
            magnitude: props.mag,
            
            country_code: null,
            
            source_metadata: {
                magType: props.magType,
                sig: props.sig,
                tsunami: props.tsunami,
                alert: props.alert
            }
        };
    }

    magnitudeToSeverity(mag) {
        if (mag >= 7) return 'critical';
        if (mag >= 6) return 'high';
        if (mag >= 4) return 'medium';
        return 'low';
    }

    /**
     * GDACS: Disaster alerts (RSS format)
     * Similar to historical fetcher but for live feed
     */
    async fetchGDACS(source) {
        const events = [];
        
        await this.enforceRateLimit('gdacs');
        
        console.log(`[gdacs] Fetching RSS feed...`);
        
        try {
            const response = await this.fetchWithRetry(source.base_url);
            const xmlText = await response.text();
            
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
                
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - this.daysBack);
                
                for (const item of items) {
                    try {
                        const event = this.parseGDACSEvent(item);
                        if (event) {
                            const eventDate = new Date(event.timestamp);
                            if (eventDate >= cutoff) {
                                events.push(event);
                            }
                        }
                    } catch (err) {
                        console.warn(`[gdacs] Failed to parse event: ${err.message}`);
                    }
                }
                
                console.log(`[gdacs] ${events.length} events within ${this.daysBack} days`);
            }
        } catch (err) {
            throw new Error(`GDACS fetch failed: ${err.message}`);
        }
        
        return events;
    }

    parseGDACSEvent(item) {
        const lat = parseFloat(item['geo:lat'] || item.lat);
        const lon = parseFloat(item['geo:long'] || item.long || item.lon);
        
        return {
            id: `gdacs-${item.guid || item.link}`,
            source: 'gdacs',
            source_id: item.guid || item.link,
            source_url: item.link,
            fetched_at: new Date().toISOString(),
            
            event_type: this.classifyGDACSEvent(item.title, item.category),
            title: item.title,
            description: item.description,
            
            date: new Date(item.pubDate).toISOString().split('T')[0],
            timestamp: new Date(item.pubDate).getTime(),
            
            latitude: isNaN(lat) ? null : lat,
            longitude: isNaN(lon) ? null : lon,
            
            severity: this.parseGDACSSeverity(item.title, item.description),
            
            country_code: null,
            
            source_metadata: {
                category: item.category,
                pubDate: item.pubDate
            }
        };
    }

    classifyGDACSEvent(title, category) {
        const t = (title || '').toLowerCase();
        const c = (category || '').toLowerCase();
        
        if (t.includes('earthquake') || c.includes('earthquake')) return 'earthquake';
        if (t.includes('flood') || c.includes('flood')) return 'flood';
        if (t.includes('storm') || t.includes('cyclone') || t.includes('hurricane')) return 'storm';
        if (t.includes('wildfire') || t.includes('fire')) return 'wildfire';
        if (t.includes('drought')) return 'drought';
        if (t.includes('tsunami')) return 'tsunami';
        
        return 'disaster';
    }

    parseGDACSSeverity(title, description) {
        const t = ((title || '') + ' ' + (description || '')).toLowerCase();
        
        if (t.includes('red')) return 'critical';
        if (t.includes('orange')) return 'high';
        if (t.includes('yellow')) return 'medium';
        if (t.includes('green')) return 'low';
        
        return 'medium';
    }

    /**
     * Export to daily chunks (smaller than historical monthly)
     */
    async exportChunks() {
        console.log(`\n[Exporter] Processing ${this.events.length} events...`);
        
        if (this.events.length === 0) {
            console.log('[Exporter] No events to export');
            return;
        }

        // Group by day for live feeds
        const byDay = {};
        for (const event of this.events) {
            const day = event.date; // YYYY-MM-DD
            if (!byDay[day]) byDay[day] = [];
            byDay[day].push(event);
        }

        await fs.mkdir(this.outputDir, { recursive: true });

        for (const [day, events] of Object.entries(byDay)) {
            await this.exportDayChunk(day, events);
            await this.sleep(50);
        }

        console.log(`\n[Exporter] Complete: ${Object.keys(byDay).length} day chunks`);
    }

    async exportDayChunk(day, events) {
        const chunk = {
            chunk_id: `live-${day}`,
            date: day,
            generated_at: new Date().toISOString(),
            event_count: events.length,
            source_breakdown: this.getSourceBreakdown(events),
            events: events
        };

        const filename = path.join(this.outputDir, `live-${day}.json.gz`);
        const json = JSON.stringify(chunk, null, 2);
        const compressed = await gzip(json);
        await fs.writeFile(filename, compressed);
        
        const ratio = ((1 - compressed.length / json.length) * 100).toFixed(1);
        console.log(`  ${day}: ${events.length.toString().padStart(3)} events, ${compressed.length.toString().padStart(6)} bytes (saved ${ratio}%)`);
    }

    getSourceBreakdown(events) {
        const counts = {};
        for (const e of events) {
            counts[e.source] = (counts[e.source] || 0) + 1;
        }
        return counts;
    }

    getSummary() {
        return {
            total_events: this.stats.fetched,
            sources_succeeded: this.sources.length - this.errors.length,
            sources_failed: this.errors.length,
            by_source: this.stats.bySource,
            errors: this.errors,
            date_range: { days_back: this.daysBack }
        };
    }
}

// CLI usage
async function main() {
    const args = process.argv.slice(2);
    
    // Parse arguments
    let sources = ['eonet', 'usgs'];
    let daysBack = 7;
    let outputDir = './live-chunks/';
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source') {
            const val = args[++i];
            sources = val === 'all' ? Object.keys(LIVE_SOURCES) : val.split(',');
        } else if (args[i] === '--days-back') {
            daysBack = parseInt(args[++i]);
        } else if (args[i] === '--output-dir') {
            outputDir = args[++i];
        } else if (args[i] === '--help') {
            console.log(`
Live Feed Fetcher

Usage:
  node live-feed.js [options]

Options:
  --source <name>     Source to fetch (eonet|cisa|usgs|gdacs|all)
  --days-back <n>     Days of history to fetch (default: 7)
  --output-dir <dir>  Output directory (default: ./live-chunks/)
  --help              Show this help

Examples:
  node live-feed.js --source eonet --days-back 7
  node live-feed.js --source all --output-dir ./data/live/
            `);
            process.exit(0);
        }
    }

    const fetcher = new LiveFeedFetcher({ sources, daysBack, outputDir });

    try {
        await fetcher.fetchAll();
        await fetcher.exportChunks();
        
        console.log('\n' + '='.repeat(50));
        console.log('LIVE FEED SUMMARY');
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

module.exports = { LiveFeedFetcher, LIVE_SOURCES };
