"""`twelve scan|rules` (docs/ANALYZER.md §9). Exit codes: 0 CLEAN, 1 FINDINGS, 2 INCOMPLETE, 3 error."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from twelve.compile import CompileError
from twelve.report import SEVERITY_ORDER
from twelve.rules import RULES

EXIT = {"CLEAN": 0, "FINDINGS": 1, "INCOMPLETE": 2}


def _cmd_scan(args: argparse.Namespace) -> int:
    from twelve.scan import scan_path

    try:
        res = scan_path(Path(args.path), config_path=Path(args.config) if args.config else None,
                        solc=Path(args.solc) if args.solc else None)
    except (CompileError, OSError) as e:
        print(f"twelve: error: {e}", file=sys.stderr)
        return 3
    core = res.core
    if args.json:
        print(json.dumps(res.as_json(), indent=2, sort_keys=True))
    else:
        for f in core["findings"]:
            loc = f["location"]
            print(f"{f['severity']:<6} {f['rule']} {loc['file']}:{loc['startLine']} "
                  f"{f['contract']}.{f['function']} [{f['confidence']}]")
            print(f"       {f['message']}")
        print(f"verdict: {core['verdict']}  findings: {len(core['findings'])}  reportHash: {res.report_hash}")
    if args.fail_on:
        threshold = SEVERITY_ORDER[args.fail_on]
        return 1 if any(SEVERITY_ORDER[f["severity"]] <= threshold for f in core["findings"]) else 0
    return EXIT[core["verdict"]]


def _cmd_rules(_: argparse.Namespace) -> int:
    for rid in sorted(RULES):
        r = RULES[rid]
        print(f"{r.id}  {r.name:<22} {r.severity:<6}  {r.fix}")
    return 0


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="twelve")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="scan a .sol file or directory (pre-deploy mode)")
    s.add_argument("path")
    s.add_argument("--json", action="store_true")
    s.add_argument("--config")
    s.add_argument("--solc", help="path to an exact solc build (default: svm/solc-select 0.8.30)")
    s.add_argument("--fail-on", choices=list(SEVERITY_ORDER))
    s.set_defaults(func=_cmd_scan)
    r = sub.add_parser("rules", help="list rules")
    r.set_defaults(func=_cmd_rules)
    args = p.parse_args(argv)
    raise SystemExit(args.func(args))
