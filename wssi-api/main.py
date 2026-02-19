from fastapi import FastAPI, HTTPException, Depends, Header, status, Request, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
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
from html import escape as html_escape
from pathlib import Path

def resolve_analytics_dir() -> Path:
    """Resolve analytics artifacts directory across local and hosted layouts."""
    override = os.getenv("WSSI_ANALYTICS_DIR")
    if override:
        return Path(override).expanduser().resolve()

    app_dir = Path(__file__).resolve().parent
    candidates: List[Path] = [app_dir / "output" / "analytics", Path.cwd() / "output" / "analytics"]
    for parent in app_dir.parents:
        candidates.append(parent / "output" / "analytics")

    seen = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate

    # Fall back to a sane default path without assuming parent depth.
    return app_dir / "output" / "analytics"

# Database setup
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "wssi_api.db"
WSSI_DATA_PATH = DATA_DIR / "wssi-latest.json"
ANALYTICS_DIR = resolve_analytics_dir()
BRIEF_ARCHIVE_ROOT = DATA_DIR / "brief_archive"
BRIEF_RELEASES_ROOT = BRIEF_ARCHIVE_ROOT / "releases"

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
PAID_TIERS = {"basic", "pro", "enterprise"}

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

    # Fragility Brief server-side archive metadata
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS brief_releases (
            release_id TEXT PRIMARY KEY,
            release_date TEXT NOT NULL,
            published_at TEXT NOT NULL,
            title TEXT NOT NULL,
            tier_variants TEXT NOT NULL,
            wssi_score REAL,
            wssi_value REAL,
            summary_json TEXT NOT NULL,
            free_html_path TEXT NOT NULL,
            paid_html_path TEXT NOT NULL,
            free_json_path TEXT NOT NULL,
            paid_json_path TEXT NOT NULL,
            created_by TEXT,
            notes TEXT
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
        show_admin_key = os.getenv("WSSI_PRINT_BOOTSTRAP_ADMIN_KEY", "0") == "1"
        if show_admin_key:
            print(f"Created default admin key: {admin_key}")
            print("SAVE THIS KEY - it will not be shown again!")
        else:
            masked = f"{admin_key[:14]}...{admin_key[-6:]}"
            print(f"Created default admin key (masked): {masked}")
            print("Set WSSI_PRINT_BOOTSTRAP_ADMIN_KEY=1 only for one-time secure capture.")
    
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

class BriefPublishRequest(BaseModel):
    release_date: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None

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

def is_paid_tier(tier: Optional[str]) -> bool:
    return normalize_tier(tier, "free") in PAID_TIERS

def iso_utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"

def normalize_release_date(value: Optional[str] = None) -> str:
    if value:
        text = str(value).strip()
        try:
            return datetime.strptime(text, "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "INVALID_RELEASE_DATE", "message": "release_date must use YYYY-MM-DD format"}
            )
    return datetime.utcnow().strftime("%Y-%m-%d")

def relative_to_data_dir(path: Path) -> str:
    return str(path.relative_to(DATA_DIR)).replace("\\", "/")

def resolve_data_relative_path(raw_path: str) -> Path:
    safe = Path(str(raw_path).strip())
    resolved = (DATA_DIR / safe).resolve()
    data_root = DATA_DIR.resolve()
    if not str(resolved).startswith(str(data_root)):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "ARCHIVE_PATH_INVALID", "message": "Stored archive path is outside data directory"}
        )
    return resolved

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

