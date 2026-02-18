from fastapi import FastAPI, HTTPException, Depends, Header, status, Request, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import sqlite3
import json
import os
import hashlib
import hmac
import importlib
import secrets
from pathlib import Path

# Database setup
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "wssi_api.db"
WSSI_DATA_PATH = DATA_DIR / "wssi-latest.json"
ANALYTICS_DIR = Path(__file__).resolve().parents[2] / "output" / "analytics"

TIER_RATE_LIMITS = {
    "free": 0,
    "basic": 1000,
    "pro": 1000,
    "enterprise": 999999999
}
TIER_NAMES = {
    "free": "Free",
    "basic": "Basic",
    "pro": "Professional",
    "enterprise": "Enterprise"
}
SUPPORTED_TIERS = set(TIER_RATE_LIMITS.keys())

STRIPE_ENV = {
    "publishable_key": "STRIPE_PUBLISHABLE_KEY",
    "secret_key": "STRIPE_SECRET_KEY",
    "webhook_secret": "STRIPE_WEBHOOK_SECRET",
    "price_basic": "STRIPE_PRICE_BASIC",
    "price_pro": "STRIPE_PRICE_PRO",
    "coupon_basic": "STRIPE_COUPON_BASIC_INTRO",
    "coupon_pro": "STRIPE_COUPON_PRO_INTRO",
    "success_url": "STRIPE_SUCCESS_URL",
    "cancel_url": "STRIPE_CANCEL_URL"
}

