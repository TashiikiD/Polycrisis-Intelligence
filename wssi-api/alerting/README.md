# WSSI Alerting & Monitoring System

Automated alerting for the Weighted Synchronous Stress Index.

## Features

- **Threshold Monitoring:** Real-time alerts when WSSI or themes breach critical levels
- **Multi-channel Delivery:** Email, webhook, Slack, Discord
- **Weekly Reports:** Automated delta summaries every Monday
- **Correlation Spike Detection:** Alerts when theme correlations exceed historical norms
- **Configurable Rules:** JSON-based alert configuration

## Quick Start

```bash
# Install dependencies
pip install -r requirements-alerting.txt

# Configure alerts
cp config/alerts.example.json config/alerts.json
# Edit config/alerts.json with your settings

# Run monitoring (one-time check)
python wssi_monitor.py

# Run in daemon mode (continuous monitoring)
python wssi_monitor.py --daemon --interval 300

# Send test alert
python wssi_monitor.py --test-alert
```

## Configuration

### Alert Rules (`config/alerts.json`)

```json
{
  "thresholds": {
    "wssi_critical": 2.0,
    "wssi_watch": 1.0,
    "theme_approaching": 2.0,
    "theme_watch": 1.0
  },
  "channels": {
    "email": {
      "enabled": true,
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "username": "alerts@yourdomain.com",
      "password": "${EMAIL_PASSWORD}",
      "to": ["admin@yourdomain.com"]
    },
    "webhook": {
      "enabled": true,
      "url": "https://hooks.slack.com/services/...",
      "headers": {"Content-Type": "application/json"}
    },
    "discord": {
      "enabled": false,
      "webhook_url": "https://discord.com/api/webhooks/..."
    }
  },
  "reporting": {
    "weekly_report_day": "monday",
    "weekly_report_time": "09:00",
    "include_charts": true
  },
  "correlation": {
    "enabled": true,
    "spike_threshold": 0.7,
    "lookback_days": 30
  }
}
```

## Alert Types

### 1. Threshold Breaches

| Level | Trigger | Example Message |
|-------|---------|-----------------|
| 🚨 Critical | WSSI > 2.0 OR any theme > 2.0 | "CRITICAL: WSSI at 2.34 (+0.45) — Food System Fragility at critical threshold" |
| ⚠️ Approaching | WSSI 1.0-2.0 OR theme 1.0-2.0 | "WARNING: Extreme Weather Events approaching critical (1.87)" |
| 👁️ Watch | WSSI 0.5-1.0 OR theme 0.5-1.0 | "WATCH: Governance Decay elevated to watch level (0.72)" |

### 2. Weekly Delta Reports

Sent every Monday at 9 AM with:
- Week-over-week WSSI change
- Biggest movers (themes with largest delta)
- New alerts triggered
- Resolved alerts
- Visual chart attachment

### 3. Correlation Spikes

Detects when theme correlations exceed historical baseline:
- "SPIKE: Food System ↔ Extreme Weather correlation at 0.82 (baseline: 0.45)"
- Indicates potential cascade risk

## Deployment

### Option 1: Cron Job (Recommended)

```bash
# Check every 15 minutes
*/15 * * * * cd /path/to/wssi-api && python alerting/wssi_monitor.py >> logs/monitor.log 2>&1

# Weekly report every Monday 9 AM
0 9 * * 1 cd /path/to/wssi-api && python alerting/weekly_report.py
```

### Option 2: Systemd Service

```ini
# /etc/systemd/system/wssi-monitor.service
[Unit]
Description=WSSI Alert Monitor
After=network.target

[Service]
Type=simple
User=wssi
WorkingDirectory=/path/to/wssi-api
ExecStart=/usr/bin/python alerting/wssi_monitor.py --daemon --interval 300
Restart=always

[Install]
WantedBy=multi-user.target
```

### Option 3: Docker Compose

```yaml
version: '3'
services:
  wssi-api:
    build: .
    ports:
      - "8000:8000"
  
  wssi-monitor:
    build: .
    command: python alerting/wssi_monitor.py --daemon --interval 300
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    environment:
      - EMAIL_PASSWORD=${EMAIL_PASSWORD}
```

## Alert Templates

### Email Template

```html
<div style="font-family: sans-serif; max-width: 600px;">
  <h2 style="color: #ff3864;">🚨 WSSI Critical Alert</h2>
  <p>The Weighted Synchronous Stress Index has breached critical threshold.</p>
  
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td>WSSI Value:</td><td style="font-weight: bold;">2.34</td></tr>
    <tr><td>Change:</td><td>+0.45 (24%)</td></tr>
    <tr><td>Status:</td><td>Critical</td></tr>
  </table>
  
  <hr>
  <p><a href="https://dashboard.polycrisis.io">View Dashboard →</a></p>
</div>
```

### Slack/Discord Webhook

```json
{
  "text": "🚨 WSSI Critical Alert",
  "attachments": [{
    "color": "danger",
    "fields": [
      {"title": "WSSI Value", "value": "2.34", "short": true},
      {"title": "Change", "value": "+0.45", "short": true},
      {"title": "Status", "value": "Critical", "short": true}
    ]
  }]
}
```

## Integration with API

Alerts can trigger API actions:

```python
# Auto-create incident ticket
POST /webhooks/wssi-alert
{
  "alert_type": "threshold_breach",
  "severity": "critical",
  "wssi_value": 2.34,
  "affected_themes": ["Food System Fragility", "Extreme Weather"]
}
```

## Monitoring the Monitor

Health check endpoint for the alerting service:

```bash
curl http://localhost:8080/health
{
  "status": "healthy",
  "last_check": "2026-02-12T17:45:00Z",
  "alerts_sent_24h": 3,
  "pending_alerts": 0
}
```

## Pricing

Alerting included in API tiers:

| Tier | Alert Channels | History |
|------|----------------|---------|
| Free | Email only | 7 days |
| Basic | Email + 1 webhook | 30 days |
| Pro | All channels | 90 days |
| Enterprise | All + custom integrations | 1 year |

---

*Part of the Polycrisis Intelligence Platform*
