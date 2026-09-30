"""twelve.compile — solc resolution, standard-JSON construction, hashing, and Slither IR construction.

Follows proposed ADR-016 / SLITHIR_NOTES §11: `standardJsonHash` is computed on the pristine input; crytic-compile
gets a deep copy with sources materialized in a temp dir (it mutates its input and needs files on disk).
"""

from __future__ import annotations

import copy
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from twelve.report import hex_keccak_jcs

DEFAULT_SOLC_VERSION = "0.8.30"
DEFAULT_EVM_VERSION = "osaka"

# Output selection crytic-compile needs (SLITHIR_NOTES §11.3). Does not affect bytecode.
OUTPUT_SELECTION: dict[str, Any] = {
    "*": {"*": ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"], "": ["ast"]}
}

_IMPORT_RE = re.compile(r"""^\s*import\s+(?:[^'"]*\bfrom\s+)?["']([^"']+)["']""", re.MULTILINE)


class CompileError(Exception):
    pass


def resolve_solc(version: str = DEFAULT_SOLC_VERSION) -> Path:
    """Find an exact solc build: $TWELVE_SOLC, then svm (Foundry) and solc-select install dirs."""
    explicit = os.environ.get("TWELVE_SOLC")
    if explicit:
        return Path(explicit)
    home = Path.home()
    candidates = [
        home / "Library/Application Support/svm" / version / f"solc-{version}",
        home / ".svm" / version / f"solc-{version}",
        home / ".local/share/svm" / version / f"solc-{version}",
        home / ".solc-select/artifacts" / f"solc-{version}" / f"solc-{version}",
    ]
    for c in candidates:
        if c.is_file():
            return c
    raise CompileError(f"solc {version} not found; set TWELVE_SOLC or `forge build --use {version}` once")


def solc_long_version(solc: Path) -> str:
    out = subprocess.run([str(solc), "--version"], capture_output=True, text=True, check=True).stdout
    m = re.search(r"Version:\s*(\S+)", out)
    if not m:
        raise CompileError(f"cannot parse solc --version: {out!r}")
    # "0.8.30+commit.73712a01.Darwin.appleclang" -> "0.8.30+commit.73712a01"
    return ".".join(m.group(1).split(".")[:4]) if "+commit." in m.group(1) else m.group(1)


def _collect_sources(entry: Path, base: Path) -> dict[str, str]:
    """The entry file plus relative imports, keyed by POSIX path relative to `base` (deterministic, I4)."""
    out: dict[str, str] = {}
    stack = [entry.resolve()]
    base = base.resolve()
    while stack:
        p = stack.pop()
        name = p.relative_to(base).as_posix()
        if name in out:
            continue
        text = p.read_text(encoding="utf-8")
        out[name] = text
        for imp in _IMPORT_RE.findall(text):
            if imp.startswith("."):
                stack.append((p.parent / imp).resolve())
    return dict(sorted(out.items()))


def standard_json_for_path(path: Path, evm_version: str = DEFAULT_EVM_VERSION) -> dict[str, Any]:
    """Pre-deploy mode input: a .sol file (and its relative imports) or every .sol under a directory."""
    if path.is_dir():
        sources: dict[str, str] = {}
        for f in sorted(path.rglob("*.sol")):
            sources.update(_collect_sources(f, path))
    else:
        sources = _collect_sources(path, path.parent)
    return {
        "language": "Solidity",
        "sources": {name: {"content": text} for name, text in sorted(sources.items())},
        "settings": {
            "evmVersion": evm_version,
            "optimizer": {"enabled": False, "runs": 200},
            "outputSelection": OUTPUT_SELECTION,
        },
    }


def standard_json_hash(std: dict[str, Any]) -> str:
    return hex_keccak_jcs(std)


@dataclass(frozen=True)
class CompiledInput:
    standard_json: dict[str, Any]  # pristine, as hashed
    standard_json_hash: str
    compiler: str
    slither: Any  # slither.Slither (untyped library)

    @property
    def sources(self) -> dict[str, str]:
        return {k: v["content"] for k, v in self.standard_json["sources"].items()}


def build_ir(std: dict[str, Any], solc: Path) -> CompiledInput:
    from crytic_compile import CryticCompile
    from crytic_compile.platform.solc_standard_json import SolcStandardJson
    from slither import Slither

    h = standard_json_hash(std)
    work_copy = copy.deepcopy(std)
    work_copy["settings"]["outputSelection"] = OUTPUT_SELECTION
    with tempfile.TemporaryDirectory(prefix="twelve-") as tmp:
        root = Path(tmp)
        for name, src in work_copy["sources"].items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(src["content"], encoding="utf-8")
        try:
            cc = CryticCompile(SolcStandardJson(work_copy), solc=str(solc), solc_working_dir=str(root))
            sl = Slither(cc)
        except Exception as e:  # crytic/slither raise a variety of types
            raise CompileError(str(e).strip().splitlines()[-1] if str(e).strip() else repr(e)) from e
    return CompiledInput(std, h, solc_long_version(solc), sl)
