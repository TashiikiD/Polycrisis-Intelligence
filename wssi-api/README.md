# WSSI API

**The Fragility Brief — Weighted Synchronous Stress Index API**

Real-time polycrisis monitoring through quantitative stress synthesis across 20 themes and 50+ indicators.

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

The WSSI API provides programmatic access to the Weighted Synchronous Stress Index — a composite metric tracking systemic risk across economic, environmental, geopolitical, and governance domains.

**Key Features:**
- **Cross-domain synthesis**: 20 themes, 50+ indicators, unified scoring
- **Real-time data**: 19+ live data sources (FRED, HDX HAPI, USGS, ECDC, WHO, and more)
- **Cascade detection**: Theme connection pathways with weighted evidence
- **Export capabilities**: CSV, Excel, JSON for analysis
- **Python SDK**: Full-featured client library
- **Admin dashboard**: API key management and usage monitoring

---

## Quick Start

### 1. Get API Access

```bash
# Request a free API key
curl -X POST https://api.fragilitybrief.io/api/v1/keys/request \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "tier": "free"}'
```

### 2. Make Your First Request

```bash
# Get current WSSI score
curl https://api.fragilitybrief.io/api/v1/wssi \
  -H "X-API-Key: wssi-free-YOUR-KEY"
```

**Response:**
```json
{
  "wssi_value": 0.67,
  "risk_level": "elevated",
  "timestamp": "2026-02-14T17:30:00Z",
  "active_themes": 20,
  "contributing_indicators": 52
}
```

### 3. Install Python SDK

```bash
pip install wssi-client
```

```python
from wssi import WSSIClient

client = WSSIClient(api_key="wssi-free-YOUR-KEY")

# Get current WSSI
current = client.get_wssi()
print(f"Current stress level: {current.wssi_value}")

# Get theme breakdown
themes = client.get_themes()
for theme in themes:
    print(f"{theme.name}: {theme.stress_level}")
```

---

## API Reference

### Authentication

All requests require an API key in the `X-API-Key` header.

```
X-API-Key: wssi-free-YOUR-KEY
```

**Tiers:**

| Tier | Daily Limit | Rate Limit | Export | Price |
|------|-------------|------------|--------|-------|
| Free | 1,000 | 100/min | ❌ | Free |
| Pro | 10,000 | 500/min | ✅ | $49/mo |
| Enterprise | Custom | Custom | ✅ | Contact |

---

### Core Endpoints

#### Get Current WSSI

```
GET /api/v1/wssi
```

Returns the current Weighted Synchronous Stress Index value and metadata.

**Response:**
```json
{
  "wssi_value": 0.67,
  "risk_level": "elevated",
  "timestamp": "2026-02-14T17:30:00Z",
  "active_themes": 20,
  "contributing_indicators": 52,
  "top_stress_themes": [
    {"theme": "Climate/Extreme Weather", "stress": 0.82},
    {"theme": "Geopolitical/Conflict", "stress": 0.78}
  ]
}
```

#### Get WSSI History

```
GET /api/v1/wssi/history?days=30
```

Returns historical WSSI values for trend analysis.

**Parameters:**
- `days` (int): Number of days to retrieve (1-365)
- `start_date` (ISO 8601): Alternative to days
- `end_date` (ISO 8601): Alternative to days

**Response:**
```json
{
  "data": [
    {"date": "2026-02-14", "wssi_value": 0.67, "risk_level": "elevated"},
    {"date": "2026-02-13", "wssi_value": 0.64, "risk_level": "moderate"}
  ],
  "count": 30,
  "period": "30 days"
}
```

#### Get Themes

```
GET /api/v1/themes
```

Returns all 20 themes with current stress levels.

**Response:**
```json
{
  "themes": [
    {
      "id": 1,
      "name": "Economic/Financial Stress",
      "stress_level": 0.58,
      "risk_level": "moderate",
      "active_indicators": 4,
      "last_updated": "2026-02-14T17:30:00Z"
    }
  ],
  "count": 20
}
```

#### Get Theme Detail

```
GET /api/v1/themes/{theme_id}
```

Returns detailed information about a specific theme including active indicators.

#### Get Indicators

```
GET /api/v1/indicators
```

Returns all data sources and their current values.

**Query Parameters:**
- `theme_id` (int): Filter by theme
- `source` (string): Filter by data source (e.g., "FRED", "HDX")

---

### Export Endpoints (Pro+)

#### Request Export

```
POST /api/v1/export/wssi
POST /api/v1/export/themes
POST /api/v1/export/indicators
```

**Request Body:**
```json
{
  "format": "csv",
  "start_date": "2026-01-01T00:00:00Z",
  "end_date": "2026-01-31T23:59:59Z",
  "limit": 10000
}
```

**Response:**
```json
{
  "export_id": "abc123xyz",
  "status": "processing",
  "check_url": "/api/v1/export/status/abc123xyz"
}
```

#### Check Export Status

```
GET /api/v1/export/status/{export_id}
```

#### Download Export

```
GET /api/v1/export/download/{filename}
```

---

### Admin Endpoints

Admin endpoints require an admin API key (`X-Admin-Key` header).

#### API Key Management

```
GET    /admin/keys                    # List all keys
POST   /admin/keys                    # Create new key
PUT    /admin/keys/{key_hash}         # Update key
DELETE /admin/keys/{key_hash}         # Revoke key
POST   /admin/keys/{key_hash}/rotate  # Rotate key
```

