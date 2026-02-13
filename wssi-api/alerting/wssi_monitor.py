#!/usr/bin/env python3
"""
WSSI Alert Monitor
Monitors WSSI data and sends alerts when thresholds are breached.
"""

import json
import os
import sys
import time
import argparse
import sqlite3
import smtplib
import requests
from datetime import datetime, timedelta
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, List, Optional

# Paths
SCRIPT_DIR = Path(__file__).parent
CONFIG_DIR = SCRIPT_DIR.parent / "config"
DATA_DIR = SCRIPT_DIR.parent / "data"
LOGS_DIR = SCRIPT_DIR.parent / "logs"

LOGS_DIR.mkdir(exist_ok=True)

# Database for alert state
ALERT_DB = DATA_DIR / "alerts.db"

def init_alert_db():
    """Initialize SQLite database for alert tracking."""
    conn = sqlite3.connect(ALERT_DB)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alert_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            theme_id TEXT,
            message TEXT,
            wssi_value REAL,
            threshold_value REAL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            acknowledged BOOLEAN DEFAULT 0
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alert_state (
            theme_id TEXT PRIMARY KEY,
            last_status TEXT,
            last_value REAL,
            alert_count INTEGER DEFAULT 0,
            first_alert_at TIMESTAMP,
            last_alert_at TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def load_config() -> Dict:
    """Load alert configuration."""
    config_path = CONFIG_DIR / "alerts.json"
    if not config_path.exists():
        # Create default config
        default_config = {
            "thresholds": {
                "wssi_critical": 2.0,
                "wssi_watch": 1.0,
                "theme_approaching": 2.0,
                "theme_watch": 1.0
            },
            "channels": {
                "email": {"enabled": False},
                "webhook": {"enabled": False},
                "discord": {"enabled": False}
            },
            "reporting": {
                "weekly_report_day": "monday",
                "weekly_report_time": "09:00"
            }
        }
        CONFIG_DIR.mkdir(exist_ok=True)
        with open(config_path, 'w') as f:
            json.dump(default_config, f, indent=2)
        print(f"Created default config at {config_path}")
        return default_config
    
    with open(config_path) as f:
        return json.load(f)

def load_wssi_data() -> Optional[Dict]:
    """Load current WSSI data."""
    data_path = DATA_DIR / "wssi-latest.json"
    if not data_path.exists():
        return None
    
    with open(data_path) as f:
        return json.load(f)

def get_alert_severity(value: float, thresholds: Dict) -> str:
    """Determine alert severity based on value."""
    if value >= thresholds.get('critical', 2.0):
        return 'critical'
    elif value >= thresholds.get('approaching', 1.5):
        return 'approaching'
    elif value >= thresholds.get('watch', 1.0):
        return 'watch'
    return 'stable'

def send_email_alert(subject: str, body: str, html_body: str, config: Dict) -> bool:
    """Send email alert."""
    email_config = config.get('channels', {}).get('email', {})
    if not email_config.get('enabled'):
        return False
    
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = email_config.get('username', 'alerts@wssi.io')
        msg['To'] = ', '.join(email_config.get('to', []))
        
        msg.attach(MIMEText(body, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))
        
        with smtplib.SMTP(email_config['smtp_host'], email_config['smtp_port']) as server:
            server.starttls()
            server.login(email_config['username'], email_config['password'])
            server.send_message(msg)
        
        return True
    except Exception as e:
        print(f"Email send failed: {e}")
        return False

def send_webhook_alert(payload: Dict, config: Dict) -> bool:
    """Send webhook alert."""
    webhook_config = config.get('channels', {}).get('webhook', {})
    if not webhook_config.get('enabled'):
        return False
    
    try:
        response = requests.post(
            webhook_config['url'],
            json=payload,
            headers=webhook_config.get('headers', {}),
            timeout=30
        )
        return response.status_code < 400
    except Exception as e:
        print(f"Webhook send failed: {e}")
        return False

def send_discord_alert(message: str, embed: Dict, config: Dict) -> bool:
    """Send Discord webhook alert."""
    discord_config = config.get('channels', {}).get('discord', {})
    if not discord_config.get('enabled'):
        return False
    
    try:
        payload = {
            "content": message,
            "embeds": [embed]
        }
        response = requests.post(
            discord_config['webhook_url'],
            json=payload,
            timeout=30
        )
        return response.status_code < 400
    except Exception as e:
        print(f"Discord send failed: {e}")
        return False

def log_alert(alert_type: str, severity: str, theme_id: Optional[str], 
              message: str, wssi_value: float, threshold: float):
    """Log alert to database."""
    conn = sqlite3.connect(ALERT_DB)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO alert_history (alert_type, severity, theme_id, message, wssi_value, threshold_value)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (alert_type, severity, theme_id, message, wssi_value, threshold))
    
    # Update state
    cursor.execute('''
        INSERT INTO alert_state (theme_id, last_status, last_value, alert_count, first_alert_at, last_alert_at)
        VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(theme_id) DO UPDATE SET
            last_status = excluded.last_status,
            last_value = excluded.last_value,
            alert_count = alert_count + 1,
            last_alert_at = datetime('now')
    ''', (theme_id or 'wssi', severity, wssi_value))
    
    conn.commit()
    conn.close()

