"""Phase 0: dump SSA SlithIR for the probe contract so SLITHIR_NOTES.md is grounded in observed output.
Run: uv run --project analyzer python scripts/phase0/slithir_probe.py <path-to-solc-0.8.30>
"""
import copy
import json
import sys
from pathlib import Path

from crytic_compile import CryticCompile
from crytic_compile.platform.solc_standard_json import SolcStandardJson
from slither import Slither
from slither.core.declarations import SolidityVariableComposed
from slither.slithir.operations import HighLevelCall, LowLevelCall, Phi, Send, Transfer, TypeConversion, Binary
from slither.slithir.variables import Constant

solc = sys.argv[1]
src = Path(__file__).resolve().parents[2] / "analyzer/tests/fixtures/slithir_probe.sol"
std = {
    "language": "Solidity",
    "sources": {"probe/Probe.sol": {"content": src.read_text()}},
    "settings": {
        "evmVersion": "prague",
        "optimizer": {"enabled": True, "runs": 200, "details": {"yul": True}},
        "outputSelection": {"*": {"*": ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"], "": ["ast"]}},
    },
}
# crytic-compile resolves every source name against disk (naming._verify_filename_existence), so inline
# `content` alone raises "Unknown file". Materialize sources under a temp dir and point solc_working_dir at it.
import tempfile
work = Path(tempfile.mkdtemp(prefix="twelve-probe-"))
for name, s in std["sources"].items():
    (work / name).parent.mkdir(parents=True, exist_ok=True)
    (work / name).write_text(s["content"])
before = copy.deepcopy(std)
sl = Slither(CryticCompile(SolcStandardJson(std), solc=solc, solc_working_dir=str(work)))
print("INPUT MUTATED:", before != std)
print("  settings after:", json.dumps(std["settings"], sort_keys=True))

cu = sl.compilation_units[0]
c = cu.get_contract_from_name("Probe")[0]
for f in sorted(c.functions, key=lambda f: f.full_name):
    if f.contract_declarer != c:
        continue
    print(f"\n== {f.full_name}  src={f.source_mapping}")
    for n in f.nodes:
        for ir in n.irs_ssa:
            extra = ""
            if isinstance(ir, Binary):
                extra = f"  [Binary type={ir.type!r} left={type(ir.variable_left).__name__} right={type(ir.variable_right).__name__}]"
                for v in ir.read:
                    if isinstance(v, Constant):
                        extra += f" const(value={v.value!r}, original={v.original_value!r})"
            if isinstance(ir, LowLevelCall):
                extra = f"  [LLC dest={ir.destination}:{type(ir.destination).__name__} fn={ir.function_name} call_value={ir.call_value}:{type(ir.call_value).__name__}]"
            if isinstance(ir, HighLevelCall):
                extra = f"  [HLC dest={ir.destination}:{type(ir.destination).__name__} fn={ir.function_name} function={getattr(ir.function, 'canonical_name', ir.function)} args={[str(a) for a in ir.arguments]}]"
            if isinstance(ir, (Transfer, Send)):
                extra = f"  [{type(ir).__name__} dest={ir.destination} call_value={ir.call_value}:{type(ir.call_value).__name__}]"
            if isinstance(ir, Phi):
                extra = f"  [Phi lvalue={ir.lvalue} rvalues={[str(r) for r in ir.rvalues]}]"
            if isinstance(ir, TypeConversion):
                extra = f"  [TypeConversion var={ir.variable}:{type(ir.variable).__name__} to={ir.type}]"
            for v in getattr(ir, "read", []):
                if isinstance(v, SolidityVariableComposed):
                    extra += f"  [SVC name={v.name}]"
            print(f"  {type(ir).__name__:18} {ir}{extra}")
            if isinstance(ir, HighLevelCall) and str(ir.function_name) == "transfer":
                sm = ir.expression.source_mapping if ir.expression else n.source_mapping
                print(f"    source_mapping: start={sm.start} length={sm.length} lines={sm.lines} file.relative={sm.filename.relative!r} file.absolute={sm.filename.absolute!r} content={sm.content!r}")

print("\n== storage layout")
for v in c.state_variables_ordered:
    try:
        print(f"  {v.canonical_name}: constant={v.is_constant} immutable={v.is_immutable} stored={v.is_stored} slot/offset={cu.storage_layout_of(c, v) if v.is_stored else None}")
    except KeyError as e:
        print("  KeyError", e)
