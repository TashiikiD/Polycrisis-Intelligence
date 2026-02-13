# Polycrisis Intelligence Platform

**Real-time monitoring of global systemic risk across economic, climate, geopolitical, and biological domains.**

[![WSSI Score](https://img.shields.io/badge/WSSI-27.8%2F100-yellow)](https://tashiikid.github.io/Polycrisis-Intelligence/dashboard/v2/)
[![Themes Active](https://img.shields.io/badge/Themes-11-blue)](https://tashiikid.github.io/Polycrisis-Intelligence/dashboard/v2/)
[![API Status](https://img.shields.io/badge/API-v1.0-green)](https://api.polycrisis.io/docs)

🌍 **Live Demo:** [Dashboard V2](https://tashiikid.github.io/Polycrisis-Intelligence/dashboard/v2/)  
📊 **API Docs:** [OpenAPI Reference](https://api.polycrisis.io/docs)  
📖 **Roadmap:** [V2.0 Implementation Plan](WSSI_FRONTEND_V2_ROADMAP.md)

---

## What is WSSI?

The **Weighted Synchronous Stress Index (WSSI)** is a composite metric that measures the *synchronization* of stress across traditionally siloed domains. Unlike single-domain risk indices, WSSI captures **correlation effects**—the dangerous moment when economic, climate, and geopolitical stresses amplify each other.

### Current Reading (Feb 12, 2026)

| Metric | Value | Status |
|--------|-------|--------|
| **WSSI Score** | 27.8/100 | 🟡 Moderate stress |
| **Trend** | ↑ +2.3 | Increasing |
| **Active Themes** | 11 | Across 4 categories |
| **Above Warning** | 3 | Food, Real Assets, Weather |

### 11 Active Themes

| Category | Themes | Key Indicators |
|----------|--------|----------------|
| **Economic-Financial** (4) | Sovereign Debt, Corporate Debt, Banking Stress, Real Assets | BIS debt/GDP, FDIC metrics, Case-Shiller, spreads |
| **Climate-Environmental** (3) | Tipping Points, Extreme Weather, Ecosystem Collapse | CO₂, ice loss, NOAA/ICES fisheries |
| **Geopolitical-Conflict** (3) | Interstate Conflict, Resource Competition, Governance Decay | OFAC sanctions, mineral concentration, Polity5, CPI |
| **Biological-Health** (1) | Food System Fragility | FAO food price, FAO cereals, USDA volatility |

**Total Data Sources:** 23 indicators from 18 feeds (FRED, NOAA, FAO, USGS, ICES, etc.)

---

## Product Suite

### 1. Dashboard V2 — Dual-Mode Interface

**Brief Mode** — Bloomberg-style executive view
- Sortable theme table with sparklines
- Comparative views (today vs last week/month/year)
- PDF export for board presentations
- Mobile-responsive

**Pulse Mode** — Living system visualization
- Central WSSI orb with real-time pulse
- Stress topology map (force-directed correlations)
- Temporal river (flowing time-series)
- Cascade simulator (what-if scenarios)

**Live:** [dashboard/v2/](https://tashiikid.github.io/Polycrisis-Intelligence/dashboard/v2/)

### 2. API Service — Developer Access

**Base URL:** `https://api.polycrisis.io/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /wssi/current` | Latest WSSI score + theme breakdown |
| `GET /wssi/history` | Time series data |
| `GET /themes` | All themes with current status |
| `GET /indicators` | Raw indicator values |

**Features:**
- API key authentication
- Tiered rate limiting (Free/Basic/Pro/Enterprise)
- Auto-generated TypeScript SDK
- OpenAPI/Swagger documentation

**Pricing:** Free (100 calls/day) → Pro ($199/mo, 100K calls/day)

### 3. Alerting & Monitoring

**Real-Time Alerts:**
- Threshold breaches (Watch/Approaching/Critical)
- Multi-channel delivery (email, Slack, Discord, webhook)
- Correlation spike detection

**Weekly Intelligence Reports:**
- WoW WSSI delta analysis
- Biggest movers identification
- Alert summary and trend context

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Data Ingestion** | Python (requests, pandas), 18 live feeds |
| **Database** | SQLite (dev), PostgreSQL (prod) |
| **Analytics** | FastAPI, NumPy, MAD-based normalization |
| **API Backend** | FastAPI, JWT auth, rate limiting |
| **Dashboard** | Vanilla HTML/CSS/JS, Chart.js, D3.js, Three.js |
| **Alerting** | Python daemon, SQLite state tracking |
| **Hosting** | GitHub Pages (dashboard), Render/Railway (API) |

---

## Quick Start

### Run Dashboard Locally
```bash
git clone https://github.com/TashiikiD/Polycrisis-Intelligence.git
cd Polycrisis-Intelligence/dashboard/v2
python -m http.server 8000
# Open http://localhost:8000
```

### Run API Locally
```bash
cd Polycrisis-Intelligence/wssi-api
pip install -r requirements.txt
uvicorn main:app --reload
# API at http://localhost:8000/docs
```

### Docker Deployment
```bash
docker-compose up -d
# Dashboard: http://localhost:8080
# API: http://localhost:8000
```

---

## Project Status

| Phase | Status | Deliverables |
|-------|--------|--------------|
| **V1** | ✅ Complete | Basic dashboard, sample data |
| **V2** | ✅ Complete | Dual-mode dashboard, 23 indicators, API, alerting |
| **V2.0** | 🚧 Roadmap | React SPA, PWA, mobile apps, enterprise features |

**Current:** Production-ready for beta customers. V2.0 roadmap prioritizes React migration, real-time updates, and enterprise SSO.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [`WSSI_FRONTEND_V2_ROADMAP.md`](WSSI_FRONTEND_V2_ROADMAP.md) | Comprehensive 120-160hr implementation plan |
| [`WSSI_STAKEHOLDER_BRIEF.md`](WSSI_STAKEHOLDER_BRIEF.md) | Monetization deck for investor/customer conversations |
| [`VIABILITY_RUBRIC.md`](VIABILITY_RUBRIC.md) | Business line prioritization framework |
| [`wssi-api/README.md`](wssi-api/README.md) | API setup and deployment guide |
| [`dashboard/v2-spec.md`](dashboard/v2-spec.md) | Design specification for dual-mode interface |

---

## Target Customers

| Segment | Use Case | Price Point |
|---------|----------|-------------|
| **Asset Managers** | Portfolio risk overlay, tail hedging | $199-500/mo |
| **Corporate Risk** | Supply chain resilience, scenario planning | $199-999/mo |
| **Government/NGOs** | Policy planning, humanitarian early warning | $999-5,000/mo |
| **Researchers** | Academic analysis (citation required) | Free |

---

## Contributing

This is a research and commercial project. For collaboration inquiries:
- Open an issue for bugs or feature requests
- See [`WSSI_STAKEHOLDER_BRIEF.md`](WSSI_STAKEHOLDER_BRIEF.md) for partnership options

---

## License

MIT License — See [LICENSE](LICENSE) file for details.

---

Built with 🌩️ by Tashi + Lodestar

*Last Updated: February 12, 2026*
