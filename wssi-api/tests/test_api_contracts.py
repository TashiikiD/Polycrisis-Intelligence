import hashlib
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _load_main_module():
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location("wssi_api_main_for_tests", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def api_module():
    return _load_main_module()


@pytest.fixture(scope="session")
def client(api_module):
    with TestClient(api_module.app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def api_key(api_module):
    key = "pytest-day1to9-api-key"
    key_hash = hashlib.sha256(key.encode()).hexdigest()

    conn = api_module.get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO api_keys (key_hash, name, tier, rate_limit, is_active, is_admin)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (key_hash, "Pytest Contract Key", "enterprise", 999999, 1, 0),
    )
    conn.commit()
    conn.close()

    yield key

    conn = api_module.get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM rate_limits WHERE key_hash = ?", (key_hash,))
    cursor.execute("DELETE FROM usage_logs WHERE key_hash = ?", (key_hash,))
    cursor.execute("DELETE FROM api_keys WHERE key_hash = ?", (key_hash,))
    conn.commit()
    conn.close()


def _auth_headers(api_key: str):
    return {"X-API-Key": api_key}


def _canonical_json(value):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key in {"timestamp", "created_at", "updated_at"}:
                continue
            out[key] = _canonical_json(item)
        return out
    if isinstance(value, list):
        return [_canonical_json(item) for item in value]
    return value


def test_health_endpoint_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert "version" in payload


def test_root_endpoint_lists_core_routes(client):
    response = client.get("/")
    assert response.status_code == 200
    payload = response.json()
    endpoints = payload.get("endpoints")
    assert isinstance(endpoints, list)
    assert "/wssi/current" in endpoints
    assert "/wssi/history" in endpoints
    assert "/themes" in endpoints
    assert "/indicators" in endpoints


@pytest.mark.parametrize(
    "route",
    [
        "/wssi/current",
        "/wssi/history",
        "/themes",
        "/indicators",
        "/correlations",
        "/network",
        "/alerts",
        "/patterns",
        "/api/v1/wssi",
        "/api/v1/wssi/history",
        "/api/v1/themes",
        "/api/v1/indicators",
        "/api/v1/correlations",
        "/api/v1/network",
        "/api/v1/alerts",
        "/api/v1/patterns",
    ],
)
def test_protected_routes_require_api_key(client, route):
    response = client.get(route)
    assert response.status_code == 401
    detail = response.json().get("detail", {})
    assert detail.get("code") == "AUTH_MISSING"


def test_invalid_api_key_is_rejected(client):
    response = client.get("/wssi/current", headers={"X-API-Key": "invalid-key"})
    assert response.status_code == 401
    detail = response.json().get("detail", {})
    assert detail.get("code") == "AUTH_INVALID"


def test_current_wssi_contract(client, api_key):
    response = client.get("/wssi/current", headers=_auth_headers(api_key))
    assert response.status_code == 200
    payload = response.json()
    required_fields = {
        "wssi_value",
        "wssi_score",
        "wssi_delta",
        "trend",
        "stress_level",
        "active_themes",
        "above_warning",
        "calculation_timestamp",
        "theme_signals",
    }
    assert required_fields.issubset(set(payload.keys()))
    assert isinstance(payload["theme_signals"], list)
    assert len(payload["theme_signals"]) > 0


def test_history_days_parameter_respected(client, api_key):
    response = client.get("/wssi/history?days=7", headers=_auth_headers(api_key))
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("history"), list)
    assert payload.get("count") == 7


@pytest.mark.parametrize(
    "legacy,v1",
    [
        ("/wssi/current", "/api/v1/wssi"),
        ("/wssi/history?days=30", "/api/v1/wssi/history?days=30"),
        ("/themes", "/api/v1/themes"),
        ("/indicators", "/api/v1/indicators"),
        ("/correlations", "/api/v1/correlations"),
        ("/network", "/api/v1/network"),
        ("/alerts", "/api/v1/alerts"),
        ("/patterns", "/api/v1/patterns"),
    ],
)
def test_legacy_and_v1_routes_are_parity_compatible(client, api_key, legacy, v1):
    headers = _auth_headers(api_key)
    legacy_response = client.get(legacy, headers=headers)
    v1_response = client.get(v1, headers=headers)

    assert legacy_response.status_code == 200, legacy
    assert v1_response.status_code == 200, v1
    assert _canonical_json(legacy_response.json()) == _canonical_json(v1_response.json())


