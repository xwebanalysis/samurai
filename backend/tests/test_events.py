"""xwa-sdk ``Event`` envelope shape tests (unit + WebSocket integration)."""

import json
from datetime import datetime

import pytest

from app import events, scanner


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


def test_build_event_shape():
    event = events.build_event(1, "log", 42, {"line": "hello"})
    assert set(event) == {"seq", "type", "tool", "analysis_id", "ts", "payload"}
    assert event["seq"] == 1
    assert event["type"] == "log"
    assert event["tool"] == "samurai"
    assert event["analysis_id"] == "42"
    assert event["payload"] == {"line": "hello"}
    datetime.fromisoformat(event["ts"].replace("Z", "+00:00"))


def test_build_event_rejects_unknown_type():
    with pytest.raises(ValueError):
        events.build_event(1, "not_an_event", 1)


def test_build_event_fallback_without_xwa_sdk(monkeypatch):
    """The envelope must be structurally identical when xwa-sdk is absent."""
    monkeypatch.setattr(events, "XWA_SDK_AVAILABLE", False)
    event = events.build_event(9, "analysis_started", 55, {"target": "example.com"}, ts="2026-09-12T10:00:00Z")
    assert event == {
        "seq": 9,
        "type": "analysis_started",
        "tool": "samurai",
        "analysis_id": "55",
        "ts": "2026-09-12T10:00:00Z",
        "payload": {"target": "example.com"},
    }


async def test_emitter_monotonic_sequence_and_payloads():
    ws = FakeWebSocket()
    emitter = events.EventEmitter(ws)

    with pytest.raises(RuntimeError):
        await emitter.log("before bind")

    emitter.bind(7)
    await emitter.log("[+] line")
    await emitter.progress("web_surface", "crawling", {"url": "http://example.com"})
    await emitter.item_found(events.open_port_item("22", "tcp", "ssh", "OpenSSH", "22/tcp open ssh"))
    await emitter.completed({"total_items": 0, "by_severity": {}, "ports": []}, status="COMPLETED")
    await emitter.error("INTERNAL", "boom")

    assert [event["seq"] for event in ws.sent] == [1, 2, 3, 4, 5]
    assert all(event["analysis_id"] == "7" for event in ws.sent)
    assert all(event["tool"] == "samurai" for event in ws.sent)
    assert ws.sent[0]["payload"] == {"line": "[+] line"}
    assert ws.sent[1]["type"] == "analysis_progress"
    assert ws.sent[1]["payload"]["phase"] == "web_surface"
    assert ws.sent[1]["payload"]["data"]["url"] == "http://example.com"
    assert ws.sent[2]["type"] == "item_found"
    assert ws.sent[2]["payload"]["port"] == "22"
    assert ws.sent[2]["payload"]["protocol"] == "tcp"
    assert ws.sent[3]["type"] == "analysis_completed"
    assert ws.sent[3]["payload"]["summary"]["total_items"] == 0
    assert ws.sent[4]["type"] == "analysis_error"
    assert ws.sent[4]["payload"]["error"]["code"] == "INTERNAL"


async def test_open_port_item_shape():
    item = events.open_port_item("443", "tcp", "https", "nginx 1.27", "443/tcp open https")
    assert item["kind"] == "open_port"
    assert item["severity"] == "info"
    assert item["evidence"]["raw"] == "443/tcp open https"


def test_websocket_scan_emits_event_envelopes(client, monkeypatch):
    async def fake_scan(target, emitter, db, **kwargs):
        emitter.bind("12345")
        await emitter.emit("analysis_started", {"target": target, "scan_type": "port_scan:quick"})
        await emitter.log("[+] fake scanning")
        await emitter.item_found(events.open_port_item("22", "tcp", "ssh", "OpenSSH", "22/tcp open ssh"))
        await emitter.completed({"total_items": 1, "by_severity": {"info": 1}, "ports": []}, scan_id=12345)
        await emitter.close()

    monkeypatch.setattr(scanner, "perform_nmap_scan", fake_scan)

    received = []
    with client.websocket_connect("/api/scan/live?target=example.com") as websocket:
        while True:
            try:
                received.append(websocket.receive_json())
            except Exception:
                break

    assert [event["type"] for event in received] == [
        "analysis_started",
        "log",
        "item_found",
        "analysis_completed",
    ]
    assert [event["seq"] for event in received] == [1, 2, 3, 4]
    assert all(event["tool"] == "samurai" for event in received)
    assert all(event["analysis_id"] == "12345" for event in received)
    for event in received:
        json.dumps(event)
