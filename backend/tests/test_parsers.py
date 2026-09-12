"""Unit tests for scanner/crawler parsing helpers (no external binaries)."""

from app.crawler import _parse_nuclei_severity
from app.scanner import PORT_OPEN_PATTERN, _extract_contact_data


def test_port_open_pattern_parses_service_and_version():
    match = PORT_OPEN_PATTERN.match("22/tcp   open  ssh     OpenSSH 9.6 (protocol 2.0)")
    assert match is not None
    assert match.group(1) == "22"
    assert match.group(2).lower() == "tcp"
    assert match.group(3) == "ssh"
    assert "OpenSSH" in match.group(4)


def test_port_open_pattern_parses_minimal_line():
    match = PORT_OPEN_PATTERN.match("443/udp open unknown")
    assert match is not None
    assert match.group(1) == "443"
    assert match.group(2).lower() == "udp"
    assert match.group(3) == "unknown"
    assert match.group(4) is None


def test_port_open_pattern_rejects_closed_ports():
    assert PORT_OPEN_PATTERN.match("22/tcp closed ssh") is None
    assert PORT_OPEN_PATTERN.match("Nmap scan report for example.com") is None


def test_extract_contact_data_filters_short_phone_numbers():
    text = "Contact: security@example.com, abuse@example.com, +34 600 123 456 and 12-34."
    emails, phones = _extract_contact_data(text)
    assert emails == ["abuse@example.com", "security@example.com"]
    assert any("600" in phone for phone in phones)
    assert all(len("".join(ch for ch in phone if ch.isdigit())) >= 7 for phone in phones)


def test_nuclei_severity_parsing():
    assert _parse_nuclei_severity("[critical] CVE-2024-0001") == "critical"
    assert _parse_nuclei_severity("[HIGH] something") == "high"
    assert _parse_nuclei_severity("[info] tech-detect") == "info"
    assert _parse_nuclei_severity("no severity tag present") == "medium"