def check_thresholds(wssi_data: Dict, config: Dict) -> List[Dict]:
    """Check all thresholds and return triggered alerts."""
    alerts = []
    thresholds = config.get('thresholds', {})
    
    # Check overall WSSI
    wssi_value = abs(wssi_data['wssi_value'])
    wssi_severity = get_alert_severity(wssi_value, {
        'critical': thresholds.get('wssi_critical', 2.0),
        'approaching': thresholds.get('wssi_approaching', 1.5),
        'watch': thresholds.get('wssi_watch', 1.0)
    })
    
    if wssi_severity != 'stable':
        alerts.append({
            'type': 'wssi_threshold',
            'severity': wssi_severity,
            'theme_id': None,
            'value': wssi_value,
            'threshold': thresholds.get(f'wssi_{wssi_severity}', 1.0),
            'message': f"WSSI at {wssi_data['wssi_value']:.2f} ({wssi_severity})"
        })
    
    # Check individual themes
    for theme in wssi_data.get('theme_signals', []):
        norm_value = abs(theme['normalized_value'])
        theme_severity = get_alert_severity(norm_value, {
            'critical': thresholds.get('theme_approaching', 2.0),
            'approaching': thresholds.get('theme_approaching', 1.5),
            'watch': thresholds.get('theme_watch', 1.0)
        })
        
        if theme_severity != 'stable':
            alerts.append({
                'type': 'theme_threshold',
                'severity': theme_severity,
                'theme_id': theme['theme_name'],
                'value': norm_value,
                'threshold': thresholds.get(f'theme_{theme_severity}', 1.0),
                'message': f"{theme['theme_name']} at {norm_value:.2f} ({theme_severity})"
            })
    
    return alerts

