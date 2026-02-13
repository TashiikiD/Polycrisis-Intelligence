# Polycrisis Intelligence Platform

**Real-time monitoring of global systemic risk across economic, climate, geopolitical, and biological domains.**

[![WSSI Score](https://img.shields.io/badge/WSSI-27.8%2F100-yellow)](https://tashiikid.github.io/Polycrisis-Intelligence/)
[![Themes Active](https://img.shields.io/badge/Themes-11-blue)](https://tashiikid.github.io/Polycrisis-Intelligence/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

🌍 **Live Dashboard:** [tashiikid.github.io/Polycrisis-Intelligence](https://tashiikid.github.io/Polycrisis-Intelligence/)  
📖 **Documentation:** [GitHub Wiki](https://github.com/TashiikiD/Polycrisis-Intelligence/wiki) (coming soon)

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

---

## Features

### 🎛️ Dual-Mode Dashboard

- **Brief Mode:** Bloomberg-style executive view with sortable tables, sparklines, and PDF export
- **Pulse Mode:** Living visualization with real-time orb, stress topology, and correlation maps

### 📡 23 Indicators, 11 Themes

Aggregated from 18 live data sources:

| Category | Sources | Key Metrics |
|----------|---------|-------------|
| **Economic-Financial** | FRED, BIS, FDIC | Debt ratios, spreads, asset prices |
| **Climate-Environmental** | NOAA, NASA, ICES | CO₂, temperature, fisheries, ice loss |
| **Geopolitical-Conflict** | OFAC, USGS, Polity5 | Sanctions, resource competition, governance |
| **Biological-Health** | FAO, USDA | Food prices, supply volatility |

### 🚀 Coming Soon

- **REST API** — Programmatic access to WSSI data (in development)
- **Real-time Alerts** — Threshold monitoring and notifications
- **Mobile App** — iOS/Android companion app

---

## Quick Start

### Dashboard

Visit the [live dashboard](https://tashiikid.github.io/Polycrisis-Intelligence/) or run locally:

```bash
git clone https://github.com/TashiikiD/Polycrisis-Intelligence.git
cd Polycrisis-Intelligence
cd dashboard/v2
python -m http.server 8000
# Open http://localhost:8000
```

### React Version (WIP)

```bash
cd apps/web
npm install
npm run dev
# Open http://localhost:5173
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Data Ingestion** | Python, pandas, requests |
| **Database** | SQLite (dev), PostgreSQL (prod) |
| **API Backend** | FastAPI, Pydantic (in development) |
| **Dashboard** | HTML5, CSS3, Chart.js, D3.js, React |
| **Hosting** | GitHub Pages (dashboard) |

---

## Project Structure

```
Polycrisis-Intelligence/
├── dashboard/              # V2 dual-mode dashboard (production)
│   ├── v2/                # Brief + Pulse modes
│   ├── latest.html        # V1 dashboard (legacy)
│   └── data/              # Sample data files
├── apps/web/              # React dashboard (WIP)
├── wssi-api/              # FastAPI backend (in development)
│   ├── main.py           # API server
│   ├── alerting/         # Monitoring daemon
│   └── config/           # Example configurations
├── legal/                 # Terms of Service, Privacy Policy
├── LICENSE                # MIT License
├── CONTRIBUTING.md        # Contribution guidelines
└── index.html            # Landing page
```

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

Areas where help is needed:
- Additional data source integrations
- Frontend improvements (React/Vue migration)
- Mobile app development
- Documentation and tutorials

---

## License

[MIT License](LICENSE) — See file for details.

---

Built with 🌩️ by [Tashi](https://github.com/TashiikiD) + Lodestar

*Last Updated: February 12, 2026*