@pytest.mark.parametrize(
    "route,required_keys",
    [
        ("/correlations", {"generated_at", "theme_level"}),
        ("/network", {"generated_at", "nodes", "edges"}),
        ("/alerts", {"generated_at", "active_alerts", "recent_alerts"}),
        ("/patterns", {"generated_at", "matches"}),
    ],
)
def test_analytics_routes_have_expected_shape(client, api_key, route, required_keys):
    response = client.get(route, headers=_auth_headers(api_key))
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert required_keys.issubset(set(payload.keys()))


def test_admin_create_key_requires_admin_header(client):
    response = client.post(
        "/admin/create-key",
        json={"name": "No Admin", "tier": "free"},
    )
    assert response.status_code == 401
    detail = response.json().get("detail", {})
    assert detail.get("code") == "ADMIN_KEY_REQUIRED"


def test_day10_keys_request_returns_free_key_with_zero_limit(client):
    email = "pytest-day10-free@example.com"
    response = client.post(
        "/api/v1/keys/request",
        json={"email": email, "tier": "free"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["email"] == email
    assert payload["tier"] == "free"
    assert payload["rate_limit"] == 0
    assert isinstance(payload["api_key"], str)
    assert payload["api_key"].startswith("wssi-free-")


def test_day10_free_key_is_hard_limited(client):
    create_response = client.post(
        "/api/v1/keys/request",
        json={"email": "pytest-day10-limited@example.com", "tier": "free"},
    )
    assert create_response.status_code == 200
    api_key = create_response.json()["api_key"]

    response = client.get("/wssi/current", headers=_auth_headers(api_key))
    assert response.status_code == 429
    detail = response.json().get("detail", {})
    assert detail.get("code") == "RATE_LIMIT_EXCEEDED"


def test_day10_register_and_login_issue_api_keys(client):
    email = "pytest-day10-auth@example.com"
    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "ValidPass123",
            "tier": "basic",
            "first_name": "Py",
            "last_name": "Test",
        },
    )
    assert register.status_code == 200
    register_payload = register.json()
    first_key = register_payload.get("api_key")
    assert first_key and first_key.startswith("wssi-basic-")
    assert register_payload.get("access_token")
    assert register_payload.get("refresh_token")

    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "ValidPass123"},
    )
    assert login.status_code == 200
    login_payload = login.json()
    second_key = login_payload.get("api_key")
    assert second_key and second_key.startswith("wssi-basic-")
    assert second_key != first_key

    old_key_login = client.post("/api/v1/auth/key-login", json={"api_key": first_key})
    assert old_key_login.status_code == 401

    new_key_login = client.post("/api/v1/auth/key-login", json={"api_key": second_key})
    assert new_key_login.status_code == 200
    assert new_key_login.json().get("tier") == "basic"


def test_day10_billing_config_contract(client):
    response = client.get("/api/v1/billing/config")
    assert response.status_code == 200
    payload = response.json()
    assert "enabled" in payload
    assert "readiness" in payload
    assert "tiers" in payload
    assert {"basic", "pro", "enterprise"}.issubset(set(payload["tiers"].keys()))


def test_day10_billing_readiness_contract(client):
    response = client.get("/api/v1/billing/readiness")
    assert response.status_code == 200
    payload = response.json()
    assert "stripe_module_available" in payload
    assert "env" in payload
    assert "ready_for_checkout" in payload
    assert "ready_for_webhook" in payload
    assert {"publishable_key", "secret_key", "webhook_secret", "price_basic", "price_pro"}.issubset(set(payload["env"].keys()))


def test_day10_checkout_requires_valid_api_key(client):
    response = client.post(
        "/api/v1/billing/checkout-session",
        json={"tier": "basic"},
    )
    assert response.status_code == 401
    detail = response.json().get("detail", {})
    assert detail.get("code") == "AUTH_MISSING"


def test_day10_enterprise_checkout_requires_sales(client, api_key):
    response = client.post(
        "/api/v1/billing/checkout-session",
        json={"tier": "enterprise"},
        headers=_auth_headers(api_key),
    )
    assert response.status_code == 400
    detail = response.json().get("detail", {})
    assert detail.get("code") == "CONTACT_SALES_REQUIRED"


def test_day10_checkout_reports_not_configured_without_stripe(client, api_key):
    response = client.post(
        "/api/v1/billing/checkout-session",
        json={"tier": "basic"},
        headers=_auth_headers(api_key),
    )
    assert response.status_code == 503
    detail = response.json().get("detail", {})
    assert detail.get("code") == "BILLING_NOT_CONFIGURED"