async def get_optional_key_for_archive(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Resolve archive viewer tier without enforcing daily rate limits."""
    if not x_api_key:
        request.state.archive_tier = "free"
        return {
            "tier": "free",
            "is_paid": False,
            "authenticated": False
        }
    key_data = verify_api_key(x_api_key)
    if not key_data:
        request.state.archive_tier = "free"
        return {
            "tier": "free",
            "is_paid": False,
            "authenticated": False
        }
    tier = normalize_tier(key_data.get("tier"), "free")
    request.state.archive_tier = tier
    return {
        "tier": tier,
        "is_paid": is_paid_tier(tier),
        "authenticated": True,
        "key_hash": key_data.get("key_hash")
    }

def require_brief_publish_token(x_brief_publish_token: Optional[str] = Header(None, alias="X-Brief-Publish-Token")) -> Dict[str, str]:
    configured = os.getenv("WSSI_BRIEF_PUBLISH_TOKEN", "").strip()
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "BRIEF_ARCHIVE_NOT_CONFIGURED", "message": "Brief archive publish token is not configured"}
        )
    if not x_brief_publish_token or not hmac.compare_digest(configured, x_brief_publish_token.strip()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "PUBLISH_TOKEN_INVALID", "message": "Invalid brief publish token"}
        )
    return {"token_valid": "yes"}

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

def to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def stress_rank(level: Any) -> int:
    text = str(level or "").strip().lower()
    mapping = {"unknown": 0, "stable": 1, "watch": 2, "approaching": 3, "critical": 4}
    return mapping.get(text, 0)

def normalize_stress_level(raw: Any, z_score: Optional[float]) -> str:
    text = str(raw or "").strip().lower()
    if text in {"stable", "watch", "approaching", "critical"}:
        return text
    if z_score is None:
        return "unknown"
    abs_z = abs(z_score)
    if abs_z >= 3:
        return "critical"
    if abs_z >= 2:
        return "approaching"
    if abs_z >= 1:
        return "watch"
    return "stable"

def collect_theme_rows(wssi_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    signals = wssi_payload.get("theme_signals") if isinstance(wssi_payload, dict) else []
    if not isinstance(signals, list):
        return rows
    for signal in signals:
        if not isinstance(signal, dict):
            continue
        theme_id = str(signal.get("theme_id") or signal.get("id") or "")
        theme_name = str(signal.get("theme_name") or signal.get("name") or theme_id or "Unknown Theme")
        category = str(signal.get("category") or signal.get("domain") or "Uncategorized")
        z_score = (
            to_float(signal.get("mean_z_score"))
            if signal.get("mean_z_score") is not None
            else (
                to_float(signal.get("z_score"))
                if signal.get("z_score") is not None
                else to_float(signal.get("normalized_value"))
            )
        )
        stress_level = normalize_stress_level(signal.get("stress_level"), z_score)
        rows.append(
            {
                "theme_id": theme_id,
                "theme_name": theme_name,
                "category": category,
                "stress_level": stress_level,
                "z_score": z_score,
                "trend_label": (
                    f"{to_float(signal.get('momentum_30d')):+.2f} (30d)"
                    if to_float(signal.get("momentum_30d")) is not None
                    else "No 30d momentum"
                ),
                "freshness": str(signal.get("data_freshness") or signal.get("freshness") or "unknown"),
                "indicator_details": signal.get("indicator_details") if isinstance(signal.get("indicator_details"), list) else []
            }
        )
    rows.sort(
        key=lambda row: (
            -stress_rank(row.get("stress_level")),
            -(abs(row.get("z_score")) if isinstance(row.get("z_score"), (int, float)) else -1),
            row.get("theme_name", "")
        )
    )
    return rows

def summarize_alert_rows(alerts_payload: Dict[str, Any]) -> Dict[str, Any]:
    active = alerts_payload.get("active_alerts") if isinstance(alerts_payload, dict) else []
    recent = alerts_payload.get("recent_alerts") if isinstance(alerts_payload, dict) else []
    if not isinstance(active, list):
        active = []
    if not isinstance(recent, list):
        recent = []
    merged = []
    for bucket, items in [("active", active), ("recent", recent)]:
        for item in items:
            if not isinstance(item, dict):
                continue
            merged.append(
                {
                    "alert_id": str(item.get("alert_id") or item.get("id") or "unknown"),
                    "title": str(item.get("title") or item.get("message") or "Alert"),
                    "severity": str(item.get("severity") or item.get("level") or "unknown").lower(),
                    "status": str(item.get("status") or ("active" if bucket == "active" else "resolved")).lower(),
                    "created_at": str(item.get("created_at") or item.get("timestamp") or ""),
                    "theme_ids": item.get("theme_ids") if isinstance(item.get("theme_ids"), list) else []
                }
            )
    merged.sort(key=lambda row: row.get("created_at", ""), reverse=True)
    counts = {"critical": 0, "warning": 0, "info": 0, "unknown": 0}
    for row in merged:
        severity = row.get("severity")
        if severity in counts:
            counts[severity] += 1
        else:
            counts["unknown"] += 1
    return {"rows": merged, "counts": counts}

def extract_strong_correlations(correlation_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload = correlation_payload if isinstance(correlation_payload, dict) else {}
    strong_threshold = to_float(payload.get("strong_threshold")) or to_float(payload.get("theme_level", {}).get("strong_threshold")) or 0.6
    pairs = payload.get("pairs")
    if not isinstance(pairs, list):
        pairs = payload.get("theme_level", {}).get("pairs", [])
    if not isinstance(pairs, list):
        pairs = []
    strong = []
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        left = str(pair.get("theme_a") or pair.get("row_theme_id") or pair.get("themeA") or "")
        right = str(pair.get("theme_b") or pair.get("col_theme_id") or pair.get("themeB") or "")
        r_value = to_float(pair.get("pearson_r") if pair.get("pearson_r") is not None else pair.get("r"))
        if not left or not right or r_value is None:
            continue
        if abs(r_value) < strong_threshold:
            continue
        strong.append(
            {
                "pair_label": f"{left} vs {right}",
                "pearson_r": r_value,
                "p_value": to_float(pair.get("p_value") if pair.get("p_value") is not None else pair.get("p")),
                "sample_n": to_float(pair.get("sample_n") if pair.get("sample_n") is not None else pair.get("n"))
            }
        )
    strong.sort(key=lambda row: abs(row.get("pearson_r") or 0), reverse=True)
    return strong

def extract_network_highlights(network_payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    payload = network_payload if isinstance(network_payload, dict) else {}
    nodes = payload.get("nodes") if isinstance(payload.get("nodes"), list) else []
    edges = payload.get("edges") if isinstance(payload.get("edges"), list) else []
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}

    top_nodes = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "")
        metric = metrics.get(node_id) if isinstance(metrics.get(node_id), dict) else {}
        size_score = to_float(metric.get("degree_total")) or to_float(metric.get("pagerank")) or 1.0
        top_nodes.append(
            {
                "node_id": node_id,
                "label": str(node.get("label") or node_id or "Node"),
                "category": str(node.get("category") or "Unknown"),
                "stress_level": str(node.get("stress_level") or "unknown"),
                "size_score": size_score
            }
        )
    top_nodes.sort(key=lambda row: row.get("size_score", 0), reverse=True)

    top_edges = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        top_edges.append(
            {
                "edge_id": str(edge.get("id") or ""),
                "source_id": str(edge.get("source") or edge.get("sourceId") or ""),
                "target_id": str(edge.get("target") or edge.get("targetId") or ""),
                "weight": to_float(edge.get("weight")) or 0.0,
                "evidence": str(edge.get("evidence") or "unknown")
            }
        )
    top_edges.sort(key=lambda row: row.get("weight", 0), reverse=True)
    return {"nodes": top_nodes, "edges": top_edges}

def extract_pattern_highlights(pattern_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload = pattern_payload if isinstance(pattern_payload, dict) else {}
    matches = payload.get("matches")
    if not isinstance(matches, list) and isinstance(payload.get("data"), dict):
        matches = payload.get("data", {}).get("matches")
    if not isinstance(matches, list):
        matches = []
    rows = []
    for item in matches:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "episode_id": str(item.get("episode_id") or item.get("episodeId") or ""),
                "label": str(item.get("label") or "Unknown episode"),
                "period": str(item.get("period") or ""),
                "similarity_pct": to_float(item.get("similarity_pct") if item.get("similarity_pct") is not None else item.get("similarityPct")),
                "confidence_tier": str(item.get("confidence_tier") or item.get("confidenceTier") or "unknown")
            }
        )
    rows.sort(key=lambda row: row.get("similarity_pct") or 0, reverse=True)
    return rows

def derive_timeline_trend(history_payload: Dict[str, Any]) -> str:
    rows = history_payload.get("history") if isinstance(history_payload, dict) else []
    if not isinstance(rows, list):
        rows = history_payload.get("data") if isinstance(history_payload, dict) else []
    if not isinstance(rows, list):
        rows = []
    scored = [to_float(item.get("wssi_score") if isinstance(item, dict) else None) for item in rows]
    scored = [value for value in scored if value is not None]
    if len(scored) < 2:
        return "insufficient history"
    delta = round(scored[-1] - scored[-2], 2)
    if delta > 0:
        return f"up +{delta:.2f}"
    if delta < 0:
        return f"down {delta:.2f}"
    return "flat 0.00"

def build_brief_archive_model() -> Dict[str, Any]:
    snapshot = load_wssi_data()
    correlations = load_analytics_payload("correlations.json")
    alerts = load_analytics_payload("alerts.json")
    network = load_analytics_payload("network.json")
    patterns = load_analytics_payload("patterns.json")
    timeline = load_analytics_payload("wssi-history.json")

    theme_rows = collect_theme_rows(snapshot)
    alert_data = summarize_alert_rows(alerts)
    strong_pairs = extract_strong_correlations(correlations)
    network_highlights = extract_network_highlights(network)
    pattern_rows = extract_pattern_highlights(patterns)

    return {
        "generated_at": iso_utc_now(),
        "brand_title": "The Fragility Brief",
        "wssi_summary": {
            "wssi_value": snapshot.get("wssi_value"),
            "wssi_score": snapshot.get("wssi_score"),
            "stress_level": snapshot.get("stress_level"),
            "active_themes": len(theme_rows),
            "above_warning_count": snapshot.get("above_warning"),
            "trend_label": derive_timeline_trend(timeline),
            "calculation_timestamp": snapshot.get("calculation_timestamp")
        },
        "top_themes": theme_rows,
        "alerts": {
            "counts": alert_data.get("counts", {}),
            "latest_rows": alert_data.get("rows", [])
        },
        "correlations": strong_pairs,
        "network": network_highlights,
        "patterns": pattern_rows,
        "indicator_appendix": [
            {
                "theme_id": row.get("theme_id"),
                "theme_name": row.get("theme_name"),
                "category": row.get("category"),
                "stress_level": row.get("stress_level"),
                "z_score": row.get("z_score"),
                "indicator_details": row.get("indicator_details", [])
            }
            for row in theme_rows
        ],
        "source_labels": {
            "snapshot": "wssi-latest",
            "correlations": "correlations",
            "alerts": "alerts",
            "network": "network",
            "patterns": "patterns",
            "timeline": "wssi-history"
        },
        "disclaimer": "Historical analogs are structural similarity, not prediction."
    }

def apply_brief_variant(model: Dict[str, Any], variant: str) -> Dict[str, Any]:
    if variant == "paid":
        paid_model = json.loads(json.dumps(model))
        paid_model["tier_context"] = {"tier": "paid", "is_paid": True, "report_depth": "full"}
        return paid_model

    free_model = json.loads(json.dumps(model))
    free_model["top_themes"] = free_model.get("top_themes", [])[:5]
    free_model["alerts"]["latest_rows"] = free_model.get("alerts", {}).get("latest_rows", [])[:3]
    free_model["correlations"] = free_model.get("correlations", [])[:1]
    free_model["network"]["nodes"] = free_model.get("network", {}).get("nodes", [])[:3]
    free_model["network"]["edges"] = free_model.get("network", {}).get("edges", [])[:2]
    free_model["patterns"] = free_model.get("patterns", [])[:1]
    free_model["indicator_appendix"] = free_model.get("indicator_appendix", [])[:1]
    if free_model["indicator_appendix"]:
        free_model["indicator_appendix"][0]["indicator_details"] = free_model["indicator_appendix"][0].get("indicator_details", [])[:2]
    free_model["tier_context"] = {
        "tier": "free",
        "is_paid": False,
        "report_depth": "limited",
        "hidden_sections": ["full-correlations", "full-network", "full-patterns", "full-indicator-appendix"],
        "upgrade_message": "Upgrade required for full archive detail."
    }
    return free_model

def format_num(value: Any, digits: int = 2) -> str:
    n = to_float(value)
    if n is None:
        return "N/A"
    return f"{n:.{digits}f}"

def render_brief_archive_html(model: Dict[str, Any], variant: str) -> str:
    summary = model.get("wssi_summary", {})
    alerts = model.get("alerts", {})
    counts = alerts.get("counts", {})
    top_themes = model.get("top_themes", [])
    latest_alerts = alerts.get("latest_rows", [])
    correlations = model.get("correlations", [])
    network_nodes = model.get("network", {}).get("nodes", [])
    network_edges = model.get("network", {}).get("edges", [])
    patterns = model.get("patterns", [])
    appendix = model.get("indicator_appendix", [])
    tier_label = "Paid" if variant == "paid" else "Free"
    locked_note = ""
    if variant == "free":
        locked_note = '<p class="upgrade-note">Upgrade required for full report sections and complete appendix.</p>'

    def table_rows(items: List[Dict[str, Any]], cols: List[str]) -> str:
        if not items:
            return '<tr><td colspan="6">No rows available.</td></tr>'
        cells = []
        for item in items:
            row_cells = "".join(f"<td>{html_escape(str(item.get(col, 'N/A')))}</td>" for col in cols)
            cells.append(f"<tr>{row_cells}</tr>")
        return "".join(cells)

    theme_rows = table_rows(
        [
            {
                "theme_name": row.get("theme_name"),
                "category": row.get("category"),
                "stress_level": row.get("stress_level"),
                "z_score": format_num(row.get("z_score"), 2),
                "trend": row.get("trend_label"),
                "freshness": row.get("freshness")
            }
            for row in top_themes
        ],
        ["theme_name", "category", "stress_level", "z_score", "trend", "freshness"]
    )

    alert_rows = table_rows(
        [
            {
                "title": row.get("title"),
                "severity": row.get("severity"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "themes": ", ".join(row.get("theme_ids", [])) if isinstance(row.get("theme_ids"), list) else ""
            }
            for row in latest_alerts
        ],
        ["title", "severity", "status", "created_at", "themes"]
    )

    corr_rows = table_rows(
        [
            {
                "pair": row.get("pair_label"),
                "r": format_num(row.get("pearson_r"), 3),
                "p": format_num(row.get("p_value"), 4),
                "n": format_num(row.get("sample_n"), 0)
            }
            for row in correlations
        ],
        ["pair", "r", "p", "n"]
    )

    node_rows = table_rows(
        [
            {
                "label": row.get("label"),
                "category": row.get("category"),
                "stress": row.get("stress_level"),
                "size": format_num(row.get("size_score"), 2)
            }
            for row in network_nodes
        ],
        ["label", "category", "stress", "size"]
    )

    edge_rows = table_rows(
        [
            {
                "edge": f"{row.get('source_id')} -> {row.get('target_id')}",
                "weight": format_num(row.get("weight"), 2),
                "evidence": row.get("evidence")
            }
            for row in network_edges
        ],
        ["edge", "weight", "evidence"]
    )

    pattern_rows = table_rows(
        [
            {
                "episode": row.get("label"),
                "period": row.get("period"),
                "similarity": f"{format_num(row.get('similarity_pct'), 1)}%",
                "confidence": row.get("confidence_tier")
            }
            for row in patterns
        ],
        ["episode", "period", "similarity", "confidence"]
    )

    appendix_rows = table_rows(
        [
            {
                "theme": row.get("theme_name"),
                "category": row.get("category"),
                "stress": row.get("stress_level"),
                "z": format_num(row.get("z_score"), 2),
                "indicator_count": len(row.get("indicator_details", []))
            }
            for row in appendix
        ],
        ["theme", "category", "stress", "z", "indicator_count"]
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Fragility Brief ({tier_label})</title>
    <style>
        body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: #f5f8fc; color: #152133; }}
        main {{ max-width: 1080px; margin: 0 auto; padding: 20px; }}
        header {{ border-bottom: 2px solid #d6e0ef; margin-bottom: 16px; padding-bottom: 12px; }}
        h1 {{ margin: 0; }}
        .meta {{ color: #425979; font-size: 0.9rem; }}
        .badge {{ display: inline-block; padding: 2px 10px; border-radius: 999px; border: 1px solid #9ab0cd; background: #edf3fc; font-size: 0.75rem; }}
        section {{ background: #fff; border: 1px solid #d9e3f0; border-radius: 10px; padding: 12px; margin-bottom: 12px; }}
        table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; }}
        th, td {{ border-bottom: 1px solid #e3eaf4; text-align: left; padding: 6px; }}
        th {{ text-transform: uppercase; color: #4b5d75; font-size: 0.72rem; }}
        .kpi-grid {{ display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }}
        .kpi {{ border: 1px solid #dbe4ef; border-radius: 8px; padding: 8px; background: #f8fbff; }}
        .kpi .label {{ color: #4f6179; font-size: 0.75rem; text-transform: uppercase; }}
        .kpi .value {{ font-size: 1.2rem; font-weight: 700; }}
        .upgrade-note {{ color: #865102; background: #fff4df; border: 1px solid #e8c589; border-radius: 8px; padding: 8px; }}
        footer {{ color: #49607e; font-size: 0.8rem; border-top: 1px solid #d6e0ef; padding-top: 10px; margin-top: 10px; }}
    </style>
</head>
<body>
<main>
    <header>
        <h1>{html_escape(str(model.get("brand_title") or "The Fragility Brief"))}</h1>
        <p class="meta">Generated {html_escape(str(model.get("generated_at") or ""))} · <span class="badge">{tier_label} Archive Variant</span></p>
    </header>
    <section>
        <h2>Executive Snapshot</h2>
        <div class="kpi-grid">
            <article class="kpi"><div class="label">WSSI Value</div><div class="value">{format_num(summary.get("wssi_value"), 2)}</div></article>
            <article class="kpi"><div class="label">WSSI Score</div><div class="value">{format_num(summary.get("wssi_score"), 1)}</div></article>
            <article class="kpi"><div class="label">Stress Level</div><div class="value">{html_escape(str(summary.get("stress_level") or "unknown"))}</div></article>
            <article class="kpi"><div class="label">Trend</div><div class="value">{html_escape(str(summary.get("trend_label") or "unknown"))}</div></article>
        </div>
        <p class="meta">Active themes: {html_escape(str(summary.get("active_themes") or 0))} · Above warning: {html_escape(str(summary.get("above_warning_count") or 0))}</p>
    </section>
    <section>
        <h2>Stress Overview</h2>
        <table><thead><tr><th>Theme</th><th>Category</th><th>Stress</th><th>z</th><th>Trend</th><th>Freshness</th></tr></thead><tbody>{theme_rows}</tbody></table>
    </section>
    <section>
        <h2>Alerts Overview</h2>
        <p class="meta">Critical: {counts.get("critical", 0)} · Warning: {counts.get("warning", 0)} · Info: {counts.get("info", 0)}</p>
        <table><thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Created</th><th>Themes</th></tr></thead><tbody>{alert_rows}</tbody></table>
    </section>
    <section>
        <h2>Correlation Highlights</h2>
        <table><thead><tr><th>Pair</th><th>r</th><th>p</th><th>n</th></tr></thead><tbody>{corr_rows}</tbody></table>
    </section>
    <section>
        <h2>Network Highlights</h2>
        <h3>Top Nodes</h3>
        <table><thead><tr><th>Node</th><th>Category</th><th>Stress</th><th>Size</th></tr></thead><tbody>{node_rows}</tbody></table>
        <h3>Top Edges</h3>
        <table><thead><tr><th>Connection</th><th>Weight</th><th>Evidence</th></tr></thead><tbody>{edge_rows}</tbody></table>
    </section>
    <section>
        <h2>Pattern Highlights</h2>
        <table><thead><tr><th>Episode</th><th>Period</th><th>Similarity</th><th>Confidence</th></tr></thead><tbody>{pattern_rows}</tbody></table>
    </section>
    <section>
        <h2>Indicator Appendix</h2>
        <table><thead><tr><th>Theme</th><th>Category</th><th>Stress</th><th>z</th><th>Indicators</th></tr></thead><tbody>{appendix_rows}</tbody></table>
        {locked_note}
    </section>
    <footer>
        <p>{html_escape(str(model.get("disclaimer") or "Historical analogs are structural similarity, not prediction."))}</p>
        <p>Sources: snapshot, alerts, correlations, network, patterns, timeline.</p>
    </footer>
</main>
</body>
</html>"""

def max_archive_releases() -> int:
    raw = os.getenv("WSSI_BRIEF_ARCHIVE_MAX_RELEASES", "200").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 200
    return max(10, min(value, 2000))

def archive_links_for_release(release_id: str, is_paid: bool) -> Dict[str, Any]:
    links = {
        "free": {
            "view_url": f"/api/v1/briefs/releases/{release_id}/view?variant=free",
            "model_url": f"/api/v1/briefs/releases/{release_id}/model?variant=free"
        },
        "paid": None
    }
    if is_paid:
        links["paid"] = {
            "view_url": f"/api/v1/briefs/releases/{release_id}/view?variant=paid",
            "model_url": f"/api/v1/briefs/releases/{release_id}/model?variant=paid"
        }
    return links

def serialize_release_row(row: sqlite3.Row, is_paid: bool) -> Dict[str, Any]:
    summary = {}
    try:
        summary = json.loads(row["summary_json"])
    except Exception:
        summary = {}
    return {
        "release_id": row["release_id"],
        "release_date": row["release_date"],
        "published_at": row["published_at"],
        "title": row["title"],
        "wssi_score": row["wssi_score"],
        "wssi_value": row["wssi_value"],
        "summary": summary,
        "created_by": row["created_by"],
        "notes": row["notes"],
        "tier_variants": json.loads(row["tier_variants"]) if row["tier_variants"] else ["free", "paid"],
        "links": archive_links_for_release(row["release_id"], is_paid),
        "locked_paid": not is_paid
    }

def enforce_archive_retention(conn: sqlite3.Connection) -> None:
    keep = max_archive_releases()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT release_id, free_html_path, paid_html_path, free_json_path, paid_json_path
        FROM brief_releases
        ORDER BY published_at DESC
        """
    )
    rows = cursor.fetchall()
    stale_rows = rows[keep:]
    for row in stale_rows:
        for column in ["free_html_path", "paid_html_path", "free_json_path", "paid_json_path"]:
            raw_path = row[column]
            if not raw_path:
                continue
            path = resolve_data_relative_path(raw_path)
            if path.exists():
                path.unlink()
        release_dir = BRIEF_RELEASES_ROOT / row["release_id"]
        if release_dir.exists() and release_dir.is_dir():
            for item in release_dir.glob("*"):
                if item.is_file():
                    item.unlink()
            try:
                release_dir.rmdir()
            except OSError:
                pass
        cursor.execute("DELETE FROM brief_releases WHERE release_id = ?", (row["release_id"],))


def normalize_archive_variant(raw_variant: str) -> str:
    variant = str(raw_variant or "free").strip().lower()
    if variant not in {"free", "paid"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_VARIANT", "message": "variant must be one of: free, paid"}
        )
    return variant

def require_paid_archive_variant(viewer_ctx: Dict[str, Any]) -> None:
    if viewer_ctx.get("is_paid"):
        return
    if viewer_ctx.get("authenticated"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "UPGRADE_REQUIRED", "message": "Paid tier required for this archive variant"}
        )
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={"code": "UPGRADE_REQUIRED", "message": "Paid tier required for this archive variant"}
    )

def generate_brief_release_id(release_date: str) -> str:
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    suffix = secrets.token_hex(2)
    return f"brief-{release_date.replace('-', '')}-{stamp}-{suffix}"

def write_json_file(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2)

def write_text_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)

def fetch_release_row_by_id(conn: sqlite3.Connection, release_id: str) -> Optional[sqlite3.Row]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM brief_releases WHERE release_id = ?", (release_id,))
    return cursor.fetchone()

def release_variant_file_path(row: sqlite3.Row, variant: str, kind: str) -> Path:
    if variant not in {"free", "paid"}:
        raise ValueError(f"Unsupported variant '{variant}'")
    if kind not in {"html", "json"}:
        raise ValueError(f"Unsupported kind '{kind}'")
    column = f"{variant}_{kind}_path"
    raw_path = row[column]
    return resolve_data_relative_path(raw_path)

def build_release_summary(model: Dict[str, Any], free_model: Dict[str, Any], paid_model: Dict[str, Any]) -> Dict[str, Any]:
    wssi_summary = model.get("wssi_summary", {})
    alerts = model.get("alerts", {}).get("counts", {})
    return {
        "wssi_score": wssi_summary.get("wssi_score"),
        "wssi_value": wssi_summary.get("wssi_value"),
        "stress_level": wssi_summary.get("stress_level"),
        "trend_label": wssi_summary.get("trend_label"),
        "above_warning_count": wssi_summary.get("above_warning_count"),
        "alert_counts": alerts,
        "free_theme_count": len(free_model.get("top_themes", [])),
        "paid_theme_count": len(paid_model.get("top_themes", [])),
        "generated_at": model.get("generated_at")
    }

def persist_brief_release(
    release_id: str,
    release_date: str,
    published_at: str,
    title: str,
    free_model: Dict[str, Any],
    paid_model: Dict[str, Any],
    free_html: str,
    paid_html: str,
    created_by: Optional[str],
    notes: Optional[str]
) -> sqlite3.Row:
    release_dir = BRIEF_RELEASES_ROOT / release_id
    free_html_path = release_dir / "free.html"
    paid_html_path = release_dir / "paid.html"
    free_json_path = release_dir / "free.json"
    paid_json_path = release_dir / "paid.json"

    write_text_file(free_html_path, free_html)
    write_text_file(paid_html_path, paid_html)
    write_json_file(free_json_path, free_model)
    write_json_file(paid_json_path, paid_model)

    summary = build_release_summary(paid_model, free_model, paid_model)
    wssi_summary = paid_model.get("wssi_summary", {})

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO brief_releases (
                release_id, release_date, published_at, title, tier_variants,
                wssi_score, wssi_value, summary_json,
                free_html_path, paid_html_path, free_json_path, paid_json_path,
                created_by, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                release_date = excluded.release_date,
                published_at = excluded.published_at,
                title = excluded.title,
                tier_variants = excluded.tier_variants,
                wssi_score = excluded.wssi_score,
                wssi_value = excluded.wssi_value,
                summary_json = excluded.summary_json,
                free_html_path = excluded.free_html_path,
                paid_html_path = excluded.paid_html_path,
                free_json_path = excluded.free_json_path,
                paid_json_path = excluded.paid_json_path,
                created_by = excluded.created_by,
                notes = excluded.notes
            """,
            (
                release_id,
                release_date,
                published_at,
                title,
                json.dumps(["free", "paid"]),
                to_float(wssi_summary.get("wssi_score")),
                to_float(wssi_summary.get("wssi_value")),
                json.dumps(summary),
                relative_to_data_dir(free_html_path),
                relative_to_data_dir(paid_html_path),
                relative_to_data_dir(free_json_path),
                relative_to_data_dir(paid_json_path),
                created_by,
                notes
            )
        )
        enforce_archive_retention(conn)
        conn.commit()
        row = fetch_release_row_by_id(conn, release_id)
        if not row:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "RELEASE_PERSIST_FAILED", "message": "Release persisted but could not be reloaded"}
            )
        return row
    finally:
        conn.close()

