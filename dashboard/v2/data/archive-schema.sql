-- 5-Year Event Archive Database Schema
-- Designed for timeline slider and tiered access (free: 30d, paid: 5yr)

-- Events table: Core event data from all sources
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,           -- Source-specific ID
    source TEXT NOT NULL,                     -- ucdp, ofac, gdacs, usgs, cisa
    source_type TEXT NOT NULL,                -- conflict, sanction, disaster, seismic, advisory
    title TEXT NOT NULL,
    description TEXT,
    
    -- Temporal data (for timeline queries)
    event_date DATE NOT NULL,                 -- When event occurred
    event_timestamp INTEGER,                  -- Unix timestamp for fast range queries
    
    -- Geospatial (for map display)
    latitude REAL,
    longitude REAL,
    country_code TEXT,                        -- ISO 3166-1 alpha-3
    region TEXT,                              -- Continent/region name
    
    -- Severity/classification
    severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT,                              -- active, resolved, ongoing
    
    -- WSSI correlation
    wssi_theme_id TEXT,                       -- Link to WSSI theme (e.g., "3.1" for conflict)
    wssi_contribution REAL,                   -- How much this event contributes to theme
    
    -- Source-specific metadata (JSON)
    source_metadata TEXT,                     -- JSON: fatalities, magnitude, affected_pop, etc.
    
    -- Archive management
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    
    -- Indexes
    INDEX idx_events_date ON events(event_date),
    INDEX idx_events_timestamp ON events(event_timestamp),
    INDEX idx_events_source ON events(source),
    INDEX idx_events_theme ON events(wssi_theme_id),
    INDEX idx_events_location ON events(country_code, region),
    INDEX idx_events_severity ON events(severity)
);

-- Daily aggregations: Pre-computed counts for fast timeline rendering
CREATE TABLE daily_stats (
    date DATE PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    
    -- Event counts by source
    ucdp_count INTEGER DEFAULT 0,
    ofac_count INTEGER DEFAULT 0,
    gdacs_count INTEGER DEFAULT 0,
    usgs_count INTEGER DEFAULT 0,
    cisa_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    
    -- Severity breakdown
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    
    -- WSSI correlation
    conflict_intensity REAL,                  -- Normalized 0-100
    environmental_stress REAL,
    economic_fragility REAL,
    governance_decay REAL,
    
    INDEX idx_stats_timestamp ON daily_stats(timestamp)
);

-- Monthly partitions metadata (for lazy loading)
CREATE TABLE archive_chunks (
    chunk_id TEXT PRIMARY KEY,                -- YYYY-MM format
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    event_count INTEGER DEFAULT 0,
    file_size INTEGER,                        -- Compressed size in bytes
    
    -- Status
    is_loaded BOOLEAN DEFAULT FALSE,          -- Whether loaded into client DB
    loaded_at INTEGER,                        -- When loaded
    
    -- Compression
    compression TEXT DEFAULT 'gzip',          -- gzip, brotli
    checksum TEXT,                            -- SHA-256 for integrity
    
    INDEX idx_chunks_date ON archive_chunks(year, month),
    INDEX idx_chunks_loaded ON archive_chunks(is_loaded)
);

-- User access control (client-side tier enforcement)
CREATE TABLE access_tiers (
    tier_id TEXT PRIMARY KEY,                 -- free, premium, enterprise
    tier_name TEXT NOT NULL,
    
    -- Date range limits
    max_days_history INTEGER,                 -- 30 for free, 1825 for paid (5 years)
    max_date DATE,                            -- NULL = unlimited
    
    -- Feature flags
    can_export BOOLEAN DEFAULT FALSE,
    can_api_access BOOLEAN DEFAULT FALSE,
    max_concurrent_queries INTEGER DEFAULT 5
);

-- Insert default tiers
INSERT INTO access_tiers (tier_id, tier_name, max_days_history, can_export, can_api_access) VALUES
('free', 'Free Tier', 30, FALSE, FALSE),
('premium', 'Premium', 1825, TRUE, TRUE),     -- 5 years
('enterprise', 'Enterprise', NULL, TRUE, TRUE);

