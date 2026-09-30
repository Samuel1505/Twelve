"""Exact solc builds for deployed-mode compiles (ANALYZER §8.3).

Looks in svm / solc-select install dirs first, then downloads from binaries.soliditylang.org into
~/.cache/twelve/solc and verifies the sha256 from the official list.json before first use.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import stat
import urllib.request
from pathlib import Path

from twelve.compile import CompileError

BASE = "https://binaries.soliditylang.org"
USER_AGENT = "twelve-analyzer (+https://github.com/; solc fetch)"  # the CDN rejects urllib's default UA (403)


def _get(url: str, timeout: int) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data: bytes = r.read()
    return data


def _platform_dir() -> str:
    system = platform.system()
    if system == "Darwin":
        return "macosx-amd64"  # universal binaries for >= 0.8.24; older ones run under Rosetta
    if system == "Linux":
        return "linux-amd64"
    raise CompileError(f"unsupported platform for solc binaries: {system}")


def cache_dir() -> Path:
    return Path(os.environ.get("TWELVE_CACHE", Path.home() / ".cache" / "twelve")) / "solc"


def normalize(long_version: str) -> str:
    """Blockscout gives 'v0.8.28+commit.7893614a' on testnet and '0.8.24+commit.e11b9ed9' on mainnet."""
    return long_version.strip().removeprefix("v")


def _local(version: str) -> Path | None:
    home = Path.home()
    for c in (
        home / "Library/Application Support/svm" / version / f"solc-{version}",
        home / ".svm" / version / f"solc-{version}",
        home / ".local/share/svm" / version / f"solc-{version}",
        home / ".solc-select/artifacts" / f"solc-{version}" / f"solc-{version}",
    ):
        if c.is_file():
            return c
    return None


def ensure_solc(long_version: str) -> Path:
    """Path to the exact build `0.8.x+commit.abcdef12` (commit must match, not just the version)."""
    from twelve.compile import (
        solc_long_version,
    )

    lv = normalize(long_version)
    version = lv.split("+")[0]
    local = _local(version)
    if local is not None and solc_long_version(local) == lv:
        return local
    target = cache_dir() / f"solc-{lv}"
    if target.is_file():
        return target
    plat = _platform_dir()
    listing = json.loads(_get(f"{BASE}/{plat}/list.json", 30))
    build = next((b for b in listing["builds"] if b["longVersion"] == lv), None)
    if build is None:
        raise CompileError(f"solc {lv} not published for {plat}")
    data = _get(f"{BASE}/{plat}/{build['path']}", 120)
    digest = "0x" + hashlib.sha256(data).hexdigest()
    if digest != build["sha256"]:
        raise CompileError(f"solc {lv} checksum mismatch: {digest} != {build['sha256']}")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.chmod(tmp.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    tmp.replace(target)
    if solc_long_version(target) != lv:
        raise CompileError(f"downloaded solc reports a different version than {lv}")
    return target
