"""Phase 2 exit run: scan N verified Arc mainnet contracts in deployed mode.

Run: uv run --project analyzer python scripts/phase2-sample.py [N] [OUT_JSON]
Publishes per-address match data only; verdicts are aggregated (CORPUS_AND_TESTING §7: no third-party findings
before disclosure). Full per-contract reports stay in OUT_JSON, which must not be committed.
"""

import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, "analyzer")
from twelve.cli import _load_dotenv  # noqa: E402
from twelve.fetch.blockscout import list_verified  # noqa: E402
from twelve.fetch.deployed import scan_address  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/phase2-sample.json"
_load_dotenv()
key, rpc = os.environ["BLOCKSCOUT_API_KEY"], os.environ["ARC_RPC_URL"]

items = list_verified(5042, key, pages=int(os.environ.get("PAGES", "20")))
names: set[str] = set()
seen, rows, reports, failures = set(), [], {}, Counter()
for it in items:
    if len(rows) >= N:
        break
    addr = it["address"]["hash"]
    name = (it.get("address") or {}).get("name") or addr
    if it.get("language") != "solidity" or addr in seen or name in names:
        continue  # one per contract name: many launchpad tokens share code
    names.add(name)
    seen.add(addr)
    t0 = time.monotonic()
    try:
        res = scan_address(addr, chain="arc", rpc_url=rpc, api_key=key)
    except Exception as e:  # noqa: BLE001
        failures[type(e).__name__] += 1
        print(f"FAIL {addr} {type(e).__name__}: {str(e)[:160]}", flush=True)
        continue
    c = res.core
    rows.append({"address": addr, "name": res.meta["contract"].split(":")[-1], "compiler": c["input"]["compiler"],
                 "kind": c["target"]["kind"], "match": c["input"]["bytecodeMatch"]["status"],
                 "maskedRanges": len(c["input"]["bytecodeMatch"]["maskedRanges"]),
                 "seconds": round(time.monotonic() - t0, 1), "block": c["input"]["bindingBlock"]})
    reports[addr] = res.as_json()
    print(f"OK   {addr} {rows[-1]['name']} {rows[-1]['kind']} {rows[-1]['match']} {rows[-1]['seconds']}s", flush=True)

verdicts = Counter(r["reportCore"]["verdict"] for r in reports.values())
json.dump({"rows": rows, "failures": failures, "verdicts": verdicts, "reports": reports}, open(OUT, "w"), indent=2)
print(json.dumps({"scanned": len(rows), "failures": dict(failures), "verdicts": dict(verdicts)}))
