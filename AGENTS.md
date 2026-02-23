# AGENTS.md - Polycrisis Intelligence (Public)

## Project Context

**Location:** `E:/polycrisis-intelligence/`
**Purpose:** Public-facing dashboard, API clients, documentation
**Repository:** https://github.com/TashiikiD/Polycrisis-Intelligence
**License:** MIT

## Architecture

```
E:/polycrisis-intelligence/
├── dashboard/              # Public dashboard (v1 legacy, v2 current)
│   ├── v1/                # Original d3.js visualization
│   └── v2/                # React-based dashboard (in dev)
├── wssi-api/              # API client examples, documentation
│   └── README.md          # Public API docs
├── LICENSE                # MIT License
├── README.md              # Project overview
└── shared/ → E:/shared-polycrisis-infrastructure/  (SYMLINK - not in git)
```

## Key Files

| File | Purpose |
|------|---------|
| `dashboard/v2/` | Current dashboard development |
| `wssi-api/README.md` | Public API documentation |
| `LICENSE` | MIT License |
| `shared/` | Junction to infrastructure (runtime only) |

## Public vs Private

| Public (this repo) | Private (sandbox) |
|-------------------|-------------------|
| Dashboard UI code | WSSI API backend |
| API documentation | API keys, secrets |
| Demo data | Production databases |
| Client examples | Server implementation |

## Agent Instructions

1. **Never commit:** `shared/`, API keys, `.env` files
2. **Dashboard updates:** Work in `dashboard/v2/`
3. **API docs:** Keep `wssi-api/README.md` current
4. **Shared data:** Reference via `shared/` junction at runtime

## Quick Start

```bash
# Dashboard v2 (from dashboard/v2/)
npm install
npm run dev

# View data (via shared junction)
ls shared/data/polycrisis.db
```

---
*Created: 2026-02-23 | Migrated from clawd/*
