import json
import math
import sqlite3
from datetime import datetime
from pathlib import Path


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "output" / "analytics").exists():
            return parent
    raise RuntimeError("Could not locate repository root from test path.")


REPO_ROOT = _repo_root()
ANALYTICS_DIR = REPO_ROOT / "output" / "analytics"
POLY_DB_PATH = REPO_ROOT / "data" / "polycrisis.db"


def _load_json(filename: str):
    target = ANALYTICS_DIR / filename
    assert target.exists(), f"Missing analytics artifact: {target}"
    with target.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def test_required_analytics_artifacts_exist_and_parse():
    required = [
        "wssi-latest.json",
        "wssi-history.json",
        "indicators-latest.json",
        "correlations.json",
        "network.json",
        "alerts.json",
        "patterns.json",
    ]
    for artifact in required:
        payload = _load_json(artifact)
        assert isinstance(payload, (dict, list)), f"{artifact} must parse into JSON object/array"


def test_wssi_latest_contract_shape():
    payload = _load_json("wssi-latest.json")
    assert isinstance(payload, dict)
    assert isinstance(payload.get("wssi_score"), (int, float))
    assert isinstance(payload.get("wssi_value"), (int, float))
    assert isinstance(payload.get("calculation_timestamp"), str)

    theme_signals = payload.get("theme_signals")
    assert isinstance(theme_signals, list)
    assert len(theme_signals) > 0

    required_theme_fields = {
        "theme_id",
        "theme_name",
        "category",
        "stress_level",
        "mean_z_score",
        "momentum_30d",
        "indicator_details",
    }
    for row in theme_signals:
        assert required_theme_fields.issubset(set(row.keys()))
        assert isinstance(row["indicator_details"], list)


def test_wssi_history_contract_and_ordering():
    payload = _load_json("wssi-history.json")
    assert isinstance(payload, dict)
    rows = payload.get("history")
    assert isinstance(rows, list)
    assert len(rows) >= 30

    if "count" in payload and isinstance(payload["count"], int):
        assert payload["count"] == len(rows)

    dates = []
    for row in rows:
        assert isinstance(row.get("date"), str)
        assert isinstance(row.get("wssi_score"), (int, float))
        assert isinstance(row.get("wssi_value"), (int, float))
        datetime.strptime(row["date"], "%Y-%m-%d")
        dates.append(row["date"])
    assert dates == sorted(dates), "WSSI history dates must be ascending"


def test_indicators_latest_contract():
    payload = _load_json("indicators-latest.json")
    assert isinstance(payload, dict)
    indicators = payload.get("indicators")
    assert isinstance(indicators, list)
    assert len(indicators) > 0

    if "count" in payload and isinstance(payload["count"], int):
        assert payload["count"] == len(indicators)

    required_fields = {
        "indicator_id",
        "indicator_name",
        "source",
        "raw_value",
        "normalized_z",
        "theme_id",
        "date",
    }
    for item in indicators:
        assert required_fields.issubset(set(item.keys()))
        assert isinstance(item["indicator_id"], str)
        assert isinstance(item["indicator_name"], str)


def test_correlations_contract_and_numeric_safety():
    payload = _load_json("correlations.json")
    assert isinstance(payload, dict)
    theme_level = payload.get("theme_level")
    assert isinstance(theme_level, dict)

    pairs = theme_level.get("pairs")
    assert isinstance(pairs, list)
    assert len(pairs) > 0

    matrix = theme_level.get("matrix")
    assert isinstance(matrix, dict)
    assert len(matrix) > 0

    for pair in pairs:
        if isinstance(pair.get("pearson_r"), (int, float)):
            assert math.isfinite(pair["pearson_r"])
        if isinstance(pair.get("p_value"), (int, float)):
            assert math.isfinite(pair["p_value"])
        if isinstance(pair.get("sample_n"), int):
            assert pair["sample_n"] >= 0

    for row in matrix.values():
        assert isinstance(row, dict)
        for value in row.values():
            if value is None:
                continue
            assert isinstance(value, (int, float))
            assert math.isfinite(value)


def test_network_contract_integrity():
    payload = _load_json("network.json")
    assert isinstance(payload, dict)
    nodes = payload.get("nodes")
    edges = payload.get("edges")
    assert isinstance(nodes, list) and len(nodes) > 0
    assert isinstance(edges, list) and len(edges) > 0

    if isinstance(payload.get("node_count"), int):
        assert payload["node_count"] == len(nodes)
    if isinstance(payload.get("edge_count"), int):
        assert payload["edge_count"] == len(edges)

    node_ids = [node.get("id") for node in nodes]
    assert all(isinstance(node_id, str) and node_id for node_id in node_ids)
    assert len(node_ids) == len(set(node_ids)), "Node IDs must be unique"
    node_set = set(node_ids)

    for edge in edges:
        assert isinstance(edge.get("id"), str) and edge["id"]
        assert edge.get("source") in node_set
        assert edge.get("target") in node_set
        weight = edge.get("weight")
        assert isinstance(weight, (int, float))
        assert math.isfinite(weight)


def test_alerts_contract_integrity():
    payload = _load_json("alerts.json")
    assert isinstance(payload, dict)

    active = payload.get("active_alerts")
    recent = payload.get("recent_alerts")
    assert isinstance(active, list)
    assert isinstance(recent, list)

    if isinstance(payload.get("active_count"), int):
        assert payload["active_count"] == len(active)
    if isinstance(payload.get("recent_count"), int):
        assert payload["recent_count"] == len(recent)

    allowed_severity = {"critical", "warning", "info", "unknown"}
    allowed_status = {"active", "resolved", "unknown"}

    seen_ids = set()
    for row in active + recent:
        row_id = row.get("id") or row.get("alert_id")
        assert isinstance(row_id, (str, int)) and str(row_id)
        seen_ids.add(str(row_id))

        severity = str(row.get("severity", "unknown")).lower()
        status = str(row.get("status", "unknown")).lower()
        assert severity in allowed_severity
        assert status in allowed_status

    assert len(seen_ids) >= len(active), "Alert IDs should be non-empty and mostly unique"


def test_patterns_contract_integrity():
    payload = _load_json("patterns.json")
    assert isinstance(payload, dict)
    matches = payload.get("matches")
    assert isinstance(matches, list)
    assert len(matches) > 0

    similarities = []
    for match in matches:
        for field in ("episode_id", "label", "period", "confidence_tier"):
            assert isinstance(match.get(field), str)
        score = match.get("similarity_pct")
        assert isinstance(score, (int, float))
        assert 0 <= score <= 100
        similarities.append(score)

        diagnostics = match.get("diagnostics")
        assert isinstance(diagnostics, dict)
        assert isinstance(diagnostics.get("overlap"), list)
        assert isinstance(diagnostics.get("missing_indicators"), list)

    assert similarities[0] >= similarities[-1], "Top analog should rank at or above tail analog"


def test_polycrisis_database_core_tables_present():
    assert POLY_DB_PATH.exists(), f"Missing core DB: {POLY_DB_PATH}"
    with sqlite3.connect(POLY_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}

        required_tables = {"normalized_values", "wssi_history", "pipeline_runs", "indicator_metadata"}
        missing = required_tables - tables
        assert not missing, f"Missing required core tables: {sorted(missing)}"

        for table in ("normalized_values", "wssi_history", "pipeline_runs"):
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = int(cursor.fetchone()[0])
            assert count > 0, f"Expected non-empty table: {table}"