-- Access log (for rate limiting and analytics)
CREATE TABLE access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER DEFAULT (strftime('%s', 'now')),
    tier_id TEXT,
    query_type TEXT,                          -- range, search, export
    date_from DATE,
    date_to DATE,
    result_count INTEGER,
    execution_ms INTEGER
);

-- Views for common queries

-- Recent events view (30 days) - Free tier
CREATE VIEW v_recent_events AS
SELECT * FROM events
WHERE event_date >= date('now', '-30 days')
ORDER BY event_date DESC;

-- High severity events - All tiers
CREATE VIEW v_critical_events AS
SELECT * FROM events
WHERE severity IN ('high', 'critical')
AND event_date >= date('now', '-30 days')
ORDER BY event_date DESC;

-- WSSI-correlated events only
CREATE VIEW v_wssi_events AS
SELECT e.*, t.theme_name, t.category
FROM events e
LEFT JOIN wssi_themes t ON e.wssi_theme_id = t.theme_id
WHERE e.wssi_theme_id IS NOT NULL
ORDER BY e.event_date DESC;

-- Helper table for WSSI theme lookup
CREATE TABLE wssi_themes (
    theme_id TEXT PRIMARY KEY,
    theme_name TEXT NOT NULL,
    category TEXT NOT NULL,                   -- Economic-Financial, Climate-Environmental, etc.
    description TEXT
);

INSERT INTO wssi_themes (theme_id, theme_name, category, description) VALUES
('1.1', 'Sovereign Debt Stress', 'Economic-Financial', 'National debt sustainability concerns'),
('1.2', 'Corporate Debt Distress', 'Economic-Financial', 'Corporate sector debt vulnerabilities'),
('1.3', 'Banking System Stress', 'Economic-Financial', 'Financial institution stability risks'),
('1.4', 'Real Asset Bubbles/Busts', 'Economic-Financial', 'Property and asset price volatility'),
('2.1', 'Tipping Point Proximity', 'Climate-Environmental', 'Climate tipping point thresholds'),
('2.2', 'Extreme Weather Events', 'Climate-Environmental', 'Severe weather and climate disasters'),
('2.4', 'Ecosystem Collapse', 'Climate-Environmental', 'Biodiversity and ecosystem risks'),
('3.1', 'Interstate Conflict', 'Geopolitical-Conflict', 'Wars and international conflicts'),
('3.3', 'Resource Competition', 'Geopolitical-Conflict', 'Scarcity-driven resource disputes'),
('3.4', 'Governance Decay', 'Geopolitical-Conflict', 'Institutional breakdown indicators'),
('5.2', 'Food System Fragility', 'Biological-Health', 'Food security and supply risks');

-- Triggers for automatic aggregation updates
CREATE TRIGGER trg_events_insert AFTER INSERT ON events
BEGIN
    -- Update daily_stats (simplified - real implementation would use UPSERT)
    INSERT OR REPLACE INTO daily_stats (
        date, timestamp, total_count, 
        CASE NEW.source 
            WHEN 'ucdp' THEN 'ucdp_count'
            WHEN 'ofac' THEN 'ofac_count'
            WHEN 'gdacs' THEN 'gdacs_count'
            WHEN 'usgs' THEN 'usgs_count'
            WHEN 'cisa' THEN 'cisa_count'
        END
    )
    VALUES (
        NEW.event_date,
        strftime('%s', NEW.event_date),
        COALESCE((SELECT total_count FROM daily_stats WHERE date = NEW.event_date), 0) + 1,
        COALESCE((SELECT 
            CASE NEW.source 
                WHEN 'ucdp' THEN ucdp_count
                WHEN 'ofac' THEN ofac_count
                WHEN 'gdacs' THEN gdacs_count
                WHEN 'usgs' THEN usgs_count
                WHEN 'cisa' THEN cisa_count
            END 
            FROM daily_stats WHERE date = NEW.event_date), 0) + 1
    );
END;
