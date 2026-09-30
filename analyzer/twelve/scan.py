"""twelve.scan — pre-deploy scan: path → standard-JSON → IR → dataflow → reportCore (docs/ANALYZER.md §7)."""

from __future__ import annotations

import importlib.metadata
import os
import subprocess
import time
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from twelve import __version__
from twelve.compile import DEFAULT_SOLC_VERSION, build_ir, resolve_solc, standard_json_for_path
from twelve.dataflow import analyze
from twelve.report import build_core, report_hash
from twelve.rules import rules_hash


@dataclass(frozen=True)
class ScanResult:
    core: dict[str, Any]
    report_hash: str
    meta: dict[str, Any]

    def as_json(self) -> dict[str, Any]:
        return {"reportHash": self.report_hash, "reportCore": self.core, "meta": self.meta}


def git_commit() -> str:
    """Commit of the analyzer source ($TWELVE_GIT_COMMIT wins, e.g. in the Docker image)."""
    env = os.environ.get("TWELVE_GIT_COMMIT")
    if env:
        return env
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent,
                             capture_output=True, text=True, check=True, timeout=5)
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def tool_info() -> dict[str, str]:
    return {
        "name": "twelve",
        "version": __version__,
        "gitCommit": git_commit(),
        "slither": importlib.metadata.version("slither-analyzer"),
        "rulesHash": rules_hash(),
    }


def load_config(path: Path | None) -> dict[str, str]:
    """twelve.toml `[bindings]` table: "file.sol:Contract.var" = "USDC_ERC20"."""
    if path is None or not path.is_file():
        return {}
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    bindings = data.get("bindings", {})
    return {str(k): str(v) for k, v in bindings.items()}


def scan_path(path: Path, *, config_path: Path | None = None, solc: Path | None = None,
              solc_version: str = DEFAULT_SOLC_VERSION) -> ScanResult:
    t0 = time.monotonic()
    if config_path is None:
        candidate = (path if path.is_dir() else path.parent) / "twelve.toml"
        config_path = candidate if candidate.is_file() else None
    std = standard_json_for_path(path)
    compiled = build_ir(std, solc or resolve_solc(solc_version))
    engine = analyze(compiled.slither, compiled.sources, load_config(config_path))
    settings = std["settings"]
    core = build_core(
        tool=tool_info(),
        target={"kind": "source", "files": sorted(compiled.sources)},
        input_={
            "standardJsonHash": compiled.standard_json_hash,
            "compiler": compiled.compiler,
            "evmVersion": settings["evmVersion"],
            "optimizer": settings["optimizer"],
        },
        bindings=[b.as_json() for b in engine.bindings.values()],
        findings=engine.findings_json(),
        functions_analyzed=len(engine.functions_analyzed),
        unsupported=[{"function": f, "reason": r} for f, r in engine.unsupported],
    )
    meta = {"durationMs": int((time.monotonic() - t0) * 1000), "scannedAt": int(time.time())}
    return ScanResult(core, report_hash(core), meta)
