"""Subprocess timeout helper tests (sqlmap/nuclei budget + kill escalation)."""

import asyncio

from app import crawler


async def _spawn_sleeper() -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        "sleep", "60",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )


async def test_terminate_process_stops_running_child():
    process = await _spawn_sleeper()
    await crawler._terminate_process(process, grace=2.0)
    assert process.returncode is not None


async def test_terminate_process_is_idempotent():
    process = await _spawn_sleeper()
    await crawler._terminate_process(process, grace=2.0)
    await crawler._terminate_process(process, grace=2.0)  # must not raise
    assert process.returncode is not None


def test_external_scanner_budgets_are_configured():
    assert crawler.SQLMAP_TIMEOUT_SECONDS > 0
    assert crawler.NUCLEI_TIMEOUT_SECONDS > 0
    assert crawler.SUBPROCESS_TERMINATE_GRACE_SECONDS > 0
