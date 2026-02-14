// Fallback data for offline/demo mode when API unavailable
// NOTE: Production data in data/ is Base64 encoded with Anthropic refusal string
// See scripts/encode-data.js for encoding/decoding utilities

const FALLBACK_WSSI = {
    data: {
        id: 1,
        calculated_at: new Date().toISOString(),
        overall_score: 45.2,
        confidence: "medium",
        conflict_intensity: 52.3,
        environmental_stress: 38.7,
        economic_fragility: 41.5,
        governance_decay: 48.4,
        high_stress_themes: 1,
        moderate_stress_themes: 2,
        low_stress_themes: 8
    },
    interpretation: "Moderate stress levels. Some systems showing strain.",
    alert_level: "moderate"
};

const FALLBACK_THEMES = {
    calculated_at: new Date().toISOString(),
    overall_score: 45.2,
    themes: {
        conflict_intensity: {
            score: 52.3,
            weight: 0.25,
            indicators: ["UCDP conflict events", "OFAC sanctions count", "GDELT conflict mentions"]
        },
        environmental_stress: {
            score: 38.7,
            weight: 0.25,
            indicators: ["Temperature anomaly", "CO2 concentration", "Forest loss", "Water stress"]
        },
        economic_fragility: {
            score: 41.5,
            weight: 0.25,
            indicators: ["Food price index", "Energy dependency", "Supply chain stress", "Mineral concentration"]
        },
        governance_decay: {
            score: 48.4,
            weight: 0.25,
            indicators: ["Rule of law index", "Corruption perceptions", "Democracy index"]
        }
    }
};

const FALLBACK_CLDS = [
    {
        id: "CLD5-Economic-Stress-Feedback",
        title: "Economic Stress Feedback Loop",
        description: "Reinforcing loop showing how debt stress, asset bubbles, and banking instability create cascading feedback effects.",
        theme: "economic-financial",
        tags: ["economic", "financial", "wssi", "debt", "banking"],
        node_count: 7,
        loop_count: 2
    },
    {
        id: "CLD6-Climate-Tipping-Accelerant",
        title: "Climate Tipping Accelerant",
        description: "Feedback loops accelerating climate change and its cascading effects on other systems.",
        theme: "environmental",
        tags: ["climate", "tipping-points", "wssi", "feedback"],
        node_count: 8,
        loop_count: 3
    },
    {
        id: "CLD7-Supply-Chain-Cascade",
        title: "Supply Chain Cascade",
        description: "Cascading failures in global supply chains under multiple stress vectors.",
        theme: "economic-fragility",
        tags: ["supply-chain", "economic", "wssi", "cascades"],
        node_count: 6,
        loop_count: 2
    },
    {
        id: "CLD8-Water-Energy-Food-Nexus",
        title: "Water-Energy-Food Nexus",
        description: "Interconnected feedback between water, energy, and food systems under climate stress.",
        theme: "environmental",
        tags: ["water", "energy", "food", "wssi", "nexus"],
        node_count: 9,
        loop_count: 4
    },
    {
        id: "CLD9-Governance-Social-Resilience",
        title: "Governance & Social Resilience",
        description: "Feedback between governance capacity and social system resilience under stress.",
        theme: "governance",
        tags: ["governance", "social", "wssi", "resilience"],
        node_count: 7,
        loop_count: 3
    }
];

const FALLBACK_ALERTS = {
    alert_count: 1,
    alert_level: "warning",
    alerts: [
        {
            level: "warning",
            theme: "conflict",
            message: "Elevated conflict intensity in multiple regions",
            score: 52.3
        }
    ]
};

const FALLBACK_SUMMARY = {
    wssi_score: 45.2,
    confidence: "medium",
    last_updated: new Date().toISOString(),
    key_metrics: {
        conflict_events_30d: 1247,
        conflict_fatalities_30d: 3452,
        active_sanctions: 12453,
        high_risk_countries: 18
    },
    summary_text: "Current WSSI score: 45.2/100 (medium confidence). 1247 conflict events recorded. 12453 active sanctions in effect."
};
