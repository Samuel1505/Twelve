"""`twelve scan|verify|rules` (docs/ANALYZER.md §9). Exit codes: 0 CLEAN, 1 FINDINGS, 2 INCOMPLETE, 3 error."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from twelve.report import SEVERITY_ORDER
from twelve.rules import RULES

if TYPE_CHECKING:
    from twelve.scan import ScanResult

EXIT = {"CLEAN": 0, "FINDINGS": 1, "INCOMPLETE": 2}
CHAIN_BY_ID = {5042: "arc", 5042002: "arc-testnet"}


def _load_dotenv() -> None:
    """Fill missing env vars from the nearest .env (cwd upwards). Never overrides the real environment."""
    for d in [Path.cwd(), *Path.cwd().parents]:
        f = d / ".env"
        if f.is_file():
            for line in f.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


def error_code(e: BaseException) -> str:
    """Terminal scan errors of ARCHITECTURE §3, so callers (apps/api) never parse messages."""
    name = type(e).__name__
    return {
        "NotAContract": "NOT_A_CONTRACT",
        "UnsupportedTarget": "UNSUPPORTED",
        "Unsupported": "UNSUPPORTED",
        "NotVerified": "NOT_VERIFIED",
        "MatchFailed": "MATCH_FAILED",
        "CompileError": "COMPILE_FAILED",
        "ChainMismatch": "CHAIN_MISMATCH",
        "HttpError": "FETCH_FAILED",
        "RpcError": "FETCH_FAILED",
        "OSError": "CONFIG",
    }.get(name, "ANALYZER_ERROR")


def _progress(enabled: bool) -> Callable[[str], None]:
    def emit(stage: str) -> None:
        if enabled:
            print(json.dumps({"stage": stage}), file=sys.stderr, flush=True)

    return emit


def _scan_address(address: str, chain: str, block: int | None,
                  progress: Callable[[str], None] | None = None) -> ScanResult:
    from twelve.fetch.deployed import (
        scan_address,
    )

    _load_dotenv()
    rpc_var = "ARC_RPC_URL" if chain == "arc" else "ARC_TESTNET_RPC_URL"
    rpc, key = os.environ.get(rpc_var), os.environ.get("BLOCKSCOUT_API_KEY")
    missing = [n for n, v in ((rpc_var, rpc), ("BLOCKSCOUT_API_KEY", key)) if not v]
    if missing:
        raise OSError(f"missing env: {', '.join(missing)}")
    return scan_address(address, chain=chain, rpc_url=str(rpc), api_key=str(key), block=block,
                        progress=progress or (lambda _: None))


def _print_human(res: ScanResult) -> None:
    core = res.core
    for f in core["findings"]:
        loc = f["location"]
        print(f"{f['severity']:<6} {f['rule']} {loc['file']}:{loc['startLine']} "
              f"{f['contract']}.{f['function']} [{f['confidence']}]")
        print(f"       {f['message']}")
    match = core["input"].get("bytecodeMatch")
    extra = f"  match: {match['status']}" if match else ""
    print(f"verdict: {core['verdict']}  findings: {len(core['findings'])}{extra}  reportHash: {res.report_hash}")


def _cmd_scan(args: argparse.Namespace) -> int:
    from twelve.scan import scan_path

    try:
        if args.address:
            res = _scan_address(args.address, args.chain, args.block, _progress(args.progress))
        elif args.path:
            res = scan_path(Path(args.path), config_path=Path(args.config) if args.config else None,
                            solc=Path(args.solc) if args.solc else None)
        else:
            print("twelve: error: give a path or --address", file=sys.stderr)
            return 3
    except Exception as e:  # noqa: BLE001 - CLI boundary: every pipeline error is exit 3, named by class
        if args.json:
            print(json.dumps({"error": {"code": error_code(e), "type": type(e).__name__, "message": str(e)[:500]}}))
        print(f"twelve: error: {type(e).__name__}: {e}", file=sys.stderr)
        return 3
    if args.json:
        print(json.dumps(res.as_json(), indent=2, sort_keys=True))
    else:
        _print_human(res)
    if args.fail_on:
        threshold = SEVERITY_ORDER[args.fail_on]
        return 1 if any(SEVERITY_ORDER[f["severity"]] <= threshold for f in res.core["findings"]) else 0
    return EXIT[res.core["verdict"]]


def _cmd_verify(args: argparse.Namespace) -> int:
    """Recompute a deployed-mode report at its bindingBlock and compare reportHash (registry lookup: Phase 3)."""
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    core = report.get("reportCore", report)
    target = core["target"]
    claimed = report.get("reportHash") or args.expect
    try:
        res = _scan_address(target["address"], CHAIN_BY_ID[target["chainId"]], core["input"]["bindingBlock"])
    except Exception as e:  # noqa: BLE001
        print(f"twelve: error: {type(e).__name__}: {e}", file=sys.stderr)
        return 3
    ok = res.report_hash == claimed
    print(f"{'MATCH' if ok else 'MISMATCH'} recomputed {res.report_hash} claimed {claimed}")
    if not ok and res.core["tool"] != core["tool"]:
        print(f"note: tool differs: {res.core['tool']} vs {core['tool']}")
    return 0 if ok else 1


def _cmd_rules(_: argparse.Namespace) -> int:
    for rid in sorted(RULES):
        r = RULES[rid]
        print(f"{r.id}  {r.name:<22} {r.severity:<6}  {r.fix}")
    return 0


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="twelve")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="scan a .sol file/directory, or a deployed contract with --address")
    s.add_argument("path", nargs="?")
    s.add_argument("--address", help="deployed mode: verified contract address")
    s.add_argument("--chain", choices=["arc", "arc-testnet"], default="arc")
    s.add_argument("--block", type=int, help="pin chain reads to this block (default: latest)")
    s.add_argument("--json", action="store_true")
    s.add_argument("--config")
    s.add_argument("--solc", help="path to an exact solc build (default: svm/solc-select 0.8.30)")
    s.add_argument("--fail-on", choices=list(SEVERITY_ORDER))
    s.add_argument("--progress", action="store_true", help="emit {\"stage\": …} JSON lines on stderr")
    s.set_defaults(func=_cmd_scan)
    v = sub.add_parser("verify", help="recompute a deployed-mode report and compare its reportHash")
    v.add_argument("--report", required=True, help="JSON from `twelve scan --address … --json`")
    v.add_argument("--expect", help="reportHash to compare against if the file has none")
    v.set_defaults(func=_cmd_verify)
    r = sub.add_parser("rules", help="list rules")
    r.set_defaults(func=_cmd_rules)
    args = p.parse_args(argv)
    raise SystemExit(args.func(args))
