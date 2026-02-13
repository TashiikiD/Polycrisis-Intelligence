# WSSI Dashboard V2 Design Spec
## Dual-Mode Interface

---

## Mode A: "Brief" (Classic/No-Frills)
**Audience:** Executives, board members, time-constrained decision-makers
**Vibe:** Bloomberg Terminal meets UN Report — authoritative, dense, scannable

### Visual Language
- **Color:** Neutral grays, single accent (deep blue or muted gold)
- **Typography:** Monospace for numbers, clean sans-serif for labels
- **Layout:** Tabular, grid-based, information-dense
- **Interactivity:** Minimal — hover for tooltips, click to expand

### Key Elements
```
┌─────────────────────────────────────────────────────────────┐
│ WSSI: -1.43  ↑  [SCORE: 27.8]  [+3.04 vs last week]        │
├─────────────────────────────────────────────────────────────┤
│ THEME          RAW      NORM    STATUS    WEIGHT           │
│ Food System    100.0    +1.79   WATCH     1.5              │
│ Real Assets    64.53    +1.37   WATCH     1.0              │
│ Extreme Wx     0.0      -2.42   APPROACH  1.5              │
│ ... (9 more rows)                                         │
├─────────────────────────────────────────────────────────────┤
│ ALERTS: None active  |  Last update: 2026-02-12 17:01      │
└─────────────────────────────────────────────────────────────┘
```

### Features
- Sortable theme table
- PDF export button
- Last N calculations trend line
- Threshold breach history

---

## Mode B: "Pulse" (Experimental/Dynamic)
**Audience:** Researchers, analysts, systems thinkers, polycrisis enthusiasts
**Vibe:** Living system, cyberpunk dashboard, sense of urgency without panic

### Visual Language
- **Color:** Deep blacks, neon accents (cyan urgency, amber warning, red critical)
- **Typography:** Variable fonts that respond to data (weight increases with stress)
- **Layout:** Organic, radial, force-directed graphs
- **Interactivity:** High — drag, zoom, explore correlations

### Key Elements

#### 1. Living WSSI Orb
```
    ╭──────────────────╮
   ╱   ◉                ╲
  │   /|\   PULSE        │  ← Central orb pulses with WSSI magnitude
  │  / | \  -1.43        │     Color shifts: blue→amber→red
  │    |                 │     Size breathes with volatility
   ╲   ↓                ╱
    ╰──────────────────╯
```
- Central visualization that "breathes" — size correlates to active theme count
- Color temperature: cool (stable) → warm (watch) → hot (critical)
- Particle system: themes as orbiting nodes, proximity = correlation

#### 2. Stress Topology Map
- Force-directed graph of 11 themes
- Nodes pulse when above threshold
- Edges show correlation strength (discovered from historical data)
- Click edge → see correlation details

#### 3. Temporal River
- Time-series as a flowing river, not a line chart
- Width = WSSI magnitude
- Color = dominant category
- Zoomable, scrubbable

#### 4. Cascade Simulator
- "What if" playground
- Adjust one theme, see projected impacts on others
- Based on correlation matrix

### Easter Eggs (for engaged users)
- Konami code reveals "raw matrix view" (all indicator values)
- Long-press on orb shows full calculation breakdown
- Hidden correlations (weak but statistically significant)

---

## Technical Approach

### Architecture
```
dashboard/
├── index.html              # Mode toggle landing
├── modes/
│   ├── brief/             # Classic mode
│   │   ├── index.html
│   │   ├── css/brief.css
│   │   └── js/brief.js
│   └── pulse/             # Experimental mode
│       ├── index.html
│       ├── css/pulse.css
│       ├── js/pulse.js
│       └── visuals/       # D3, Three.js, Canvas
├── shared/
│   ├── css/variables.css  # Design tokens
│   ├── js/wssi-api.js     # Data layer
│   └── assets/            # Icons, fonts
└── data/
    └── wssi-latest.json   # Snapshot
```

### Libraries
- **Brief:** Vanilla JS, maybe Chart.js for sparklines
- **Pulse:** D3.js (force simulation), Canvas API (particle systems), maybe Three.js for 3D orb

### Data Flow
```
SQLite → Python API → JSON endpoint → Both modes consume
```

---

## Implementation Phases

### Phase 1: Brief Mode (2-3 hours)
- Clean table layout
- Sortable columns
- PDF export
- Mobile responsive

### Phase 2: Pulse Mode Foundation (3-4 hours)
- Living orb with Canvas
- Color/shape responding to WSSI
- Theme node layout

### Phase 3: Pulse Mode Advanced (4-5 hours)
- Force-directed correlation graph
- Temporal river
- Cascade simulator

### Phase 4: Polish (2 hours)
- Mode toggle animation
- Loading states
- Error handling
- Accessibility

---

## Design Tokens

### Colors (Pulse Mode)
```css
:root {
  --bg-void: #0a0a0f;
  --bg-surface: #12121a;
  --bg-elevated: #1a1a24;
  
  --accent-cyan: #00d4aa;      /* Stable/Healthy */
  --accent-amber: #ff9f1c;     /* Watch */
  --accent-red: #ff3864;       /* Critical */
  --accent-purple: #b829dd;    /* Governance theme */
  --accent-blue: #2979ff;      /* Climate theme */
  
  --text-primary: #f0f0f5;
  --text-secondary: #8b8b9a;
  --text-muted: #4a4a5a;
}
```

### Animation Timing
- Orb pulse: 2s ease-in-out infinite
- Theme node drift: 8s linear infinite (subtle)
- Transitions: 300ms cubic-bezier(0.4, 0, 0.2, 1)

---

## Accessibility Notes
- Both modes respect `prefers-reduced-motion`
- Brief mode is keyboard-navigable
- Pulse mode has keyboard alternatives for all interactions
- Colorblind-safe palettes (not red/green dependent)

---

## File: business_development/dashboard/v2-spec.md