def get_release_row_or_404(release_id: str) -> sqlite3.Row:
    conn = get_db()
    try:
        row = fetch_release_row_by_id(conn, release_id)
    finally:
        conn.close()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "RELEASE_NOT_FOUND", "message": f"Release '{release_id}' was not found"}
        )
    return row


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

@app.post("/api/v1/briefs/releases/publish", tags=["Brief Archive"])
def publish_brief_release(
    payload: Optional[BriefPublishRequest] = Body(default=None),
    _token: Dict[str, str] = Depends(require_brief_publish_token)
):
    publish_payload = payload or BriefPublishRequest()
    release_date = normalize_release_date(publish_payload.release_date)
    release_id = generate_brief_release_id(release_date)
    title = f"The Fragility Brief ({release_date})"
    published_at = iso_utc_now()
    created_by = str(publish_payload.created_by or "script").strip() or "script"
    notes = str(publish_payload.notes).strip() if publish_payload and publish_payload.notes else None

    base_model = build_brief_archive_model()
    free_model = apply_brief_variant(base_model, "free")
    paid_model = apply_brief_variant(base_model, "paid")
    free_html = render_brief_archive_html(free_model, "free")
    paid_html = render_brief_archive_html(paid_model, "paid")

    row = persist_brief_release(
        release_id=release_id,
        release_date=release_date,
        published_at=published_at,
        title=title,
        free_model=free_model,
        paid_model=paid_model,
        free_html=free_html,
        paid_html=paid_html,
        created_by=created_by,
        notes=notes
    )
    release = serialize_release_row(row, is_paid=True)
    return {
        "status": "published",
        "release": release,
        "archive_page_url": "/dashboard/v2/archive/index.html",
        "variant_urls": release["links"]
    }

