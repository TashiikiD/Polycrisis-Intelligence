# WSSI API Layer

FastAPI-based REST API for the Weighted Synchronous Stress Index.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Documentation

Auto-generated docs available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Authentication

All endpoints require API key in header:
```
X-API-Key: your-api-key-here
```

Get API key: Contact admin or use `/admin/create-key` (admin only)

## Endpoints

### Public (with API key)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wssi/current` | GET | Current WSSI score and metadata |
| `/wssi/history` | GET | Historical WSSI values |
| `/themes` | GET | All theme data with current status |
| `/themes/{theme_id}` | GET | Specific theme details |
| `/indicators` | GET | Raw indicator values |
| `/indicators/{indicator_id}` | GET | Specific indicator history |
| `/health` | GET | API health check |

### Admin (requires admin key)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/create-key` | POST | Create new API key |
| `/admin/keys` | GET | List all keys |
| `/admin/revoke-key` | POST | Revoke API key |
| `/admin/stats` | GET | Usage statistics |

## Rate Limiting

- Free tier: 100 requests/day
- Basic tier: 10,000 requests/day  
- Pro tier: 100,000 requests/day
- Enterprise: Custom limits

Headers returned:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1644729600
```

## Response Format

### WSSI Current
```json
{
  "wssi_value": -1.4313,
  "wssi_score": 27.83,
  "wssi_delta": 0.23,
  "trend": "up",
  "stress_level": "moderate",
  "active_themes": 11,
  "above_warning": 3,
  "calculation_timestamp": "2026-02-12T17:38:00Z",
  "theme_signals": [...]
}
```

### Error Responses
```json
{
  "detail": "Invalid API key",
  "code": "AUTH_INVALID_KEY"
}
```

## Monetization Tiers

| Tier | Price | Limits | Features |
|------|-------|--------|----------|
| Free | $0 | 100/day | Current WSSI only |
| Basic | $49/mo | 10K/day | Full history, all themes |
| Pro | $199/mo | 100K/day | Real-time webhooks, priority support |
| Enterprise | Custom | Unlimited | SLA, dedicated instance, custom indicators |

## Deployment

### Docker
```bash
docker build -t wssi-api .
docker run -p 8000:8000 -v $(pwd)/data:/app/data wssi-api
```

### Environment Variables
```bash
DATABASE_URL=sqlite:///data/wssi_api.db
ADMIN_API_KEY=admin-secret-key
RATE_LIMIT_STORAGE=memory  # or redis
REDIS_URL=redis://localhost:6379/0
LOG_LEVEL=info
```

## Projected Revenue (Month 6)

| Tier | Users | MRR |
|------|-------|-----|
| Free | 500 | $0 |
| Basic | 20 | $980 |
| Pro | 5 | $995 |
| Enterprise | 1 | $1,000 |
| **Total** | **526** | **$2,975** |

*Target: $1,850/mo for viability*

---

*Built for the Polycrisis Intelligence Platform*
