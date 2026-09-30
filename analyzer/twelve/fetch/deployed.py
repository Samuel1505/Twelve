"""Deployed-contract mode: address → classify → fetch → rebuild → compile → match → bind → analyze (ANALYZER §3.2, §8).

Network I/O happens here only; the analysis consumes the rebuilt standard-JSON plus on-chain binding values (ADR-002).
Never produces a report for code that did not match (I5).
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from twelve.compile import CompileError, build_ir
from twelve.dataflow import DeployedValue, analyze
from twelve.fetch.blockscout import smart_contract
from twelve.fetch.match import Match, match_runtime
from twelve.fetch.proxy import Target, classify
from twelve.fetch.rebuild import rebuild
from twelve.fetch.rpc import Rpc
from twelve.fetch.solc_bin import ensure_solc
from twelve.report import build_core, report_hash
from twelve.scan import ScanResult, tool_info

CHAINS = {"arc": 5042, "arc-testnet": 5042002}


class ChainMismatch(Exception):
    pass


def run_solc(std: dict[str, Any], solc: Path) -> dict[str, Any]:
    proc = subprocess.run([str(solc), "--standard-json"], input=json.dumps(std), capture_output=True,
                          text=True, check=False, timeout=600)
    try:
        out: dict[str, Any] = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise CompileError(f"solc produced no JSON: {proc.stderr.strip()[:300]}") from e
    errors = [e for e in out.get("errors", []) if e.get("severity") == "error"]
    if errors:
        raise CompileError(errors[0].get("formattedMessage", errors[0].get("message", "compile error")).strip())
    return out


def _ast_state_var_names(output: dict[str, Any]) -> dict[int, str]:
    """AST id of every state variable → "Contract.var" (for immutableReferences)."""
    names: dict[int, str] = {}

    def walk(node: Any, contract: str | None) -> None:
        if isinstance(node, dict):
            if node.get("nodeType") == "ContractDefinition":
                contract = node.get("name")
            if node.get("nodeType") == "VariableDeclaration" and node.get("stateVariable") and contract:
                names[int(node["id"])] = f"{contract}.{node['name']}"
            for v in node.values():
                walk(v, contract)
        elif isinstance(node, list):
            for v in node:
                walk(v, contract)

    for src in output.get("sources", {}).values():
        walk(src.get("ast"), None)
    return names


def _as_address(word: bytes) -> int | None:
    word = word.rjust(32, b"\x00")[-32:]
    return int.from_bytes(word[12:], "big") if not any(word[:12]) else None


def deployed_values(output: dict[str, Any], file: str, name: str, m: Match, rpc: Rpc, storage_at: str,
                    block: int) -> dict[str, DeployedValue]:
    out: dict[str, DeployedValue] = {}
    names = _ast_state_var_names(output)
    for ast_id, words in m.immutables.items():
        addr = _as_address(words[0]) if words else None
        if addr is not None and ast_id in names:
            out[names[ast_id]] = DeployedValue(addr, "immutable", False)
    layout = output["contracts"][file][name].get("storageLayout") or {}
    types = layout.get("types") or {}
    for item in layout.get("storage", []):
        label = str(types.get(item["type"], {}).get("label", ""))
        if not label.startswith(("address", "contract ")):
            continue
        slot, off = int(item["slot"]), int(item["offset"])
        word = rpc.storage(storage_at, slot, block)  # a proxy's implementation reads the proxy's storage
        addr = int.from_bytes(word[32 - off - 20:32 - off], "big")
        declarer = str(item["contract"]).split(":")[-1]
        out[f"{declarer}.{item['label']}"] = DeployedValue(addr, "storage", True)
    return out


@dataclass(frozen=True)
class Resolved:
    target: Target
    block: int


def scan_address(address: str, *, chain: str, rpc_url: str, api_key: str, block: int | None = None) -> ScanResult:
    t0 = time.monotonic()
    chain_id = CHAINS[chain]
    rpc = Rpc(rpc_url)
    got = rpc.chain_id()
    if got != chain_id:  # CLAUDE.md gotcha #7: trust eth_chainId
        raise ChainMismatch(f"RPC reports chainId {got}, expected {chain_id} for {chain}")
    block = block if block is not None else rpc.block_number()
    target = classify(rpc, address, block)
    code_addr = target.implementation or address
    onchain = target.impl_code or target.code

    sc = smart_contract(chain_id, code_addr, api_key)
    rb = rebuild(sc)
    solc = ensure_solc(rb.compiler)
    output = run_solc(rb.standard_json, solc)
    artifact = output["contracts"][rb.file][rb.name]
    m = match_runtime(artifact["evm"]["deployedBytecode"], onchain)  # raises MatchFailed: never attested (I5)

    deployed = deployed_values(output, rb.file, rb.name, m, rpc, address, block)
    compiled = build_ir(rb.standard_json, solc)
    engine = analyze(compiled.slither, compiled.sources, {}, deployed, (rb.file, rb.name))

    unsupported = [{"function": f, "reason": r} for f, r in engine.unsupported]
    if target.kind == "contract" and _forwards_via_delegatecall(compiled.slither, rb.file, rb.name):
        unsupported.append({"function": f"{rb.name}.fallback()", "reason": "UNKNOWN_PROXY"})  # ADR-018
    settings = rb.standard_json["settings"]
    core = build_core(
        tool=tool_info(),
        target=target.as_json(chain_id),
        input_={
            "standardJsonHash": compiled.standard_json_hash,
            "compiler": rb.compiler,
            "evmVersion": settings.get("evmVersion", "default"),
            "optimizer": settings.get("optimizer", {"enabled": False}),
            "bytecodeMatch": m.as_json(),
            "bindingBlock": block,
        },
        bindings=[b.as_json() for b in engine.bindings.values()],
        findings=engine.findings_json(),
        functions_analyzed=len(engine.functions_analyzed),
        unsupported=unsupported,
    )
    meta = {"durationMs": int((time.monotonic() - t0) * 1000), "scannedAt": int(time.time()),
            "contract": f"{rb.file}:{rb.name}"}
    return ScanResult(core, report_hash(core), meta)


def _forwards_via_delegatecall(slither: Any, file: str, name: str) -> bool:
    """A verified contract whose fallback delegates is a proxy shell we could not classify."""
    for cu in slither.compilation_units:
        for c in cu.contracts:
            if (c.source_mapping.filename.used, c.name) != (file, name):
                continue
            for f in c.functions:
                if f.is_fallback or f.is_receive:
                    if any(str(getattr(ir, "function_name", "")) == "delegatecall" for ir in f.all_slithir_operations()):
                        return True
                    content = getattr(f.source_mapping, "content", "") if f.source_mapping else ""
                    if "delegatecall" in (content or ""):
                        return True
    return False