def send_alert(alert: Dict, wssi_data: Dict, config: Dict):
    """Send alert through all configured channels."""
    severity_emoji = {
        'critical': '🚨',
        'approaching': '⚠️',
        'watch': '👁️'
    }
    
    emoji = severity_emoji.get(alert['severity'], 'ℹ️')
    subject = f"{emoji} WSSI Alert: {alert['message']}"
    
    # Plain text body
    body = f"""
WSSI Alert - {alert['severity'].upper()}

{alert['message']}

Current WSSI: {wssi_data['wssi_value']:.2f}
Active Themes: {wssi_data['active_themes']}
Above Warning: {wssi_data['above_warning']}

Time: {datetime.utcnow().isoformat()}

View Dashboard: https://dashboard.polycrisis.io
"""
    
    # HTML body
    html_body = f"""
<div style="font-family: sans-serif; max-width: 600px; padding: 20px;">
    <h2 style="color: {'#ff3864' if alert['severity'] == 'critical' else '#ff9f1c' if alert['severity'] == 'approaching' else '#00d4aa'};">
        {emoji} WSSI {alert['severity'].upper()} Alert
    </h2>
    
    <p style="font-size: 18px;">{alert['message']}</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">WSSI Value:</td>
            <td style="padding: 10px; font-weight: bold;">{wssi_data['wssi_value']:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">Active Themes:</td>
            <td style="padding: 10px;">{wssi_data['active_themes']}</td>
        </tr>
        <tr>
            <td style="padding: 10px;">Above Warning:</td>
            <td style="padding: 10px;">{wssi_data['above_warning']}</td>
        </tr>
    </table>
    
    <p style="color: #666; font-size: 12px;">
        {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
    </p>
</div>
"""
    
    # Webhook payload
    webhook_payload = {
        "alert_type": alert['type'],
        "severity": alert['severity'],
        "message": alert['message'],
        "wssi_value": wssi_data['wssi_value'],
        "theme_id": alert.get('theme_id'),
        "timestamp": datetime.utcnow().isoformat()
    }
    
    # Discord embed
    discord_embed = {
        "title": f"WSSI {alert['severity'].upper()} Alert",
        "description": alert['message'],
        "color": 16711680 if alert['severity'] == 'critical' else 16753920 if alert['severity'] == 'approaching' else 3447003,
        "fields": [
            {"name": "WSSI Value", "value": f"{wssi_data['wssi_value']:.2f}", "inline": True},
            {"name": "Active Themes", "value": str(wssi_data['active_themes']), "inline": True}
        ],
        "timestamp": datetime.utcnow().isoformat()
    }
    
    # Send through all channels
    results = []
    results.append(("email", send_email_alert(subject, body, html_body, config)))
    results.append(("webhook", send_webhook_alert(webhook_payload, config)))
    results.append(("discord", send_discord_alert(subject, discord_embed, config)))
    
    return results

def run_monitor(config: Dict, test_mode: bool = False):
    """Run single monitoring check."""
    wssi_data = load_wssi_data()
    if not wssi_data:
        print("No WSSI data available")
        return False
    
    alerts = check_thresholds(wssi_data, config)
    
    if test_mode:
        print(f"Test mode: Would send {len(alerts)} alerts")
        for alert in alerts:
            print(f"  - {alert['severity']}: {alert['message']}")
        return True
    
    if not alerts:
        print(f"{datetime.now().isoformat()} - All clear. WSSI: {wssi_data['wssi_value']:.2f}")
        return True
    
    print(f"{datetime.now().isoformat()} - {len(alerts)} alerts triggered")
    
    for alert in alerts:
        print(f"  Sending: {alert['message']}")
        results = send_alert(alert, wssi_data, config)
        
        # Log alert
        log_alert(
            alert['type'],
            alert['severity'],
            alert.get('theme_id'),
            alert['message'],
            wssi_data['wssi_value'],
            alert['threshold']
        )
        
        for channel, success in results:
            status = "✓" if success else "✗"
            print(f"    {status} {channel}")
    
    return True

def run_daemon(config: Dict, interval: int = 300):
    """Run monitoring in daemon mode."""
    print(f"Starting WSSI Monitor (interval: {interval}s)")
    
    while True:
        try:
            run_monitor(config)
        except Exception as e:
            print(f"Monitor error: {e}")
        
        time.sleep(interval)

def main():
    parser = argparse.ArgumentParser(description='WSSI Alert Monitor')
    parser.add_argument('--daemon', action='store_true', help='Run in daemon mode')
    parser.add_argument('--interval', type=int, default=300, help='Check interval in seconds (default: 300)')
    parser.add_argument('--test-alert', action='store_true', help='Send test alert')
    
    args = parser.parse_args()
    
    # Initialize
    init_alert_db()
    config = load_config()
    
    if args.test_alert:
        # Create test data
        test_data = {
            "wssi_value": 2.34,
            "wssi_score": 75.5,
            "active_themes": 11,
            "above_warning": 3,
            "theme_signals": [
                {"theme_name": "Test Theme", "normalized_value": 2.1}
            ]
        }
        test_alert = {
            'type': 'test',
            'severity': 'critical',
            'theme_id': None,
            'value': 2.34,
            'threshold': 2.0,
            'message': 'TEST ALERT: WSSI Monitor is working'
        }
        send_alert(test_alert, test_data, config)
        print("Test alert sent")
        return
    
    if args.daemon:
        run_daemon(config, args.interval)
    else:
        run_monitor(config)

if __name__ == "__main__":
    main()
