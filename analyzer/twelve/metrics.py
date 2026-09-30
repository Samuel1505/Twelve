"""Corpus metrics (docs/CORPUS_AND_TESTING.md §1, §3).

    uv run python -m twelve.metrics ../corpus                 # table + gate
    uv run python -m twelve.metrics ../corpus --write-expect  # regenerate expect.json from `// @expect` markers
    uv run python -m twelve.metrics ../corpus --write         # also write corpus/METRICS.md
    uv run python -m twelve.metrics ../corpus --update-baseline

Gate (exit 1): HIGH recall < 100%, any HIGH on a safe twin / hard negative, or regression vs METRICS.baseline.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from twelve.report import SEVERITY_ORDER
from twelve.scan import scan_path

_MARKER = re.compile(r"//\s*@expect\s+(TW-\d{3})\s+(HIGH|MEDIUM|LOW|INFO)\s+(\S+)")


def expectations_from_markers(sol: Path) -> list[dict[str, Any]]:
    out = []
    for lineno, line in enumerate(sol.read_text(encoding="utf-8").splitlines(), start=1):
        for m in _MARKER.finditer(line):
            out.append({"rule": m.group(1), "severity": m.group(2), "function": m.group(3), "line": lineno})
    return sorted(out, key=lambda e: (e["line"], e["rule"]))


def write_expect(case: Path) -> None:
    bug = case / "bug.sol"
    findings = expectations_from_markers(bug) if bug.is_file() else []
    blocking = any(f["severity"] in ("HIGH", "MEDIUM") for f in findings)
    data: dict[str, Any] = {"findings": findings, "verdict": "FINDINGS" if blocking else "CLEAN",
                            "safeVerdict": "CLEAN"}
    old = case / "expect.json"
    if old.is_file():
        prev = json.loads(old.read_text(encoding="utf-8"))
        for keep in ("deployed", "allowedExtra"):
            if keep in prev:
                data[keep] = prev[keep]
    (case / "expect.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


@dataclass
class RuleStats:
    expected: int = 0
    matched: int = 0
    emitted_bug: int = 0
    safe_fp: int = 0


@dataclass
class Result:
    per_rule: dict[str, RuleStats] = field(default_factory=lambda: defaultdict(RuleStats))
    high_expected: int = 0
    high_matched: int = 0
    high_safe_fp: int = 0
    failures: list[str] = field(default_factory=list)
    cases: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _key(f: dict[str, Any]) -> tuple[str, str, int]:
    return (f["rule"], f["function"], f["location"]["startLine"] if "location" in f else f["line"])


def _deployed_scanner() -> Any:
    from twelve.cli import _scan_address

    return _scan_address


def evaluate(corpus: Path, deployed: bool = False) -> Result:
    res = Result()
    scan_addr = _deployed_scanner() if deployed else None
    for case in sorted(p for p in corpus.iterdir() if p.is_dir() and re.match(r"[ch]\d\d_", p.name)):
        bug, safe, exp_path = case / "bug.sol", case / "safe.sol", case / "expect.json"
        expect = json.loads(exp_path.read_text(encoding="utf-8")) if exp_path.is_file() else {"findings": []}
        dep = expect.get("deployed")
        if dep is not None and scan_addr is None:
            res.skipped.append(case.name)  # binding only exists on chain (ANALYZER §3.2): needs --deployed
            continue
        if dep is None and scan_addr is not None:
            continue
        res.cases.append(case.name)

        def findings_of(which: str, path: Path, dep: dict[str, str] | None = dep) -> list[dict[str, Any]]:
            if dep is not None:
                assert scan_addr is not None
                core: dict[str, Any] = scan_addr(dep[which], dep["chain"], None).core
                return list(core["findings"])
            return list(scan_path(path).core["findings"])

        if bug.is_file():
            allowed = {(a["rule"], a["function"], a["line"]) for a in expect.get("allowedExtra", [])}
            got = findings_of("bug", bug)
            got_keys = {_key(f) for f in got}
            for e in expect["findings"]:
                st = res.per_rule[e["rule"]]
                st.expected += 1
                hit = _key(e) in got_keys
                st.matched += hit
                if e["severity"] == "HIGH":
                    res.high_expected += 1
                    res.high_matched += hit
                if not hit:
                    res.failures.append(f"{case.name}: missed {e['rule']} {e['function']}:{e['line']}")
            exp_keys = {_key(e) for e in expect["findings"]}
            for f in got:
                res.per_rule[f["rule"]].emitted_bug += 1
                if _key(f) not in exp_keys and _key(f) not in allowed:
                    res.failures.append(f"{case.name}: unexpected {f['rule']} {f['severity']} "
                                        f"{f['function']}:{f['location']['startLine']} (bug.sol)")
        if safe.is_file():
            for f in findings_of("safe", safe):
                if SEVERITY_ORDER[f["severity"]] <= SEVERITY_ORDER["LOW"]:
                    res.per_rule[f["rule"]].safe_fp += 1
                    res.high_safe_fp += f["severity"] == "HIGH"
                    res.failures.append(f"{case.name}: false positive {f['rule']} {f['severity']} "
                                        f"{f['function']}:{f['location']['startLine']} (safe.sol)")
    return res


def _pct(n: int, d: int) -> str:
    return "—" if d == 0 else f"{100 * n / d:.0f}%"


def table(res: Result) -> str:
    lines = [
        "| Rule | Expected | Matched | Recall | Emitted (bug) | Precision | Safe-twin FP (≥LOW) |",
        "|---|---|---|---|---|---|---|",
    ]
    tot = RuleStats()
    for rule in sorted(res.per_rule):
        s = res.per_rule[rule]
        tot.expected += s.expected
        tot.matched += s.matched
        tot.emitted_bug += s.emitted_bug
        tot.safe_fp += s.safe_fp
        lines.append(f"| {rule} | {s.expected} | {s.matched} | {_pct(s.matched, s.expected)} | {s.emitted_bug} | "
                     f"{_pct(s.matched, s.emitted_bug)} | {s.safe_fp} |")
    lines.append(f"| **all** | {tot.expected} | {tot.matched} | {_pct(tot.matched, tot.expected)} | "
                 f"{tot.emitted_bug} | {_pct(tot.matched, tot.emitted_bug)} | {tot.safe_fp} |")
    lines.append("")
    lines.append(f"HIGH recall: {res.high_matched}/{res.high_expected} "
                 f"({_pct(res.high_matched, res.high_expected)}) · HIGH safe-twin FP: {res.high_safe_fp} · "
                 f"cases: {len(res.cases)}" + (f" · deployed-only (run with --deployed): {', '.join(res.skipped)}"
                                              if res.skipped else ""))
    return "\n".join(lines)


def baseline_of(res: Result) -> dict[str, Any]:
    return {
        "highRecall": [res.high_matched, res.high_expected],
        "highSafeFp": res.high_safe_fp,
        "rules": {r: {"matched": s.matched, "expected": s.expected, "safeFp": s.safe_fp}
                  for r, s in sorted(res.per_rule.items())},
    }


def regressions(res: Result, baseline: dict[str, Any]) -> list[str]:
    out = []
    for rule, b in baseline.get("rules", {}).items():
        s = res.per_rule.get(rule, RuleStats())
        if s.matched < b["matched"]:
            out.append(f"{rule}: matched {s.matched} < baseline {b['matched']}")
        if s.safe_fp > b["safeFp"]:
            out.append(f"{rule}: safe-twin FP {s.safe_fp} > baseline {b['safeFp']}")
    return out


def main() -> None:
    p = argparse.ArgumentParser(prog="twelve.metrics")
    p.add_argument("corpus")
    p.add_argument("--write-expect", action="store_true")
    p.add_argument("--write", action="store_true", help="write METRICS.md")
    p.add_argument("--update-baseline", action="store_true")
    p.add_argument("--deployed", action="store_true",
                   help="evaluate only cases with a `deployed` block, by scanning their testnet addresses")
    a = p.parse_args()
    corpus = Path(a.corpus)
    if a.write_expect:
        for case in sorted(c for c in corpus.iterdir() if c.is_dir() and (c / "bug.sol").is_file()):
            write_expect(case)
    res = evaluate(corpus, deployed=a.deployed)
    t = table(res)
    print(t)
    for f in res.failures:
        print(f"  - {f}")
    if a.write and a.deployed:
        (corpus / "METRICS.deployed.md").write_text(
            "# Corpus metrics — deployed mode (Arc testnet)\n\nGenerated by "
            "`uv run python -m twelve.metrics ../corpus --deployed --write`.\n\n" + t + "\n", encoding="utf-8")
    elif a.write:
        (corpus / "METRICS.md").write_text(
            "# Corpus metrics\n\nGenerated by `uv run python -m twelve.metrics ../corpus --write`.\n\n" + t + "\n",
            encoding="utf-8")
    base_path = corpus / ("METRICS.deployed.baseline.json" if a.deployed else "METRICS.baseline.json")
    if a.update_baseline:
        base_path.write_text(json.dumps(baseline_of(res), indent=2) + "\n", encoding="utf-8")
    gate: list[str] = []
    if res.high_matched < res.high_expected:
        gate.append("HIGH recall below 100%")
    if res.high_safe_fp:
        gate.append("HIGH false positive on a safe file")
    if base_path.is_file():
        gate += regressions(res, json.loads(base_path.read_text(encoding="utf-8")))
    for g in gate:
        print(f"GATE FAIL: {g}", file=sys.stderr)
    sys.exit(1 if gate else 0)


if __name__ == "__main__":
    main()
