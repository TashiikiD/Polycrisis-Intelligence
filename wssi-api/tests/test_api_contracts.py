import hashlib
import importlib.util
import json
import os
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


def _cleanup_release(api_module, release_id: str):
    conn = api_module.get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT free_html_path, paid_html_path, free_json_path, paid_json_path
        FROM brief_releases
        WHERE release_id = ?
        """,
        (release_id,),
    )
    row = cursor.fetchone()
    if row:
        for column in ["free_html_path", "paid_html_path", "free_json_path", "paid_json_path"]:
            raw_path = row[column]
            if not raw_path:
                continue
            path = api_module.resolve_data_relative_path(raw_path)
            if path.exists():
                path.unlink()
        release_dir = api_module.BRIEF_RELEASES_ROOT / release_id
        if release_dir.exists() and release_dir.is_dir():
            for child in release_dir.glob("*"):
                if child.is_file():
                    child.unlink()
            try:
                release_dir.rmdir()
            except OSError:
                pass
        cursor.execute("DELETE FROM brief_releases WHERE release_id = ?", (release_id,))
        conn.commit()
    conn.close()


@pytest.fixture
def archive_publish_setup(api_module):
    token = "pytest-brief-publish-token"
    previous_token = os.environ.get("WSSI_BRIEF_PUBLISH_TOKEN")
    previous_max = os.environ.get("WSSI_BRIEF_ARCHIVE_MAX_RELEASES")
    os.environ["WSSI_BRIEF_PUBLISH_TOKEN"] = token
    os.environ["WSSI_BRIEF_ARCHIVE_MAX_RELEASES"] = "200"

    payloads = {
        "wssi-latest.json": {
            "wssi_value": 0.92,
            "wssi_score": 64.7,
            "wssi_delta": 0.34,
            "trend": "up",
            "stress_level": "approaching",
            "active_themes": 6,
            "above_warning": 4,
            "calculation_timestamp": "2026-02-20T12:00:00Z",
            "theme_signals": [
                {
                    "theme_id": "3.4",
                    "theme_name": "Governance Decay",
                    "category": "Geopolitical-Conflict",
                    "mean_z_score": -3.2,
                    "stress_level": "critical",
                    "momentum_30d": -0.58,
                    "data_freshness": "fresh",
                    "indicator_details": [
                        {"indicator_id": "3.4.1", "name": "Governance Integrity", "momentum_30d": -0.58}
                    ],
                },
                {
                    "theme_id": "2.1",
                    "theme_name": "Tipping Point Proximity",
                    "category": "Climate-Environmental",
                    "mean_z_score": 2.8,
                    "stress_level": "approaching",
                    "momentum_30d": 0.41,
                    "data_freshness": "recent",
                    "indicator_details": [
                        {"indicator_id": "2.1.1", "name": "Temperature Extremes", "momentum_30d": 0.41}
                    ],
                },
            ],
        },
        "alerts.json": {
            "generated_at": "2026-02-20T12:00:00Z",
            "active_alerts": [
                {
                    "alert_id": "A1",
                    "title": "Governance critical stress",
                    "severity": "critical",
                    "status": "active",
                    "created_at": "2026-02-20 12:00:00",
                    "theme_ids": ["3.4"],
                }
            ],
            "recent_alerts": [
                {
                    "alert_id": "A2",
                    "title": "Climate warning",
                    "severity": "warning",
                    "status": "resolved",
                    "created_at": "2026-02-19 10:00:00",
                    "theme_ids": ["2.1"],
                }
            ],
        },
        "correlations.json": {
            "generated_at": "2026-02-20T12:00:00Z",
            "strong_threshold": 0.6,
            "pairs": [
                {"theme_a": "3.4", "theme_b": "2.1", "pearson_r": 0.73, "p_value": 0.01, "sample_n": 44}
            ],
        },
        "network.json": {
            "generated_at": "2026-02-20T12:00:00Z",
            "nodes": [
                {"id": "n_3_4", "label": "Governance Decay", "category": "Geopolitical-Conflict"},
                {"id": "n_2_1", "label": "Tipping Point Proximity", "category": "Climate-Environmental"},
            ],
            "edges": [
                {"id": "e1", "source": "n_3_4", "target": "n_2_1", "weight": 0.61, "evidence": "documented"}
            ],
            "metrics": {"n_3_4": {"degree_total": 3}, "n_2_1": {"degree_total": 2}},
        },
        "patterns.json": {
            "generated_at": "2026-02-20T12:00:00Z",
            "matches": [
                {"episode_id": "E1", "label": "2008 Crisis", "period": "2008-2009", "similarity_pct": 78.1, "confidence_tier": "high"}
            ],
        },
        "wssi-history.json": {
            "generated_at": "2026-02-20T12:00:00Z",
            "history": [
                {"date": "2026-02-19", "wssi_score": 62.1, "wssi_value": 0.84},
                {"date": "2026-02-20", "wssi_score": 64.7, "wssi_value": 0.92},
            ],
        },
    }

    backups = {}
    for filename, payload in payloads.items():
        path = api_module.DATA_DIR / filename
        backups[filename] = path.read_text(encoding="utf-8") if path.exists() else None
        path.write_text(json.dumps(payload), encoding="utf-8")

    yield {"token": token}

    for filename, original in backups.items():
        path = api_module.DATA_DIR / filename
        if original is None:
            if path.exists():
                path.unlink()
        else:
            path.write_text(original, encoding="utf-8")

    if previous_token is None:
        os.environ.pop("WSSI_BRIEF_PUBLISH_TOKEN", None)
    else:
        os.environ["WSSI_BRIEF_PUBLISH_TOKEN"] = previous_token

    if previous_max is None:
        os.environ.pop("WSSI_BRIEF_ARCHIVE_MAX_RELEASES", None)
    else:
        os.environ["WSSI_BRIEF_ARCHIVE_MAX_RELEASES"] = previous_max


@pytest.fixture
def free_archive_api_key(api_module):
    key = "pytest-day11-archive-free-key"
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    conn = api_module.get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO api_keys (key_hash, name, tier, rate_limit, is_active, is_admin)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (key_hash, "Pytest Archive Free Key", "free", 0, 1, 0),
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


def test_day11_5_publish_endpoint_requires_valid_token(client, archive_publish_setup):
    missing = client.post("/api/v1/briefs/releases/publish", json={"created_by": "pytest"})
    assert missing.status_code == 401
    assert missing.json().get("detail", {}).get("code") == "PUBLISH_TOKEN_INVALID"

    invalid = client.post(
        "/api/v1/briefs/releases/publish",
        json={"created_by": "pytest"},
        headers={"X-Brief-Publish-Token": "wrong-token"},
    )
    assert invalid.status_code == 401
    assert invalid.json().get("detail", {}).get("code") == "PUBLISH_TOKEN_INVALID"


def test_day11_5_publish_creates_release_and_artifacts(client, api_module, archive_publish_setup):
    response = client.post(
        "/api/v1/briefs/releases/publish",
        json={"release_date": "2099-01-01", "created_by": "pytest"},
        headers={"X-Brief-Publish-Token": archive_publish_setup["token"]},
    )
    assert response.status_code == 200
    payload = response.json()
    release = payload.get("release", {})
    release_id = release.get("release_id")
    assert release_id
    try:
        conn = api_module.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM brief_releases WHERE release_id = ?", (release_id,))
        row = cursor.fetchone()
        conn.close()
        assert row is not None
        assert (api_module.resolve_data_relative_path(row["free_html_path"])).exists()
        assert (api_module.resolve_data_relative_path(row["paid_html_path"])).exists()
        assert (api_module.resolve_data_relative_path(row["free_json_path"])).exists()
        assert (api_module.resolve_data_relative_path(row["paid_json_path"])).exists()
    finally:
        _cleanup_release(api_module, release_id)


def test_day11_5_release_list_sorted_newest_first(client, api_module, archive_publish_setup):
    headers = {"X-Brief-Publish-Token": archive_publish_setup["token"]}
    first = client.post(
        "/api/v1/briefs/releases/publish",
        json={"release_date": "2099-01-01", "created_by": "pytest"},
        headers=headers,
    )
    second = client.post(
        "/api/v1/briefs/releases/publish",
        json={"release_date": "2099-01-02", "created_by": "pytest"},
        headers=headers,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    first_id = first.json()["release"]["release_id"]
    second_id = second.json()["release"]["release_id"]
    try:
        listing = client.get("/api/v1/briefs/releases?limit=50")
        assert listing.status_code == 200
        release_ids = [item["release_id"] for item in listing.json().get("releases", [])]
        assert second_id in release_ids
        assert first_id in release_ids
        assert release_ids.index(second_id) < release_ids.index(first_id)
    finally:
        _cleanup_release(api_module, first_id)
        _cleanup_release(api_module, second_id)


def test_day11_5_unauthenticated_and_free_list_are_free_only(client, api_module, archive_publish_setup, free_archive_api_key):
    publish = client.post(
        "/api/v1/briefs/releases/publish",
        json={"release_date": "2099-01-03", "created_by": "pytest"},
        headers={"X-Brief-Publish-Token": archive_publish_setup["token"]},
    )
    assert publish.status_code == 200
    release_id = publish.json()["release"]["release_id"]
    try:
        unauth = client.get("/api/v1/briefs/releases?limit=5")
        assert unauth.status_code == 200
        first = unauth.json()["releases"][0]
        assert first["release_id"] == release_id
        assert first["links"]["free"]["view_url"].endswith("variant=free")
        assert first["links"]["paid"] is None
        assert first["locked_paid"] is True

        free = client.get("/api/v1/briefs/releases?limit=5", headers=_auth_headers(free_archive_api_key))
        assert free.status_code == 200
        free_first = free.json()["releases"][0]
        assert free_first["links"]["paid"] is None
        assert free_first["locked_paid"] is True
    finally:
        _cleanup_release(api_module, release_id)


def test_day11_5_paid_list_and_variant_access(client, api_module, archive_publish_setup, api_key, free_archive_api_key):
    publish = client.post(
        "/api/v1/briefs/releases/publish",
        json={"release_date": "2099-01-04", "created_by": "pytest"},
        headers={"X-Brief-Publish-Token": archive_publish_setup["token"]},
    )
    assert publish.status_code == 200
    release_id = publish.json()["release"]["release_id"]
    try:
        paid_list = client.get("/api/v1/briefs/releases?limit=5", headers=_auth_headers(api_key))
        assert paid_list.status_code == 200
        paid_row = next(item for item in paid_list.json()["releases"] if item["release_id"] == release_id)
        assert paid_row["links"]["paid"]["view_url"].endswith("variant=paid")
        assert paid_row["locked_paid"] is False

        free_view = client.get(f"/api/v1/briefs/releases/{release_id}/view?variant=free")
        assert free_view.status_code == 200
        assert "text/html" in free_view.headers.get("content-type", "")

        unauth_paid_view = client.get(f"/api/v1/briefs/releases/{release_id}/view?variant=paid")
        assert unauth_paid_view.status_code in {402, 403}
        assert unauth_paid_view.json().get("detail", {}).get("code") == "UPGRADE_REQUIRED"

        free_paid_view = client.get(
            f"/api/v1/briefs/releases/{release_id}/view?variant=paid",
            headers=_auth_headers(free_archive_api_key),
        )
        assert free_paid_view.status_code in {402, 403}
        assert free_paid_view.json().get("detail", {}).get("code") == "UPGRADE_REQUIRED"

        paid_view = client.get(
            f"/api/v1/briefs/releases/{release_id}/view?variant=paid",
            headers=_auth_headers(api_key),
        )
        assert paid_view.status_code == 200
        assert "text/html" in paid_view.headers.get("content-type", "")

        paid_model = client.get(
            f"/api/v1/briefs/releases/{release_id}/model?variant=paid",
            headers=_auth_headers(api_key),
        )
        assert paid_model.status_code == 200
        assert paid_model.json().get("tier_context", {}).get("tier") == "paid"
    finally:
        _cleanup_release(api_module, release_id)