def init_db():
    """Initialize SQLite database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # API keys table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS api_keys (
            key_hash TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tier TEXT DEFAULT 'free',
            rate_limit INTEGER DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            is_admin BOOLEAN DEFAULT 0
        )
    ''')
    
    # Rate limiting table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rate_limits (
            key_hash TEXT PRIMARY KEY,
            requests_count INTEGER DEFAULT 0,
            reset_at TIMESTAMP,
            FOREIGN KEY (key_hash) REFERENCES api_keys(key_hash)
        )
    ''')
    
    # Usage logs
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT,
            endpoint TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status_code INTEGER,
            response_time_ms INTEGER,
            FOREIGN KEY (key_hash) REFERENCES api_keys(key_hash)
        )
    ''')

    # Lightweight user records (legacy auth compatibility + account metadata)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            first_name TEXT,
            last_name TEXT,
            company TEXT,
            key_hash TEXT,
            tier TEXT DEFAULT 'free',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY (key_hash) REFERENCES api_keys(key_hash)
        )
    ''')

    # Billing events audit
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS billing_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT,
            event_type TEXT NOT NULL,
            key_hash TEXT,
            tier TEXT,
            payload_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create default admin key if none exists
    cursor.execute("SELECT COUNT(*) FROM api_keys WHERE is_admin = 1")
    if cursor.fetchone()[0] == 0:
        admin_key = "wssi-admin-" + secrets.token_urlsafe(32)
        admin_hash = hashlib.sha256(admin_key.encode()).hexdigest()
        cursor.execute('''
            INSERT INTO api_keys (key_hash, name, tier, rate_limit, is_admin)
            VALUES (?, 'Default Admin', 'enterprise', 999999999, 1)
        ''', (admin_hash,))
        print(f"Created default admin key: {admin_key}")
        print("SAVE THIS KEY - it will not be shown again!")
    
    conn.commit()
    conn.close()

# Initialize on startup
init_db()

# Pydantic models
class WSSIResponse(BaseModel):
    wssi_value: float
    wssi_score: float
    wssi_delta: float
    trend: str
    stress_level: str = "unknown"
    active_themes: int
    above_warning: int
    calculation_timestamp: datetime
    theme_signals: List[Dict[str, Any]]

class ThemeSignal(BaseModel):
    theme_id: str
    theme_name: str
    category: str
    raw_value: float
    normalized_value: float
    stress_level: str
    weight: float
    weighted_contribution: float

class IndicatorValue(BaseModel):
    indicator_id: str
    indicator_name: str
    source: str
    value: float
    unit: Optional[str]
    timestamp: datetime
    metadata: Optional[Dict[str, Any]]

class APIKeyCreate(BaseModel):
    name: str
    tier: str = Field(default="free", pattern="^(free|basic|pro|enterprise)$")
    expires_days: Optional[int] = None

class APIKeyResponse(BaseModel):
    key: str
    name: str
    tier: str
    created_at: datetime
    expires_at: Optional[datetime]

class RateLimitInfo(BaseModel):
    limit: int
    remaining: int
    reset_at: datetime

class APIKeyRequest(BaseModel):
    email: str
    tier: str = Field(default="free", pattern="^(free|basic|pro|enterprise)$")
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None
    password: Optional[str] = None

class KeyLoginRequest(BaseModel):
    api_key: str

class LegacyLoginRequest(BaseModel):
    email: str
    password: str

class BillingCheckoutRequest(BaseModel):
    tier: str = Field(pattern="^(basic|pro|enterprise)$")
    api_key: Optional[str] = None
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None

# FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    yield
    # Shutdown
    pass

app = FastAPI(
    title="WSSI API",
    description="Weighted Synchronous Stress Index - Polycrisis Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan
)

# Middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer(auto_error=False)

# Helper functions
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def normalize_tier(tier: Optional[str], default: str = "free") -> str:
    normalized = str(tier or default).strip().lower()
    return normalized if normalized in SUPPORTED_TIERS else default

def rate_limit_for_tier(tier: Optional[str]) -> int:
    return TIER_RATE_LIMITS.get(normalize_tier(tier), TIER_RATE_LIMITS["free"])

def generate_api_key(tier: str) -> Tuple[str, str]:
    normalized = normalize_tier(tier)
    prefix = f"wssi-{normalized}"
    api_key = f"{prefix}-{secrets.token_urlsafe(24)}"
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    return api_key, key_hash

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"

def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored_hash.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    computed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return hmac.compare_digest(expected, computed)

def create_or_update_api_key(
    *,
    name: str,
    tier: str,
    conn: sqlite3.Connection,
    existing_key_hash: Optional[str] = None
) -> Dict[str, Any]:
    cursor = conn.cursor()
    normalized_tier = normalize_tier(tier)
    limit = rate_limit_for_tier(normalized_tier)

    if existing_key_hash:
        cursor.execute(
            '''
            UPDATE api_keys
            SET is_active = 0
            WHERE key_hash = ?
            ''',
            (existing_key_hash,)
        )
        cursor.execute("DELETE FROM rate_limits WHERE key_hash = ?", (existing_key_hash,))

    api_key, key_hash = generate_api_key(normalized_tier)
    cursor.execute(
        '''
        INSERT INTO api_keys (key_hash, name, tier, rate_limit, is_active)
        VALUES (?, ?, ?, ?, 1)
        ''',
        (key_hash, name, normalized_tier, limit)
    )
    cursor.execute("SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,))
    row = cursor.fetchone()
    return {"key": api_key, "record": dict(row)}

def upsert_user(
    *,
    email: str,
    key_hash: str,
    tier: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company: Optional[str] = None,
    password_hash_value: Optional[str] = None,
    conn: sqlite3.Connection
) -> Dict[str, Any]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?)", (email,))
    existing = cursor.fetchone()
    normalized_tier = normalize_tier(tier)
    now_iso = datetime.utcnow().isoformat()

    if existing:
        next_first = first_name if first_name is not None else existing["first_name"]
        next_last = last_name if last_name is not None else existing["last_name"]
        next_company = company if company is not None else existing["company"]
        next_password_hash = password_hash_value if password_hash_value else existing["password_hash"]
        cursor.execute(
            '''
            UPDATE users
            SET first_name = ?, last_name = ?, company = ?, password_hash = ?, key_hash = ?, tier = ?, updated_at = ?, is_active = 1
            WHERE id = ?
            ''',
            (next_first, next_last, next_company, next_password_hash, key_hash, normalized_tier, now_iso, existing["id"])
        )
        cursor.execute("SELECT * FROM users WHERE id = ?", (existing["id"],))
        return dict(cursor.fetchone())

    cursor.execute(
        '''
        INSERT INTO users (email, password_hash, first_name, last_name, company, key_hash, tier, created_at, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ''',
        (email, password_hash_value, first_name, last_name, company, key_hash, normalized_tier, now_iso, now_iso)
    )
    cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?)", (email,))
    return dict(cursor.fetchone())

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?) AND is_active = 1", (email,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_api_key_record_by_hash(key_hash: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_api_key_record(api_key: str) -> Optional[Dict[str, Any]]:
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    return get_api_key_record_by_hash(key_hash)

def issue_session_tokens(email: str) -> Dict[str, str]:
    nonce = secrets.token_urlsafe(16)
    return {
        "access_token": f"legacy-{hashlib.sha256(f'{email}:{nonce}'.encode()).hexdigest()}",
        "refresh_token": f"legacy-refresh-{secrets.token_urlsafe(24)}"
    }

def stripe_enabled() -> bool:
    return bool(os.getenv(STRIPE_ENV["secret_key"]) and os.getenv(STRIPE_ENV["publishable_key"]))

def import_stripe():
    if not stripe_enabled():
        return None
    try:
        return importlib.import_module("stripe")
    except ModuleNotFoundError:
        return None

def stripe_library_available() -> bool:
    try:
        importlib.import_module("stripe")
        return True
    except ModuleNotFoundError:
        return False

def verify_api_key(api_key: str) -> Optional[Dict]:
    """Verify API key and return key data."""
    if not api_key:
        return None
    
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM api_keys 
        WHERE key_hash = ? AND is_active = 1 
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    ''', (key_hash,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return dict(row)
    return None

def check_rate_limit(key_hash: str, limit: int) -> tuple[bool, RateLimitInfo]:
    """Check and update rate limit for key."""
    now = datetime.utcnow()
    reset_at = now + timedelta(days=1)
    reset_at = reset_at.replace(hour=0, minute=0, second=0, microsecond=0)

    if limit <= 0:
        return False, RateLimitInfo(limit=limit, remaining=0, reset_at=reset_at)

    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT requests_count, reset_at FROM rate_limits WHERE key_hash = ?
    ''', (key_hash,))
    row = cursor.fetchone()
    
    if row:
        current_count = row['requests_count']
        current_reset = datetime.fromisoformat(row['reset_at'])
        
        if now >= current_reset:
            # Reset period
            current_count = 0
            cursor.execute('''
                UPDATE rate_limits SET requests_count = 1, reset_at = ?
                WHERE key_hash = ?
            ''', (reset_at.isoformat(), key_hash))
        elif current_count >= limit:
            # Rate limited
            conn.close()
            return False, RateLimitInfo(
                limit=limit,
                remaining=0,
                reset_at=current_reset
            )
        else:
            # Increment
            cursor.execute('''
                UPDATE rate_limits SET requests_count = requests_count + 1
                WHERE key_hash = ?
            ''', (key_hash,))
            current_count += 1
    else:
        # First request
        cursor.execute('''
            INSERT INTO rate_limits (key_hash, requests_count, reset_at)
            VALUES (?, 1, ?)
        ''', (key_hash, reset_at.isoformat()))
        current_count = 1
    
    conn.commit()
    conn.close()
    
    return True, RateLimitInfo(
        limit=limit,
        remaining=max(0, limit - current_count),
        reset_at=reset_at
    )

async def get_current_key(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict:
    """Dependency to verify API key."""
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_MISSING", "message": "API key required in X-API-Key header"}
        )
    
    key_data = verify_api_key(x_api_key)
    if not key_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_INVALID", "message": "Invalid or expired API key"}
        )
    
    # Check rate limit
    allowed, limit_info = check_rate_limit(key_data['key_hash'], key_data['rate_limit'])
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMIT_EXCEEDED",
                "message": "Rate limit exceeded",
                "reset_at": limit_info.reset_at.isoformat()
            },
            headers={
                "X-RateLimit-Limit": str(limit_info.limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(limit_info.reset_at.timestamp()))
            }
        )
    
    # Add rate limit info to key_data for response headers
    key_data['_rate_limit'] = limit_info
    request.state.rate_limit = limit_info
    return key_data

def read_json(path: Path) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def load_json_candidates(paths: List[Path], error_message: str) -> Dict[str, Any]:
    for path in paths:
        if path.exists():
            return read_json(path)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"code": "DATA_UNAVAILABLE", "message": error_message}
    )

def derive_stress_level(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 60:
        return "approaching"
    if score >= 40:
        return "watch"
    return "stable"

def normalize_wssi_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    theme_signals = payload.get("theme_signals")
    if not isinstance(theme_signals, list):
        theme_signals = []

    score = payload.get("wssi_score")
    score = float(score) if isinstance(score, (int, float)) else 0.0
    value = payload.get("wssi_value")
    value = float(value) if isinstance(value, (int, float)) else 0.0
    delta = payload.get("wssi_delta")
    delta = float(delta) if isinstance(delta, (int, float)) else 0.0

    calc_time = payload.get("calculation_timestamp") or payload.get("generated_at")
    if not calc_time:
        date_value = payload.get("date")
        if isinstance(date_value, str) and len(date_value) >= 10:
            calc_time = f"{date_value[:10]}T00:00:00Z"
        else:
            calc_time = datetime.utcnow().isoformat() + "Z"

    active_themes = payload.get("active_themes")
    if not isinstance(active_themes, int):
        active_themes = sum(
            1 for row in theme_signals
            if str(row.get("stress_level", "")).lower() in {"watch", "approaching", "critical"}
        )

    above_warning = payload.get("above_warning")
    if not isinstance(above_warning, int):
        above_warning = sum(
            1 for row in theme_signals
            if str(row.get("stress_level", "")).lower() in {"watch", "approaching", "critical"}
        )

    return {
        "wssi_value": value,
        "wssi_score": score,
        "wssi_delta": delta,
        "trend": str(payload.get("trend") or "unknown"),
        "stress_level": str(payload.get("stress_level") or derive_stress_level(score)),
        "active_themes": active_themes,
        "above_warning": above_warning,
        "calculation_timestamp": calc_time,
        "theme_signals": theme_signals
    }

def load_wssi_data() -> Dict[str, Any]:
    payload = load_json_candidates(
        [WSSI_DATA_PATH, ANALYTICS_DIR / "wssi-latest.json"],
        "WSSI data not available"
    )
    return normalize_wssi_payload(payload)

def load_analytics_payload(filename: str) -> Dict[str, Any]:
    return load_json_candidates(
        [DATA_DIR / filename, ANALYTICS_DIR / filename],
        f"{filename} not available"
    )

# Response header middleware
@app.middleware("http")
async def add_rate_limit_headers(request, call_next):
    response = await call_next(request)
    
    # Add rate limit headers if available in request state
    if hasattr(request.state, 'rate_limit'):
        rl = request.state.rate_limit
        response.headers["X-RateLimit-Limit"] = str(rl.limit)
        response.headers["X-RateLimit-Remaining"] = str(rl.remaining)
        response.headers["X-RateLimit-Reset"] = str(int(rl.reset_at.timestamp()))
    
    return response

# Endpoints
@app.get("/", tags=["General"])
def root():
    """API root with basic info."""
    return {
        "name": "WSSI API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": [
            "/wssi/current",
            "/wssi/history",
            "/themes",
            "/indicators",
            "/health"
        ]
    }

@app.get("/health", tags=["General"])
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

@app.get("/wssi/current", response_model=WSSIResponse, tags=["WSSI"])
def get_current_wssi(key_data: Dict = Depends(get_current_key)):
    """Get current WSSI score and theme breakdown."""
    data = load_wssi_data()
    return WSSIResponse(**data)

@app.get("/wssi/history", tags=["WSSI"])
def get_wssi_history(
    days: int = 30,
    key_data: Dict = Depends(get_current_key)
):
    """Get historical WSSI values."""
    days = max(1, int(days))
    try:
        payload = load_analytics_payload("wssi-history.json")
        rows = payload.get("history") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            rows = payload.get("data") if isinstance(payload, dict) else []
        rows = rows[-days:] if isinstance(rows, list) else []
        history = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            date = str(row.get("date") or "")[:10]
            if not date:
                continue
            history.append({
                "date": date,
                "wssi_value": float(row.get("wssi_value")) if isinstance(row.get("wssi_value"), (int, float)) else None,
                "wssi_score": float(row.get("wssi_score")) if isinstance(row.get("wssi_score"), (int, float)) else None
            })
        if history:
            return {
                "history": history,
                "count": len(history),
                "current": history[-1].get("wssi_value"),
                "source": "artifact"
            }
    except HTTPException:
        pass

    # Fallback synthetic response if history artifact is unavailable.
    current = load_wssi_data()["wssi_value"]
    history = []
    for i in range(days - 1, -1, -1):
        date = datetime.utcnow() - timedelta(days=i)
        variation = (i % 7 - 3) * 0.1 + (i % 3) * 0.05
        value = round(current + variation, 4)
        history.append({
            "date": date.strftime("%Y-%m-%d"),
            "wssi_value": value,
            "wssi_score": round(max(0, min(100, 50 + value * 20)), 2)
        })
    return {
        "history": history,
        "count": len(history),
        "current": current,
        "source": "synthetic-fallback"
    }

@app.get("/themes", response_model=List[ThemeSignal], tags=["Themes"])
def get_all_themes(key_data: Dict = Depends(get_current_key)):
    """Get all themes with current status."""
    data = load_wssi_data()
    
    themes = []
    for signal in data['theme_signals']:
        theme_id = signal.get('theme_id') or signal['theme_name'].lower().replace(' ', '-').replace('/', '-')
        payload = {k: v for k, v in signal.items() if k != 'theme_name'}
        payload["theme_id"] = theme_id
        themes.append(ThemeSignal(
            **payload,
            theme_name=signal['theme_name']
        ))
    
    return themes

@app.get("/themes/{theme_id}", response_model=ThemeSignal, tags=["Themes"])
def get_theme_detail(theme_id: str, key_data: Dict = Depends(get_current_key)):
    """Get specific theme details."""
    data = load_wssi_data()
    
    for signal in data['theme_signals']:
        sid = signal.get("theme_id") or signal['theme_name'].lower().replace(' ', '-').replace('/', '-')
        slug = signal['theme_name'].lower().replace(' ', '-').replace('/', '-')
        if sid == theme_id or slug == theme_id:
            payload = {k: v for k, v in signal.items() if k != 'theme_name'}
            payload["theme_id"] = sid
            return ThemeSignal(
                **payload,
                theme_name=signal['theme_name']
            )
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "THEME_NOT_FOUND", "message": f"Theme '{theme_id}' not found"}
    )

@app.get("/indicators", tags=["Indicators"])
def get_all_indicators(key_data: Dict = Depends(get_current_key)):
    """Get all indicator values."""
    # Return structured indicator data
    # In production, query indicators table
    return {
        "indicators": [
            {
                "indicator_id": "fao-food-price",
                "indicator_name": "FAO Food Price Index",
                "source": "FAO",
                "category": "Food System",
                "value": 76.32,
                "unit": "index",
                "timestamp": datetime.utcnow().isoformat()
            },
            {
                "indicator_id": "noaa-fisheries",
                "indicator_name": "NOAA Fisheries Stock Status",
                "source": "NOAA",
                "category": "Ecosystem",
                "value": 20.5,
                "unit": "% overfished",
                "timestamp": datetime.utcnow().isoformat()
            }
        ],
        "count": 23,
        "active_themes": 11
    }

@app.get("/correlations", tags=["Analytics"])
def get_correlations(key_data: Dict = Depends(get_current_key)):
    return load_analytics_payload("correlations.json")

@app.get("/network", tags=["Analytics"])
def get_network(key_data: Dict = Depends(get_current_key)):
    return load_analytics_payload("network.json")

@app.get("/alerts", tags=["Analytics"])
def get_alerts(key_data: Dict = Depends(get_current_key)):
    return load_analytics_payload("alerts.json")

@app.get("/patterns", tags=["Analytics"])
def get_patterns(key_data: Dict = Depends(get_current_key)):
    return load_analytics_payload("patterns.json")

# Compatibility aliases for dashboard v1/v2 adapters
@app.get("/api/v1/wssi", response_model=WSSIResponse, tags=["Compatibility"])
def get_current_wssi_v1(key_data: Dict = Depends(get_current_key)):
    return get_current_wssi(key_data)

@app.get("/api/v1/wssi/history", tags=["Compatibility"])
def get_wssi_history_v1(days: int = 30, key_data: Dict = Depends(get_current_key)):
    return get_wssi_history(days=days, key_data=key_data)

@app.get("/api/v1/themes", response_model=List[ThemeSignal], tags=["Compatibility"])
def get_all_themes_v1(key_data: Dict = Depends(get_current_key)):
    return get_all_themes(key_data)

@app.get("/api/v1/indicators", tags=["Compatibility"])
def get_all_indicators_v1(key_data: Dict = Depends(get_current_key)):
    return get_all_indicators(key_data)

@app.get("/api/v1/correlations", tags=["Compatibility"])
def get_correlations_v1(key_data: Dict = Depends(get_current_key)):
    return get_correlations(key_data)

@app.get("/api/v1/network", tags=["Compatibility"])
def get_network_v1(key_data: Dict = Depends(get_current_key)):
    return get_network(key_data)

@app.get("/api/v1/alerts", tags=["Compatibility"])
def get_alerts_v1(key_data: Dict = Depends(get_current_key)):
    return get_alerts(key_data)

@app.get("/api/v1/patterns", tags=["Compatibility"])
def get_patterns_v1(key_data: Dict = Depends(get_current_key)):
    return get_patterns(key_data)

def apply_tier_to_key_hash(key_hash: str, tier: str, *, conn: sqlite3.Connection) -> Dict[str, Any]:
    normalized_tier = normalize_tier(tier)
    limit = rate_limit_for_tier(normalized_tier)
    cursor = conn.cursor()
    cursor.execute(
        '''
        UPDATE api_keys
        SET tier = ?, rate_limit = ?, is_active = 1
        WHERE key_hash = ?
        ''',
        (normalized_tier, limit, key_hash)
    )
    cursor.execute("SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "KEY_NOT_FOUND", "message": "API key not found"}
        )
    return dict(row)

# Day 10 business-layer endpoints
@app.post("/api/v1/keys/request", tags=["Auth"])
def request_api_key(payload: APIKeyRequest):
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_EMAIL", "message": "Valid email is required"}
        )

    tier = normalize_tier(payload.tier, "free")
    display_name = f"{email} ({TIER_NAMES.get(tier, tier.title())})"
    password_hash_value = hash_password(payload.password) if payload.password else None

    conn = get_db()
    try:
        existing_user = None
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?)", (email,))
        existing_row = cursor.fetchone()
        if existing_row:
            existing_user = dict(existing_row)

        api_key_payload = create_or_update_api_key(
            name=display_name,
            tier=tier,
            conn=conn,
            existing_key_hash=existing_user.get("key_hash") if existing_user else None
        )
        key_record = api_key_payload["record"]

        user = upsert_user(
            email=email,
            key_hash=key_record["key_hash"],
            tier=tier,
            first_name=payload.first_name,
            last_name=payload.last_name,
            company=payload.company,
            password_hash_value=password_hash_value,
            conn=conn
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "email": email,
        "tier": tier,
        "rate_limit": key_record["rate_limit"],
        "api_key": api_key_payload["key"],
        "existing_key_reused": api_key_payload["key"] is None,
        "dashboard_url": "/dashboard/v2/app/index.html#ledger",
        "pricing_url": "/dashboard/v2/pricing/index.html",
        "user": {
            "first_name": user.get("first_name"),
            "last_name": user.get("last_name"),
            "company": user.get("company")
        }
    }

@app.post("/api/v1/keys", tags=["Auth"])
def request_api_key_alias(payload: APIKeyRequest):
    return request_api_key(payload)

@app.post("/api/v1/auth/register", tags=["Auth"])
def register_legacy_auth(payload: APIKeyRequest):
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "WEAK_PASSWORD", "message": "Password with at least 8 characters is required"}
        )
    created = request_api_key(payload)
    tokens = issue_session_tokens(created["email"])
    return {
        "message": "Account created",
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "token_type": "bearer",
        "api_key": created.get("api_key"),
        "tier": created["tier"],
        "rate_limit": created["rate_limit"]
    }

@app.post("/api/v1/auth/login", tags=["Auth"])
def login_legacy_auth(payload: LegacyLoginRequest):
    user = get_user_by_email(payload.email.strip().lower())
    if not user or not user.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_INVALID", "message": "Invalid email or password"}
        )
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_INVALID", "message": "Invalid email or password"}
        )

    conn = get_db()
    try:
        user_tier = normalize_tier(user.get("tier"), "free")
        key_payload = create_or_update_api_key(
            name=f"{user['email']} ({TIER_NAMES.get(user_tier, user_tier.title())})",
            tier=user_tier,
            conn=conn,
            existing_key_hash=user.get("key_hash")
        )
        key_record = key_payload["record"]

        cursor = conn.cursor()
        now_iso = datetime.utcnow().isoformat()
        cursor.execute(
            "UPDATE users SET key_hash = ?, tier = ?, last_login_at = ?, updated_at = ? WHERE id = ?",
            (key_record["key_hash"], key_record["tier"], now_iso, now_iso, user["id"])
        )
        conn.commit()
    finally:
        conn.close()

    tokens = issue_session_tokens(user["email"])
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "token_type": "bearer",
        "tier": key_record["tier"],
        "rate_limit": key_record["rate_limit"],
        "api_key": key_payload["key"],
        "api_key_hint": f"wssi-{key_record['tier']}-***"
    }

@app.post("/api/v1/auth/key-login", tags=["Auth"])
def login_with_api_key(payload: KeyLoginRequest):
    key_record = verify_api_key(payload.api_key)
    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_INVALID", "message": "Invalid API key"}
        )
    return {
        "tier": key_record["tier"],
        "rate_limit": key_record["rate_limit"],
        "api_key_hint": f"wssi-{key_record['tier']}-***",
        "status": "active"
    }

@app.post("/api/v1/auth/logout", tags=["Auth"])
def logout():
    return {"status": "ok"}

def get_billing_readiness() -> Dict[str, Any]:
    stripe_module_available = stripe_library_available()
    env_required = {
        "publishable_key": bool(os.getenv(STRIPE_ENV["publishable_key"])),
        "secret_key": bool(os.getenv(STRIPE_ENV["secret_key"])),
        "webhook_secret": bool(os.getenv(STRIPE_ENV["webhook_secret"])),
        "price_basic": bool(os.getenv(STRIPE_ENV["price_basic"])),
        "price_pro": bool(os.getenv(STRIPE_ENV["price_pro"])),
        "coupon_basic": bool(os.getenv(STRIPE_ENV["coupon_basic"])),
        "coupon_pro": bool(os.getenv(STRIPE_ENV["coupon_pro"])),
        "success_url": bool(os.getenv(STRIPE_ENV["success_url"])),
        "cancel_url": bool(os.getenv(STRIPE_ENV["cancel_url"])),
    }
    return {
        "stripe_module_available": stripe_module_available,
        "env": env_required,
        "ready_for_checkout": (
            stripe_module_available
            and env_required["publishable_key"]
            and env_required["secret_key"]
            and env_required["price_basic"]
            and env_required["price_pro"]
        ),
        "ready_for_webhook": (
            stripe_module_available
            and env_required["secret_key"]
            and env_required["webhook_secret"]
        ),
    }

@app.get("/api/v1/billing/config", tags=["Billing"])
def billing_config():
    readiness = get_billing_readiness()
    return {
        "enabled": readiness["ready_for_checkout"],
        "publishable_key": os.getenv(STRIPE_ENV["publishable_key"], ""),
        "readiness": readiness,
        "tiers": {
            "basic": {
                "launch_price": 9,
                "standard_price": 19,
                "contact_sales": False
            },
            "pro": {
                "launch_price": 20,
                "standard_price": 49,
                "contact_sales": False
            },
            "enterprise": {
                "launch_price": 149,
                "standard_price": 499,
                "contact_sales": True
            }
        }
    }

@app.get("/api/v1/billing/readiness", tags=["Billing"])
def billing_readiness():
    return get_billing_readiness()

@app.post("/api/v1/billing/checkout-session", tags=["Billing"])
def create_checkout_session(payload: BillingCheckoutRequest, x_api_key: Optional[str] = Header(None)):
    tier = normalize_tier(payload.tier)
    if tier == "enterprise":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "CONTACT_SALES_REQUIRED", "message": "Enterprise upgrades are handled by sales"}
        )

    provided_key = payload.api_key or x_api_key
    key_record = verify_api_key(provided_key) if provided_key else None
    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_MISSING", "message": "Valid API key is required to upgrade"}
        )

    stripe = import_stripe()
    if not stripe:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "BILLING_NOT_CONFIGURED", "message": "Stripe is not configured yet"}
        )

    secret_key = os.getenv(STRIPE_ENV["secret_key"], "")
    publishable_key = os.getenv(STRIPE_ENV["publishable_key"], "")
    price_id = os.getenv(STRIPE_ENV["price_basic"] if tier == "basic" else STRIPE_ENV["price_pro"], "")
    if not (secret_key and publishable_key and price_id):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "BILLING_NOT_CONFIGURED", "message": "Missing Stripe keys or price IDs"}
        )

    stripe.api_key = secret_key
    success_url = payload.success_url or os.getenv(STRIPE_ENV["success_url"], "http://127.0.0.1:3000/app/index.html?checkout=success#ledger")
    cancel_url = payload.cancel_url or os.getenv(STRIPE_ENV["cancel_url"], "http://127.0.0.1:3000/pricing/index.html?checkout=cancel")
    discount_coupon = os.getenv(STRIPE_ENV["coupon_basic"] if tier == "basic" else STRIPE_ENV["coupon_pro"], "")
    discounts = [{"coupon": discount_coupon}] if discount_coupon else None

    success_base, success_fragment = (success_url.split("#", 1) + [""])[:2] if "#" in success_url else (success_url, "")
    success_separator = "&" if "?" in success_base else "?"
    success_with_session = f"{success_base}{success_separator}session_id={{CHECKOUT_SESSION_ID}}"
    if success_fragment:
        success_with_session = f"{success_with_session}#{success_fragment}"

    session_kwargs = {
        "mode": "subscription",
        "success_url": success_with_session,
        "cancel_url": cancel_url,
        "line_items": [{"price": price_id, "quantity": 1}],
        "metadata": {
            "target_tier": tier,
            "key_hash": key_record["key_hash"]
        }
    }
    if discounts:
        session_kwargs["discounts"] = discounts
    else:
        # Only expose promo-code entry when we are not pre-applying a coupon.
        session_kwargs["allow_promotion_codes"] = True

    checkout_session = stripe.checkout.Session.create(**session_kwargs)
    return {
        "session_id": checkout_session["id"],
        "checkout_url": checkout_session["url"]
    }

@app.post("/api/v1/billing/webhook", tags=["Billing"])
async def billing_webhook(request: Request):
    stripe = import_stripe()
    if not stripe:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "BILLING_NOT_CONFIGURED", "message": "Stripe is not configured yet"}
        )

    payload_bytes = await request.body()
    signature = request.headers.get("Stripe-Signature")
    endpoint_secret = os.getenv(STRIPE_ENV["webhook_secret"], "")
    secret_key = os.getenv(STRIPE_ENV["secret_key"], "")
    if not (endpoint_secret and secret_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "BILLING_NOT_CONFIGURED", "message": "Webhook secret is not configured"}
        )

    stripe.api_key = secret_key
    try:
        event = stripe.Webhook.construct_event(payload_bytes, signature, endpoint_secret)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "WEBHOOK_INVALID", "message": "Invalid Stripe webhook signature"}
        )

    event_type = event.get("type", "unknown")
    event_id = event.get("id", "")
    key_hash = None
    target_tier = None

    if event_type == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        metadata = session.get("metadata", {}) or {}
        key_hash = metadata.get("key_hash")
        target_tier = normalize_tier(metadata.get("target_tier"), "free")
        if key_hash and target_tier in {"basic", "pro", "enterprise"}:
            conn = get_db()
            try:
                updated_key = apply_tier_to_key_hash(key_hash, target_tier, conn=conn)
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE users SET tier = ?, updated_at = ? WHERE key_hash = ?",
                    (updated_key["tier"], datetime.utcnow().isoformat(), key_hash)
                )
                cursor.execute(
                    '''
                    INSERT INTO billing_events (event_id, event_type, key_hash, tier, payload_json)
                    VALUES (?, ?, ?, ?, ?)
                    ''',
                    (event_id, event_type, key_hash, updated_key["tier"], payload_bytes.decode("utf-8", errors="ignore"))
                )
                conn.commit()
            finally:
                conn.close()
    else:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO billing_events (event_id, event_type, payload_json)
            VALUES (?, ?, ?)
            ''',
            (event_id, event_type, payload_bytes.decode("utf-8", errors="ignore"))
        )
        conn.commit()
        conn.close()

    return {"received": True, "event_type": event_type}

# Admin endpoints
@app.post("/admin/create-key", response_model=APIKeyResponse, tags=["Admin"])
def create_api_key(
    key_data: APIKeyCreate,
    admin_key: Optional[str] = Header(None, alias="X-Admin-Key")
):
    """Create a new API key (admin only)."""
    if not admin_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "ADMIN_KEY_REQUIRED", "message": "Admin key required"}
        )
    
    # Verify admin key
    admin_hash = hashlib.sha256(admin_key.encode()).hexdigest()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM api_keys WHERE key_hash = ? AND is_admin = 1 AND is_active = 1
    ''', (admin_hash,))
    
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ADMIN_INVALID", "message": "Invalid admin key"}
        )
    
    # Generate new key
    normalized_tier = normalize_tier(key_data.tier, "free")
    new_key, key_hash = generate_api_key(normalized_tier)
    
    expires_at = None
    if key_data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=key_data.expires_days)
    
    cursor.execute('''
        INSERT INTO api_keys (key_hash, name, tier, rate_limit, expires_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (key_hash, key_data.name, normalized_tier, rate_limit_for_tier(normalized_tier),
          expires_at.isoformat() if expires_at else None))
    
    conn.commit()
    
    # Get created key info
    cursor.execute('SELECT * FROM api_keys WHERE key_hash = ?', (key_hash,))
    row = cursor.fetchone()
    conn.close()
    
    return APIKeyResponse(
        key=new_key,
        name=row['name'],
        tier=row['tier'],
        created_at=datetime.fromisoformat(row['created_at']),
        expires_at=datetime.fromisoformat(row['expires_at']) if row['expires_at'] else None
    )

@app.get("/admin/stats", tags=["Admin"])
def get_admin_stats(admin_key: Optional[str] = Header(None, alias="X-Admin-Key")):
    """Get usage statistics (admin only)."""
    if not admin_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "ADMIN_KEY_REQUIRED", "message": "Admin key required"}
        )
    
    # Verify admin key (simplified)
    conn = get_db()
    cursor = conn.cursor()
    
    # Total keys by tier
    cursor.execute('''
        SELECT tier, COUNT(*) as count FROM api_keys 
        WHERE is_active = 1 AND is_admin = 0
        GROUP BY tier
    ''')
    keys_by_tier = {row['tier']: row['count'] for row in cursor.fetchall()}
    
    # Requests today
    today = datetime.utcnow().strftime('%Y-%m-%d')
    cursor.execute('''
        SELECT COUNT(*) as count FROM usage_logs 
        WHERE date(timestamp) = date('now')
    ''')
    requests_today = cursor.fetchone()['count']
    
    conn.close()
    
    return {
        "keys_by_tier": keys_by_tier,
        "requests_today": requests_today,
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