**Create Key Request:**
```json
{
  "name": "Production Client",
  "tier": "pro",
  "rate_limit": 500
}
```

#### Usage Monitoring

```
GET /admin/usage?period=24h
GET /admin/usage/hourly?hours=24
```

**Response:**
```json
{
  "total_requests": 15234,
  "unique_keys": 45,
  "error_rate": 0.02,
  "avg_response_time_ms": 45,
  "top_endpoints": [
    {"endpoint": "/api/v1/wssi", "count": 8934}
  ]
}
```

#### Rate Limit Monitoring

```
GET /admin/rate-limits?threshold=0.8
```

Returns keys approaching their rate limits.

#### Cache Management

```
POST /admin/cache/invalidate
```

Invalidate cache for WSSI, themes, or indicators.

---

## Python SDK

### Installation

```bash
pip install wssi-client
```

### Basic Usage

```python
from wssi import WSSIClient

# Initialize client
client = WSSIClient(api_key="wssi-free-YOUR-KEY")

# Get current WSSI
current = client.get_wssi()
print(f"WSSI: {current.wssi_value} ({current.risk_level})")

# Get history
history = client.get_wssi_history(days=30)
for point in history.data:
    print(f"{point.date}: {point.wssi_value}")

# Get themes
themes = client.get_themes()
high_stress = [t for t in themes if t.stress_level > 0.7]
```

### Admin Client

```python
from wssi import WSSIAdminClient

admin = WSSIAdminClient(admin_key="wssi-admin-YOUR-KEY")

# Create new API key
new_key = admin.create_key(
    name="New Client",
    tier="pro",
    rate_limit=500
)
print(f"New key: {new_key.api_key}")

# Monitor usage
usage = admin.get_usage(period="24h")
print(f"Total requests: {usage.total_requests}")

# List all keys
keys = admin.list_keys()
for key in keys:
    print(f"{key.name}: {key.tier} ({key.requests_today} today)")
```

### Error Handling

```python
from wssi import WSSIClient, WSSIError, RateLimitError

client = WSSIClient(api_key="wssi-free-YOUR-KEY")

try:
    wssi = client.get_wssi()
except RateLimitError:
    print("Rate limit exceeded. Upgrade to Pro?")
except WSSIError as e:
    print(f"API error: {e.message}")
```

---

## Data Sources

The WSSI aggregates data from 19+ authoritative sources:

| Domain | Sources | Indicators |
|--------|---------|------------|
| **Economic** | FRED (Federal Reserve) | Interest rates, volatility, spreads |
| **Humanitarian** | HDX HAPI (UN OCHA) | Refugees, IDPs, conflict events |
| **Hydrological** | USGS Water Data | Streamflow, drought, groundwater |
| **Pandemic** | ECDC, WHO DON, ProMED | Outbreak alerts, threat assessments |
| **AMR** | WHO GHO, PHAC | Antimicrobial resistance rates |
| **Research** | NIH RePORTER | Gain-of-function funding |
| **Zoonotic** | WOAH WAHIS | Animal disease events |
| **Geophysical** | USGS Earthquakes, NASA EONET | Seismic activity, natural disasters |
| **Cyber** | CISA KEV, CERT-EU | Vulnerability exploits, advisories |
| **OSINT** | IntelX | Breach monitoring, dark web signals |

---

## WSSI Methodology

The Weighted Synchronous Stress Index combines:

1. **Theme-level stress**: Each of 20 themes scored 0-1 based on indicator thresholds
2. **Cross-theme weighting**: Themes weighted by historical cascade frequency
3. **Synchronous detection**: Higher scores when multiple themes are stressed simultaneously
4. **Temporal smoothing**: 7-day rolling average to reduce noise

**Risk Levels:**
- **0.0 - 0.4**: Normal
- **0.4 - 0.6**: Moderate
- **0.6 - 0.8**: Elevated
- **0.8 - 1.0**: Critical

---

## Deployment

### Docker

```bash
cd polycrisis-intelligence/wssi-api

# Build
docker build -t wssi-api .

# Run
docker run -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_KEY="your-admin-key" \
  wssi-api
```

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run with auto-reload
uvicorn main:app --reload

# API docs available at:
# http://localhost:8000/docs (Swagger UI)
# http://localhost:8000/redoc (ReDoc)
```

---

## Monitoring

### Prometheus Metrics

```
GET /metrics
```

Returns Prometheus-compatible metrics:
- `wssi_requests_total` — Total requests by endpoint
- `wssi_response_time_seconds` — Response time percentiles
- `wssi_active_keys` — Number of active API keys

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "database": "connected",
  "last_wssi_calculation": "2026-02-14T17:30:00Z",
  "version": "1.0.0"
}
```

---

## Support

- **Documentation**: https://fragilitybrief.io/docs
- **Status Page**: https://status.fragilitybrief.io
- **Email**: api@fragilitybrief.io
- **Issues**: https://github.com/TashiikiD/Polycrisis-Intelligence/issues

---

## License

MIT License — See [LICENSE](../LICENSE) for details.

---

## Changelog

### v1.0.0 (2026-02-14)
- Initial public API release
- 19 data sources integrated
- Python SDK
- Admin dashboard
- Export endpoints (Pro+)
- Structured logging and monitoring

---

*Built with ❤️ by The Fragility Brief team.*
