from datetime import datetime, timezone

from ..events import EventEmitter


class ReconStreamLogger:
    def __init__(self, emitter: EventEmitter) -> None:
        self.emitter = emitter

    async def line(self, message: str) -> None:
        await self.emitter.log(message)

    async def phase(self, title: str) -> None:
        await self.line("")
        await self.line(title)
        await self.line("-" * 68)

    async def banner(self, target: str) -> None:
        started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        await self.line("+------------------------------------------------------------------+")
        await self.line("|                  SAMURAI WEB RECON ENGINE                        |")
        await self.line(f"| Target: {target:<56}|")
        await self.line(f"| Started: {started:<55}|")
        await self.line("+------------------------------------------------------------------+")
