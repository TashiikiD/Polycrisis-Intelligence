from fastapi import FastAPI, HTTPException, Depends, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import sqlite3
import json
import os
import hashlib
import secrets
from pathlib import Path

# Database setup
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "wssi_api.db"
WSSI_DATA_PATH = DATA_DIR / "wssi-latest.json"

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
    stress_level: str
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
    conn = get_db()
    cursor = conn.cursor()
    
    now = datetime.utcnow()
    reset_at = now + timedelta(days=1)
    reset_at = reset_at.replace(hour=0, minute=0, second=0, microsecond=0)
    
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
        remaining=limit - current_count,
        reset_at=reset_at
    )

async def get_current_key(x_api_key: Optional[str] = Header(None)) -> Dict:
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
    return key_data

def load_wssi_data() -> Dict:
    """Load WSSI data from JSON file."""
    if not WSSI_DATA_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "DATA_UNAVAILABLE", "message": "WSSI data not available"}
        )
    
    with open(WSSI_DATA_PATH) as f:
        return json.load(f)

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
    
    # Add rate limit to response headers via middleware
    from fastapi import Request
    import inspect
    frame = inspect.currentframe()
    while frame:
        if 'request' in frame.f_locals:
            frame.f_locals['request'].state.rate_limit = key_data['_rate_limit']
            break
        frame = frame.f_back
    
    return WSSIResponse(**data)

@app.get("/wssi/history", tags=["WSSI"])
def get_wssi_history(
    days: int = 30,
    key_data: Dict = Depends(get_current_key)
):
    """Get historical WSSI values."""
    # For now, return synthetic history based on current value
    # In production, query historical database
    data = load_wssi_data()
    current = data['wssi_value']
    
    history = []
    for i in range(days, -1, -1):
        date = datetime.utcnow() - timedelta(days=i)
        # Simulate variation around current value
        variation = (i % 7 - 3) * 0.1 + (i % 3) * 0.05
        history.append({
            "date": date.strftime("%Y-%m-%d"),
            "wssi_value": round(current + variation, 4),
            "wssi_score": round(max(0, min(100, 50 + (current + variation) * 20)), 2)
        })
    
    return {
        "history": history,
        "count": len(history),
        "current": current
    }

@app.get("/themes", response_model=List[ThemeSignal], tags=["Themes"])
def get_all_themes(key_data: Dict = Depends(get_current_key)):
    """Get all themes with current status."""
    data = load_wssi_data()
    
    themes = []
    for signal in data['theme_signals']:
        theme_id = signal['theme_name'].lower().replace(' ', '-').replace('/', '-')
        themes.append(ThemeSignal(
            theme_id=theme_id,
            **{k: v for k, v in signal.items() if k != 'theme_name'},
            theme_name=signal['theme_name']
        ))
    
    return themes

@app.get("/themes/{theme_id}", response_model=ThemeSignal, tags=["Themes"])
def get_theme_detail(theme_id: str, key_data: Dict = Depends(get_current_key)):
    """Get specific theme details."""
    data = load_wssi_data()
    
    for signal in data['theme_signals']:
        sid = signal['theme_name'].lower().replace(' ', '-').replace('/', '-')
        if sid == theme_id:
            return ThemeSignal(
                theme_id=theme_id,
                **{k: v for k, v in signal.items() if k != 'theme_name'},
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
    new_key = "wssi-" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(new_key.encode()).hexdigest()
    
    # Set rate limit based on tier
    tier_limits = {
        'free': 100,
        'basic': 10000,
        'pro': 100000,
        'enterprise': 999999999
    }
    
    expires_at = None
    if key_data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=key_data.expires_days)
    
    cursor.execute('''
        INSERT INTO api_keys (key_hash, name, tier, rate_limit, expires_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (key_hash, key_data.name, key_data.tier, tier_limits.get(key_data.tier, 100),
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
