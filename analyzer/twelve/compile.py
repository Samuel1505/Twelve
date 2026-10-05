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


class SlitherInheritanceStall(Exception):
    """Slither cannot order the contracts' inheritance (seen: a parent contract that shares its name with a library,
    UniversalRouter's `Lock`). Its parser would loop forever; the report would rest on a wrong parent, so: UNSUPPORTED."""


_SLITHER_GUARDED = "0.11.6"


def _guard_slither_using_for() -> None:
    """Bound slither 0.11.6's `_analyze_using_for` worklist (otherwise unbounded: a contract whose parent is never marked
    analyzed is re-queued forever). Same order and effects as the original; raises once a full pass makes no progress.
    Applied only to the exact pinned version whose source this mirrors (CLAUDE.md §8)."""
    from importlib.metadata import version

    from slither.solc_parsing import slither_compilation_unit_solc as m

    cls = m.SlitherCompilationUnitSolc
    if version("slither-analyzer") != _SLITHER_GUARDED or getattr(cls, "_twelve_guarded", False):
        return

    def _analyze_using_for(self: Any, contracts_to_be_analyzed: list[Any], libraries: list[Any]) -> None:
        self._analyze_top_level_using_for()
        for lib in libraries:
            lib.analyze_using_for()
        todo = list(contracts_to_be_analyzed)
        stalled = 0
        while todo:
            contract = todo.pop(0)
            fathers = contract.underlying_contract.inheritance
            if not fathers or all(self._underlying_contract_to_parser[f].is_analyzed for f in fathers):
                contract.analyze_using_for()
                contract.set_is_analyzed(True)
                stalled = 0
                continue
            todo.append(contract)
            stalled += 1
            if stalled > len(todo):  # a full rotation without progress: nothing left can ever become ready
                waits = sorted(
                    f"{c.underlying_contract.name} inherits '{f.name}' ({f.contract_kind})"
                    for c in todo
                    for f in c.underlying_contract.inheritance
                    if not self._underlying_contract_to_parser[f].is_analyzed
                )
                raise SlitherInheritanceStall(
                    "Slither cannot resolve this contract's inheritance (" + "; ".join(waits[:3]) + "). This usually "
                    "means two contracts or libraries share a name in the verified sources."
                )

    cls._analyze_using_for = _analyze_using_for
    cls._twelve_guarded = True


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


def _collect_files(entry: Path) -> set[Path]:
    """The entry file plus everything it reaches through relative imports, as absolute paths."""
    seen: set[Path] = set()
    stack = [entry.resolve()]
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        for imp in _IMPORT_RE.findall(p.read_text(encoding="utf-8")):
            if imp.startswith("."):
                stack.append((p.parent / imp).resolve())
    return seen


def _source_root(base: Path, files: set[Path]) -> Path:
    """Deepest directory containing `base` and every file. Equals `base` unless an import climbs out of it
    (e.g. `../guard/Usdc.sol`); then source names keep the shared prefix so solc resolves the relative imports."""
    return Path(os.path.commonpath([str(base.resolve()), *(str(f.parent) for f in files)]))


def standard_json_for_path(path: Path, evm_version: str = DEFAULT_EVM_VERSION) -> dict[str, Any]:
    """Pre-deploy mode input: a .sol file (and its relative imports) or every .sol under a directory.
    Source names are POSIX paths relative to the scanned directory (or the file's directory) — deterministic, I4."""
    entries = sorted(path.rglob("*.sol")) if path.is_dir() else [path]
    files: set[Path] = set()
    for f in entries:
        files |= _collect_files(f)
    root = _source_root(path if path.is_dir() else path.parent, files)
    sources = {f.relative_to(root).as_posix(): f.read_text(encoding="utf-8") for f in files}
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
        _guard_slither_using_for()
        try:
            cc = CryticCompile(SolcStandardJson(work_copy), solc=str(solc), solc_working_dir=str(root))
            sl = Slither(cc)
        except SlitherInheritanceStall:
            raise
        except Exception as e:  # crytic/slither raise a variety of types
            raise CompileError(str(e).strip().splitlines()[-1] if str(e).strip() else repr(e)) from e
    return CompiledInput(std, h, solc_long_version(solc), sl)
