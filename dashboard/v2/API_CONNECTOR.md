# WSSI Dashboard - Live API Data Connector

## Overview

The dashboard now supports live data connectivity to the Polycrisis Intelligence API (`E:/clawd/api/`). This enables real-time WSSI updates, causal loop diagrams, and all intelligence data without manual data file generation.

## Architecture

```
Dashboard → Shared JS API Client → FastAPI Backend → SQLite Database
    ↓           ↓                          ↓                 ↓
index.html  wssi-api.js              API Routers        polycrisis.db
   ↓          ↓                          ↓
fallback     Fetch + Cache           Endpoints
  mode       Error Fallback
```

## Components

### 1. API Client (`shared/js/wssi-api.js`)

**Features:**
- RESTful client for all API endpoints
- Built-in caching (30s TTL)
- Automatic error handling with fallback
- Methods for WSSI, Conflict, Sanctions, Governance, SDG, Causal Loops

**Usage:**
```javascript
// Get current WSSI
const wssi = await window.PolycrisisAPI.getWSSI();
console.log(wssi.data.overall_score);

// Get CLD list
const clds = await window.PolycrisisAPI.listCLDs();
console.log(clds.length, 'diagrams');

// Get specific CLD
const cld = await window.PolycrisisAPI.getCLD('CLD5-Economic-Stress-Feedback');
```

### 2. Fallback Data (`shared/js/fallback-data.js`)

**Purpose:** Offline/demo mode when API is unavailable

**Scenarios:**
- API server not running
- Network issues
- Development without backend

**Fallback Data:**
- WSSI scores and themes
- Causal Loop Diagrams (5 core diagrams)
- Alerts and summaries

### 3. Dashboard Integration (`index.html`)

**Changes:**
- Loads `fallback-data.js` then `wssi-api.js`
- 60s auto-refresh interval
- Graceful degradation on API errors

## API Endpoints

### WSSI / Intelligence
- `GET /api/v1/intelligence/wssi` - Current WSSI score
- `GET /api/v1/intelligence/wssi/history?days=N` - Historical data
- `GET /api/v1/intelligence/themes` - Theme breakdown
- `GET /api/v1/intelligence/alerts` - Active alerts
- `GET /api/v1/intelligence/summary` - Executive summary

### Causal Loop Diagrams
- `GET /api/v1/causal-loops` - List all CLDs (filter by theme/tag)
- `GET /api/v1/causal-loops/themes` - Available themes
- `GET /api/v1/causal-loops/{id}` - Get specific CLD
- `GET /api/v1/causal-loops/{id}/loops` - Feedback loops
- `GET /api/v1/causal-loops/{id}/nodes` - Variables/nodes
- `GET /api/v1/causal-loops/{id}/export/svg` - Export info

### Other Data
- `GET /api/v1/conflict?limit=N` - Conflict events
- `GET /api/v1/sanctions?limit=N` - Sanctions list
- `GET /api/v1/governance?country_code=XX` - Governance indicators
- `GET /api/v1/sdg?goal=N` - SDG indicators

## Running the API

### Start the FastAPI Backend
```bash
cd E:\clawd\api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Access Dashboard
```bash
# Serve dashboard files (simple HTTP server)
cd E:\clawd\polycrisis-intelligence\dashboard\v2
python -m http.server 3000

# Then open: http://localhost:3000
```

## Configuration

### API Base URL

Default: `http://localhost:8000`

To change, edit `shared/js/wssi-api.js`:
```javascript
const api = new PolycrisisAPI('http://your-api-server.com:8000');
```

### Cache Timeout

Default: `30 seconds`

To change:
```javascript
this.cacheTimeout = 60000; // 60 seconds
```

## Development Workflow

### With Live API
1. Start FastAPI backend (`uvicorn main:app --reload --port 8000`)
2. Start dashboard server (`python -m http.server 3000`)
3. Dashboard fetches live data with 60s refresh

### Without Backend (Fallback Mode)
1. Start dashboard server only
2. Dashboard uses `fallback-data.js` automatically
3. All features work with static sample data

### Testing API Connectivity

```javascript
// Check if API is available
const isHealthy = await window.PolycrisisAPI.health();
console.log('API Healthy:', isHealthy);
```

## File Structure

```
polycrisis-intelligence/dashboard/v2/
├── index.html                      # Main landing page (updated)
├── shared/
│   ├── js/
│   │   ├── wssi-api.js            # API client (NEW)
│   │   └── fallback-data.js      # Fallback data (NEW)
│   └── css/
│       └── variables.css           # Design tokens
└── modes/
    ├── brief/                      # Classic mode (can use API)
    └── pulse/                     # Experimental mode (can use API)
```

## Integration with Brief/Pulse Modes

Both dashboard modes can now use the API client:

```javascript
// In brief/index.html or pulse/index.html:
<script src="../shared/js/fallback-data.js"></script>
<script src="../shared/js/wssi-api.js"></script>

<script>
  // Load live data
  async function loadData() {
    const wssi = await window.PolycrisisAPI.getWSSI();
    const themes = await window.PolycrisisAPI.getThemes();
    const clds = await window.PolycrisisAPI.listCLDs();
    // Update UI...
  }
  loadData();
</script>
```

## Troubleshooting

### "API connection failed" error

**Check:**
1. Is FastAPI running? (`http://localhost:8000/docs`)
2. Is CORS enabled in API?
3. Is the base URL correct?

**Solution:** Dashboard falls back to offline mode automatically

### CORS errors

**Fix in `api/main.py`:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Data not updating

**Check:**
1. API server is running
2. Browser cache cleared
3. `cacheTimeout` in `wssi-api.js`

**Force refresh:**
```javascript
window.PolycrisisAPI.clearCache();
location.reload();
```

## Next Steps

1. **Integrate API into Brief mode** - Replace static JSON with live API calls
2. **Integrate API into Pulse mode** - Enable real-time orb updates
3. **Add authentication** - API key support for production
4. **Optimize caching** - Smarter cache invalidation strategies

---

**Status:** ✅ Live API connector implemented and integrated into main dashboard
**Files Created:** `shared/js/wssi-api.js`, `shared/js/fallback-data.js`
**Files Modified:** `index.html`
**Next:** Integrate into Brief/Pulse modes