@app.get("/api/v1/briefs/releases", tags=["Brief Archive"])
def list_brief_releases(
    limit: int = 50,
    viewer_ctx: Dict[str, Any] = Depends(get_optional_key_for_archive)
):
    normalized_limit = max(1, min(int(limit), 200))
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM brief_releases
            ORDER BY published_at DESC
            LIMIT ?
            """,
            (normalized_limit,)
        )
        rows = cursor.fetchall()
    finally:
        conn.close()

    releases = [serialize_release_row(row, viewer_ctx.get("is_paid", False)) for row in rows]
    return {
        "releases": releases,
        "count": len(releases),
        "limit": normalized_limit,
        "viewer": {
            "tier": viewer_ctx.get("tier", "free"),
            "is_paid": bool(viewer_ctx.get("is_paid")),
            "authenticated": bool(viewer_ctx.get("authenticated"))
        }
    }

@app.get("/api/v1/briefs/releases/{release_id}", tags=["Brief Archive"])
def get_brief_release_detail(
    release_id: str,
    viewer_ctx: Dict[str, Any] = Depends(get_optional_key_for_archive)
):
    row = get_release_row_or_404(release_id)
    return {
        "release": serialize_release_row(row, viewer_ctx.get("is_paid", False)),
        "viewer": {
            "tier": viewer_ctx.get("tier", "free"),
            "is_paid": bool(viewer_ctx.get("is_paid")),
            "authenticated": bool(viewer_ctx.get("authenticated"))
        }
    }

@app.get("/api/v1/briefs/releases/{release_id}/view", tags=["Brief Archive"])
def view_brief_release_html(
    release_id: str,
    variant: str = "free",
    viewer_ctx: Dict[str, Any] = Depends(get_optional_key_for_archive)
):
    normalized_variant = normalize_archive_variant(variant)
    if normalized_variant == "paid":
        require_paid_archive_variant(viewer_ctx)

    row = get_release_row_or_404(release_id)
    file_path = release_variant_file_path(row, normalized_variant, "html")
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "RELEASE_ARTIFACT_MISSING", "message": "Release HTML artifact is missing"}
        )
    return Response(content=file_path.read_text(encoding="utf-8"), media_type="text/html")

@app.get("/api/v1/briefs/releases/{release_id}/model", tags=["Brief Archive"])
def get_brief_release_model(
    release_id: str,
    variant: str = "free",
    viewer_ctx: Dict[str, Any] = Depends(get_optional_key_for_archive)
):
    normalized_variant = normalize_archive_variant(variant)
    if normalized_variant == "paid":
        require_paid_archive_variant(viewer_ctx)

    row = get_release_row_or_404(release_id)
    file_path = release_variant_file_path(row, normalized_variant, "json")
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "RELEASE_ARTIFACT_MISSING", "message": "Release model artifact is missing"}
        )
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "RELEASE_MODEL_INVALID", "message": "Stored release model is not valid JSON"}
        )
    return JSONResponse(content=payload)

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
