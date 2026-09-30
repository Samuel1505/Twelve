"""twelve.dataflow — decimal-unit dataflow over SlithIR SSA (docs/ANALYZER.md §4).

Structure:
- `Engine`: one scan. Picks most-derived target contracts, collects findings/bindings/coverage.
- `ContractAnalysis`: storage cells + whole-contract fixpoint (§4.2), TW-005 detection, call summaries (§4.1).
- `FunctionAnalysis`: per-function fixpoint over `irs_ssa`; transfer functions, source/sink checks.

Attribute names follow analyzer/SLITHIR_NOTES.md (slither-analyzer 0.11.6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from slither.core.declarations import (
    Contract,
    Function,
    SolidityFunction,
    SolidityVariable,
    SolidityVariableComposed,
)
from slither.core.expressions import BinaryOperation, Identifier, Literal
from slither.core.expressions import TypeConversion as TypeConversionExpr
from slither.core.variables.local_variable import LocalVariable
from slither.core.variables.state_variable import StateVariable
from slither.core.variables.top_level_variable import TopLevelVariable
from slither.slithir.operations import (
    Assignment,
    Binary,
    BinaryType,
    HighLevelCall,
    Index,
    InternalCall,
    Length,
    LibraryCall,
    LowLevelCall,
    Member,
    OperationWithLValue,
    Phi,
    PhiCallback,
    Return,
    Send,
    SolidityCall,
    Transfer,
    TypeConversion,
    Unpack,
)
from slither.slithir.variables import Constant, ReferenceVariable, TupleVariable
from slither.utils.integer_conversion import convert_string_to_int

from twelve import lattice as L
from twelve.bindings import Binding, StaticBindings, doc_comment_above, param_unit_annotations
from twelve.lattice import BOT, TOP, Collision, CollisionKind, Conf, Kind, TraceStep, Value
from twelve.report import hex_keccak
from twelve.rules import RULES, cap
from twelve.sources_sinks import (
    ERC20_AMOUNT_GETTERS,
    ERC20_DECIMALS_GETTER,
    ERC20_LIBRARY_SINKS,
    ERC20_SINKS,
    MINMAX_FUNCTIONS,
    MULDIV_FUNCTIONS,
    NATIVE_SOLIDITY_VARIABLES,
    SOLIDITY_CALL_UNITS,
    TYPED_UNITS,
    USDC_DECIMALS,
    USDC_ERC20_ADDRESS,
)
from twelve.units import (
    DIMENSIONLESS,
    ERC20,
    NATIVE,
    SUBDENOMINATION_UNITS,
    Unit,
    is_view_conversion_scale,
)

# Yul builtins that move funds or write storage (SolidityFunction names are full descriptors, e.g. "call(uint256,…)").
YUL_EFFECTFUL_BUILTINS = ("call(", "callcode(", "sstore(", "create(", "create2(", "selfdestruct(")

MAX_CONTRACT_ITERATIONS = 20
MAX_FUNCTION_PASSES = 12
MAX_CALL_DEPTH = 8
MAX_TRACE = 16

CellKey = tuple[str, ...]
Root = tuple[str, CellKey]  # ("cell" | "local", key)

_COMPARISONS = {
    BinaryType.LESS,
    BinaryType.GREATER,
    BinaryType.LESS_EQUAL,
    BinaryType.GREATER_EQUAL,
    BinaryType.EQUAL,
    BinaryType.NOT_EQUAL,
}

# ------------------------------------------------------------------------------------------------ locations


@dataclass(frozen=True, order=True)
class Site:
    file: str
    start_line: int
    start_col: int
    end_line: int
    end_col: int

    @property
    def loc(self) -> str:
        return f"{self.file}:{self.start_line}"

    @property
    def span(self) -> str:
        return f"{self.file}:{self.start_line}:{self.start_col}:{self.end_line}:{self.end_col}"

    def as_json(self) -> dict[str, Any]:
        return {"file": self.file, "startLine": self.start_line, "endLine": self.end_line,
                "startCol": self.start_col, "endCol": self.end_col}


def _sm_of(obj: Any) -> Any:
    expr = getattr(obj, "expression", None)
    if expr is not None and getattr(expr, "source_mapping", None) is not None and expr.source_mapping.lines:
        return expr.source_mapping
    node = getattr(obj, "node", None)
    return node.source_mapping if node is not None else obj.source_mapping


def site_of(obj: Any) -> Site:
    sm = _sm_of(obj)
    lines = sm.lines or [0]
    return Site(sm.filename.used, lines[0], sm.starting_column, lines[-1], sm.ending_column)


def text_of(obj: Any) -> str:
    try:
        t = " ".join(_sm_of(obj).content.split())
    except Exception:  # noqa: BLE001 - content lookup can fail for synthetic nodes
        t = str(obj)
    return t if len(t) <= 120 else t[:117] + "..."


def _step(step: str, expr: str, site: Site, unit: Unit | None = None, expects: Unit | None = None) -> TraceStep:
    return TraceStep(step, expr, site.loc,
                     (unit.dim, unit.exp) if unit is not None else None,
                     (expects.dim, expects.exp) if expects is not None else None)


# ------------------------------------------------------------------------------------------------ findings


@dataclass(frozen=True)
class Operand:
    value: Value
    expr: str

    def as_json(self) -> dict[str, Any]:
        v = self.value
        unit: list[int] | str | None
        if v.kind is Kind.UNIT and v.unit is not None:
            unit = v.unit.as_json()
        elif v.kind is Kind.TOKEN:
            unit = f"Token({v.token})"
        elif v.kind is Kind.LIT:
            unit = "literal"
        else:
            unit = None
        return {"unit": unit, "expr": self.expr}


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    conf: Conf
    contract: str
    function: str
    site: Site
    left: Operand | None
    right: Operand | None
    trace: tuple[TraceStep, ...]
    direction: str = "default"

    @property
    def id(self) -> str:
        return hex_keccak(f"{self.rule}|{self.contract}|{self.function}|{self.site.span}".encode())

    def as_json(self) -> dict[str, Any]:
        rule = RULES[self.rule]
        d: dict[str, Any] = {
            "id": self.id,
            "rule": self.rule,
            "severity": self.severity,
            "confidence": self.conf.name,
            "contract": self.contract,
            "function": self.function,
            "location": self.site.as_json(),
            "trace": [s.as_json() for s in self.trace],
            "message": rule.messages.get(self.direction, rule.messages.get("default", "")),
            "fix": rule.fix,
        }
        if self.left is not None:
            d["left"] = self.left.as_json()
        if self.right is not None:
            d["right"] = self.right.as_json()
        return d


def _trace_len_key(f: Finding) -> tuple[int, tuple[TraceStep, ...]]:
    return (len(f.trace), f.trace)


# ------------------------------------------------------------------------------------------------ engine


def typed_unit(t: Any) -> Unit | None:
    """Unit of a Guard UDVT (Usdc6/Usdc18), else None."""
    if t is None or type(t).__name__ not in ("TypeAliasTopLevel", "TypeAliasContract", "TypeAlias"):
        return None
    return TYPED_UNITS.get(str(t).split(".")[-1])


def _is_state(v: Any) -> bool:
    return isinstance(v, (StateVariable, TopLevelVariable))


def _base(v: Any) -> Any:
    return getattr(v, "non_ssa_version", v)


def _key(v: Any) -> str:
    return f"{type(_base(v)).__name__}:{v}"


def _core(v: Value) -> tuple[object, ...]:
    return (v.kind, v.unit, v.lit, v.token, v.conf, v.trunc)


@dataclass
class Write:
    key: CellKey
    value: Value
    site: Site
    function: str
    contract: str


@dataclass(frozen=True)
class DeployedValue:
    """An address-typed state variable read from chain (ANALYZER §3.2)."""

    address: int
    method: str  # immutable | storage
    mutable: bool


class Engine:
    def __init__(self, slither: Any, sources: dict[str, str], config: dict[str, str],
                 deployed: dict[str, DeployedValue] | None = None,
                 target: tuple[str, str] | None = None) -> None:
        self.slither = slither
        self.sources = sources
        self.deployed = deployed or {}
        self.target = target  # (source unit, contract name) in deployed mode
        self.static = StaticBindings(sources, config)
        self.findings: dict[str, Finding] = {}
        self.unsupported: set[tuple[str, str]] = set()
        self.bindings: dict[str, Binding] = {}
        self.functions_analyzed: set[str] = set()
        self._const_cache: dict[str, Value] = {}

    # ---- targets
    def targets(self) -> list[Any]:
        out = []
        for cu in self.slither.compilation_units:
            for c in cu.contracts:
                if self.target is not None:
                    if (c.source_mapping.filename.used, c.name) == self.target:
                        out.append(c)
                    continue
                if c.is_interface or c.is_library or c.derived_contracts:
                    continue
                out.append(c)
        return sorted(out, key=lambda c: (c.source_mapping.filename.used, c.name))

    def run(self) -> None:
        for c in self.targets():
            ContractAnalysis(self, c).run()

    # ---- results
    def add_finding(self, f: Finding) -> None:
        prev = self.findings.get(f.id)
        if prev is None or _trace_len_key(f) < _trace_len_key(prev):
            self.findings[f.id] = f

    def findings_json(self) -> list[dict[str, Any]]:
        return [f.as_json() for f in self.findings.values()]

    # ---- constants (§3.1): evaluate declaration expressions
    def const_value(self, var: Any) -> Value:
        k = var.canonical_name if hasattr(var, "canonical_name") else str(var)
        if k not in self._const_cache:
            self._const_cache[k] = TOP  # recursion guard
            self._const_cache[k] = self._eval_expr(var.expression)
        return self._const_cache[k]

    def _eval_expr(self, e: Any) -> Value:
        if e is None:
            return TOP
        if isinstance(e, Literal):
            sub = e.subdenomination
            if sub in SUBDENOMINATION_UNITS and sub != "wei":
                return Value.of(SUBDENOMINATION_UNITS[sub], Conf.HEURISTIC)
            try:
                return Value.literal(convert_string_to_int(e.value))
            except (ValueError, TypeError):
                return TOP
        if isinstance(e, TypeConversionExpr):
            tu = typed_unit(e.type)
            return Value.of(tu) if tu is not None else self._eval_expr(e.expression)
        if isinstance(e, Identifier):
            v = e.value
            if isinstance(v, (StateVariable, TopLevelVariable)) and v.is_constant:
                return self.const_value(v)
            return TOP
        if isinstance(e, BinaryOperation):
            a, b = self._eval_expr(e.expression_left), self._eval_expr(e.expression_right)
            op = str(e.type.value) if hasattr(e.type, "value") else str(e.type)
            if op == "**":
                return L.power(a, b)
            if op == "*":
                return L.mul(a, b)
            if op == "/":
                return L.div(a, b)
            if op in ("+", "-"):
                folded = L.fold_literals(op, a, b)
                return folded if folded is not None else L.check_equal(a, b)[0]
            return TOP
        return TOP


class ContractAnalysis:
    def __init__(self, engine: Engine, contract: Any) -> None:
        self.e = engine
        self.c = contract
        self.cells: dict[CellKey, Value] = {}
        self.poisoned: dict[CellKey, tuple[Write, Write]] = {}
        self.amount_writers: dict[CellKey, dict[tuple[Site, Unit], Write]] = {}
        self.writes: list[Write] = []
        self.summaries: dict[tuple[object, ...], tuple[Value, ...]] = {}
        self.emit = False
        self.roots = sorted(
            (f for f in contract.functions_and_modifiers if f.is_implemented),
            key=lambda f: f.canonical_name,
        )

    def run(self) -> None:
        for _ in range(MAX_CONTRACT_ITERATIONS):
            self._iterate()
            new = self._join_writes()
            if {k: _core(v) for k, v in new.items()} == {k: _core(v) for k, v in self.cells.items()}:
                break
            self.cells = new
        else:
            self.cells = {k: TOP for k in self.cells}
        self.emit = True
        self._iterate()
        self._report_merges()

    def _iterate(self) -> None:
        self.writes = []
        self.summaries = {}
        for f in self.roots:
            FunctionAnalysis(self, f, None, (), live=True).run()

    def _join_writes(self) -> dict[CellKey, Value]:
        new = dict(self.cells)
        for w in sorted(self.writes, key=lambda w: (w.key, w.site, w.function)):
            if w.key in self.poisoned:
                new[w.key] = TOP
                continue
            if w.value.amount_unit is not None:
                self.amount_writers.setdefault(w.key, {}).setdefault((w.site, w.value.amount_unit), w)
            joined, merge = L.join(new.get(w.key, BOT), w.value)
            if merge is not None:
                pair = self._conflicting_pair(w.key)
                if pair is not None:
                    self.poisoned[w.key] = pair
            new[w.key] = joined
        return new

    def _conflicting_pair(self, key: CellKey) -> tuple[Write, Write] | None:
        ws = sorted(self.amount_writers.get(key, {}).values(), key=lambda w: (w.site, w.function))
        if not ws:
            return None
        first = ws[0]
        for w in ws[1:]:
            if w.value.amount_unit != first.value.amount_unit:
                return first, w
        return None

    def _report_merges(self) -> None:
        for key, (w1, w2) in sorted(self.poisoned.items()):
            u1, u2 = w1.value.amount_unit, w2.value.amount_unit
            if {u1, u2} != {NATIVE, ERC20}:
                continue  # a view merged with a non-view exponent looks like fixed-point math (ADR-019)
            rule = "TW-005"
            conf = min(w1.value.conf, w2.value.conf)
            sev = RULES[rule].severity
            if rule == "TW-005" and not (w1.value.conf is Conf.DEFINITE and w2.value.conf is Conf.DEFINITE):
                sev = "MEDIUM"
            self.e.add_finding(Finding(
                rule, cap(sev, conf), conf, w2.contract, w2.function, w2.site,
                Operand(w1.value, w1.value.trace[0].expr if w1.value.trace else ".".join(key)),
                Operand(w2.value, w2.value.trace[0].expr if w2.value.trace else ".".join(key)),
                (w1.value.trace + w2.value.trace)[:MAX_TRACE],
            ))

    # ---- storage
    def load(self, key: CellKey, site: Site) -> Value:
        if key in self.poisoned:
            return TOP
        v = self.cells.get(key, BOT)
        if v.kind in (Kind.UNIT, Kind.TOKEN):
            v = v.with_conf(Conf.INFERRED)
            if len(v.trace) < MAX_TRACE:
                v = v.with_step(_step("load", ".".join(key), site, v.unit))
        return v

    # ---- calls (§4.1)
    def call(self, fn: Any, args: tuple[Value, ...], stack: tuple[str, ...], live: bool) -> tuple[Value, ...]:
        name = fn.canonical_name
        n_ret = max(1, len(fn.returns))
        if name in stack or len(stack) >= MAX_CALL_DEPTH or not fn.is_implemented:
            return (TOP,) * n_ret
        key = (name, tuple(_core(a) for a in args), live, self.emit)
        if key not in self.summaries:
            self.summaries[key] = (TOP,) * n_ret  # recursion placeholder
            self.summaries[key] = FunctionAnalysis(self, fn, args, stack, live).run()
        return self.summaries[key]


@dataclass
class _Constraint:
    node: Any
    unit: Unit
    expr: str


@dataclass
class FunctionAnalysis:
    ca: ContractAnalysis
    fn: Any
    args: tuple[Value, ...] | None
    stack: tuple[str, ...]
    live: bool
    env: dict[str, Value] = field(default_factory=dict)
    tuples: dict[str, tuple[Value, ...]] = field(default_factory=dict)
    ref_roots: dict[str, Root] = field(default_factory=dict)
    local_cells: dict[CellKey, Value] = field(default_factory=dict)
    returns: list[Value] = field(default_factory=list)
    mod_keys: set[str] = field(default_factory=set)
    constraints: dict[str, list[_Constraint]] = field(default_factory=dict)
    param_values: dict[str, Value] = field(default_factory=dict)
    committing: bool = False
    touches_value: bool = False
    has_asm: bool = False

    # ---------------------------------------------------------------- driver
    def run(self) -> tuple[Value, ...]:
        fn = self.fn
        self.ca.e.functions_analyzed.add(f"{fn.contract_declarer.name}.{fn.full_name}")
        self._init_params()
        ops = [(n, ir) for n in fn.nodes for ir in n.irs_ssa]
        for _ in range(MAX_FUNCTION_PASSES):
            before = self._snapshot()
            self._pass(ops)
            if self._snapshot() == before:
                break
        self.committing = True
        self._pass(ops)
        if self.has_asm and self.touches_value:
            self.ca.e.unsupported.add((f"{fn.contract_declarer.name}.{fn.full_name}", "UNSUPPORTED_ASM"))
        n_ret = max(1, len(fn.returns))
        rets = list(self.returns) + [TOP] * (n_ret - len(self.returns))
        return tuple(r if r.kind is not Kind.BOT else TOP for r in rets[:n_ret])

    def _snapshot(self) -> tuple[object, ...]:
        return (
            tuple(sorted((k, _core(v)) for k, v in self.env.items())),
            tuple(sorted((k, tuple(_core(x) for x in t)) for k, t in self.tuples.items())),
            tuple(sorted((k, _core(v)) for k, v in self.local_cells.items())),
            tuple(sorted((k, len(c)) for k, c in self.constraints.items())),
            tuple(sorted(self.mod_keys)),
        )

    def _init_params(self) -> None:
        fn = self.fn
        annotations: dict[str, str] = {}
        if self.args is None:
            src = self.ca.e.sources.get(fn.source_mapping.filename.used)
            if src is not None:
                annotations = param_unit_annotations(doc_comment_above(src, fn.source_mapping.start))
        params = list(fn.parameters_ssa) if fn.parameters_ssa else list(fn.parameters)
        site = site_of(fn)
        for i, p in enumerate(params):
            base = _base(p)
            tu = typed_unit(base.type)
            if tu is not None:
                v = Value.of(tu, Conf.DEFINITE, (_step("source", base.name, site, tu),))
            elif self.args is not None:
                v = self.args[i] if i < len(self.args) else TOP
            elif base.name in annotations:
                u = ERC20 if annotations[base.name] == "usdc6" else NATIVE
                v = Value.of(u, Conf.DEFINITE, (_step("source", f"{base.name} (@custom:twelve-unit)", site, u),))
            else:
                v = TOP
            # keyed by declared name: the body reads SSA versions (amount_1) that differ from parameters_ssa
            self.param_values[base.name] = v

    def _pass(self, ops: list[tuple[Any, Any]]) -> None:
        self.returns = []
        for node, ir in ops:
            if getattr(getattr(node, "scope", None), "is_yul", False):
                if self._asm_touches_state(ir):
                    self.has_asm = True
                if isinstance(ir, OperationWithLValue) and ir.lvalue is not None:
                    self._set(ir.lvalue, TOP, site_of(ir))
                continue
            self._op(node, ir)

    def _solidity_locals(self) -> list[Any]:
        fn = self.fn
        declared = [n.variable_declaration for n in fn.nodes
                    if n.variable_declaration is not None and not getattr(n.scope, "is_yul", False)]
        return [*fn.parameters, *fn.returns, *declared]

    def _asm_touches_state(self, ir: Any) -> bool:
        """Assembly counts as unsupported only if it can change a tracked value or move funds (§4 table):
        it assigns a Solidity-declared local/state variable, writes storage, or makes a value-carrying call.
        Revert bubbling, memory copies and pure math on Yul locals do not."""
        if isinstance(ir, SolidityCall):
            name = ir.function.name if isinstance(ir.function, SolidityFunction) else str(ir.function)
            if name.startswith(YUL_EFFECTFUL_BUILTINS):
                return True
        lv = getattr(ir, "lvalue", None)
        if lv is None:
            return False
        base = _base(lv)
        return _is_state(base) or any(base is v for v in self._solidity_locals())

    # ---------------------------------------------------------------- values
    def value(self, v: Any, node: Any, site: Site) -> Value:
        if isinstance(v, Constant):
            if isinstance(v.value, bool) or not isinstance(v.value, int):
                return TOP
            sub = getattr(v, "_subdenomination", None)  # private in 0.11.6, see SLITHIR_NOTES §2
            if sub in SUBDENOMINATION_UNITS and sub != "wei":
                u = SUBDENOMINATION_UNITS[sub]
                return Value.of(u, Conf.HEURISTIC, (_step("source", f"{v.original_value} {sub}", site, u),))
            return Value.literal(v.value)
        if isinstance(v, SolidityVariableComposed):
            if v.name in NATIVE_SOLIDITY_VARIABLES:
                self.touches_value = True
                return Value.of(NATIVE, Conf.DEFINITE, (_step("source", v.name, site, NATIVE),))
            return TOP
        if isinstance(v, (SolidityVariable, Function, Contract)):
            return TOP
        base = _base(v)
        tu = typed_unit(getattr(base, "type", None))
        if tu is not None:
            return Value.of(tu, Conf.DEFINITE, (_step("source", str(getattr(base, "name", v)), site, tu),))
        if _is_state(base):
            if base.is_constant:
                return self.ca.e.const_value(base)
            dep = self.ca.e.deployed.get(base.canonical_name)
            if dep is not None:
                return Value.literal(dep.address)
            return self.ca.load((base.canonical_name,), site)
        got = self.env.get(_key(v), BOT)
        if got.kind is Kind.BOT and self._is_param(base):
            got = self.param_values.get(base.name, TOP)
        if got.kind is Kind.TOP and self._is_param(base):
            inferred = self._inferred_param(base, node, site)
            if inferred is not None:
                return inferred
        return got

    def _is_param(self, base: Any) -> bool:
        return isinstance(base, LocalVariable) and any(base is p for p in self.fn.parameters)

    def _inferred_param(self, base: Any, node: Any, site: Site) -> Value | None:
        """Backward inference (c16): a sink that dominates this read fixes the parameter's view."""
        cs = [c for c in self.constraints.get(base.name, []) if c.node is not node and c.node in node.dominators]
        units = {c.unit for c in cs}
        if len(units) != 1:
            return None
        c = min(cs, key=lambda c: site_of(c.node))
        return Value.of(c.unit, Conf.INFERRED,
                        (_step("source", f"{base.name} (inferred from {c.expr})", site_of(c.node), c.unit),))

    def _add_constraint(self, v: Any, node: Any, unit: Unit, expr: str) -> None:
        base = _base(v)
        if not self._is_param(base) or self.param_values.get(base.name, TOP).kind is not Kind.TOP \
                or _key(v) in self.env:
            return
        lst = self.constraints.setdefault(base.name, [])
        if not any(c.node is node for c in lst):
            lst.append(_Constraint(node, unit, expr))

    # ---------------------------------------------------------------- roots / storage
    def _root_of(self, v: Any) -> Root | None:
        if isinstance(v, ReferenceVariable):
            return self.ref_roots.get(_key(v))
        base = _base(v)
        if _is_state(base) and not base.is_constant:
            return ("cell", (base.canonical_name,))
        if isinstance(base, LocalVariable):
            return ("local", (base.name,))
        return None

    def _read_root(self, root: Root | None, site: Site) -> Value:
        if root is None:
            return TOP
        kind, key = root
        if kind == "cell":
            return self.ca.load(key, site)
        return self.local_cells.get(key, BOT)

    def _set(self, lv: Any, val: Value, site: Site, write: Value | None = None) -> None:
        """Assign `val` to lvalue; state/reference lvalues also write storage (`write` overrides what is stored)."""
        tu = typed_unit(getattr(_base(lv), "type", None))
        if tu is not None and val.kind is not Kind.UNIT:
            val = Value.of(tu, Conf.DEFINITE, val.trace)
        self.env[_key(lv)] = val
        root: Root | None = None
        if isinstance(lv, ReferenceVariable):
            root = self.ref_roots.get(_key(lv))
        elif _is_state(_base(lv)):
            root = ("cell", (_base(lv).canonical_name,))
        if root is None:
            return
        stored = write if write is not None else val
        kind, key = root
        if kind == "local":
            self.local_cells[key] = L.join(self.local_cells.get(key, BOT), stored)[0]
            return
        if self.committing and self.live and stored.kind is not Kind.BOT:
            if stored.kind is Kind.UNIT and len(stored.trace) < MAX_TRACE:
                stored = stored.with_step(_step("store", ".".join(key), site, stored.unit))
            self.ca.writes.append(Write(key, stored, site, self.fn.full_name, self.fn.contract_declarer.name))

    # ---------------------------------------------------------------- reporting
    def _report(self, rule: str, conf: Conf, site: Site, left: Operand | None, right: Operand | None,
                trace: tuple[TraceStep, ...], direction: str = "default") -> None:
        if not (self.committing and self.live and self.ca.emit):
            return
        sev = cap(RULES[rule].severity, conf)
        self.ca.e.add_finding(Finding(rule, sev, conf, self.fn.contract_declarer.name, self.fn.full_name,
                                      site, left, right, trace[:MAX_TRACE], direction))

    def _operand(self, v: Any, val: Value) -> Operand:
        if val.trace:
            return Operand(val, val.trace[0].expr)
        if isinstance(v, Constant):
            return Operand(val, str(v.original_value))
        return Operand(val, str(getattr(_base(v), "name", v)))

    def _collision(self, col: Collision, context: str, site: Site, lhs: Any, rhs: Any) -> None:
        left, right = self._operand(lhs, col.left), self._operand(rhs, col.right)
        trace = col.left.trace + col.right.trace
        if col.kind is CollisionKind.MIXED_VIEWS:
            self._report("TW-002" if context == "compare" else "TW-001", col.conf, site, left, right, trace)
        elif col.kind is CollisionKind.EXP_DRIFT:
            self._report("TW-008", col.conf, site, left, right, trace)
        elif col.kind is CollisionKind.LITERAL_OTHER_VIEW:
            amt = col.left if col.left.kind is Kind.UNIT else col.right
            direction = "native" if amt.unit == NATIVE else "erc20"
            self._report("TW-006", col.conf, site, left, right, trace, direction)
        elif col.kind is CollisionKind.TOKEN_MIX:
            self._report("TW-900", col.conf, site, left, right, trace)

    def _sink(self, v: Any, node: Any, expected: Unit, site: Site, sink_expr: str,
              conf_cap: Conf = Conf.DEFINITE) -> None:
        self.touches_value = True
        val = self.value(v, node, site)
        if val.is_known:
            val = val.with_conf(conf_cap)  # a heuristic binding caps every finding it produces (§1.2)
        self._add_constraint(v, node, expected, sink_expr)
        col = L.expect(val, expected)
        step = _step("sink", sink_expr, site, expects=expected)
        opnd = self._operand(v, val)
        if col is not None:
            if col.kind is CollisionKind.MIXED_VIEWS:
                rule = "TW-004" if expected == ERC20 else "TW-003"
            elif col.kind is CollisionKind.EXP_DRIFT:
                rule = "TW-008"
            elif col.kind is CollisionKind.TOKEN_MIX:
                rule = "TW-900"
            else:
                return
            self._report(rule, col.conf, site, opnd, None, val.trace + (step,))
            return
        if expected == ERC20 and val.kind is Kind.UNIT and val.unit == ERC20 and val.trunc is not None \
                and val.trunc not in self.mod_keys:
            self._report("TW-007", val.conf, site, opnd, None, val.trace + (step,))

    # ---------------------------------------------------------------- transfer functions
    def _op(self, node: Any, ir: Any) -> None:
        site = site_of(ir)
        if isinstance(ir, PhiCallback):
            return
        if isinstance(ir, Phi):
            if _is_state(_base(ir.lvalue)):
                return
            acc = BOT
            for r in ir.rvalues:
                acc = L.join(acc, self.value(r, node, site))[0]
            self.env[_key(ir.lvalue)] = acc
            return
        if isinstance(ir, Assignment):
            self._set(ir.lvalue, self.value(ir.rvalue, node, site), site)
            return
        if isinstance(ir, Binary):
            self._binary(node, ir, site)
            return
        if isinstance(ir, TypeConversion):
            tu = typed_unit(ir.type)
            src = self.value(ir.variable, node, site)
            if tu is not None:
                src = Value.of(tu, Conf.DEFINITE, (_step("source", f"{str(ir.type).split('.')[-1]}.wrap", site, tu),))
            self._set(ir.lvalue, src, site)
            return
        if isinstance(ir, Index):
            root = self._root_of(ir.variable_left)
            if root is not None:
                self.ref_roots[_key(ir.lvalue)] = root
            self.env[_key(ir.lvalue)] = self._read_root(root, site)
            tu = typed_unit(getattr(ir.lvalue, "type", None))
            if tu is not None:
                self.env[_key(ir.lvalue)] = Value.of(tu, Conf.DEFINITE, (_step("load", text_of(ir), site, tu),))
            return
        if isinstance(ir, Member):
            left = ir.variable_left
            root = self._root_of(left) if not isinstance(left, (Contract, Function)) else None
            if root is not None:
                root = (root[0], root[1] + (str(ir.variable_right),))
                self.ref_roots[_key(ir.lvalue)] = root
            self.env[_key(ir.lvalue)] = self._read_root(root, site) if root is not None else TOP
            return
        if isinstance(ir, Unpack):
            tup = self.tuples.get(_key(ir.tuple))
            val = tup[ir.index] if tup is not None and ir.index < len(tup) else TOP
            self._set(ir.lvalue, val, site)
            return
        if isinstance(ir, Return):
            vals = [self.value(v, node, site) for v in ir.values]
            for i, v in enumerate(vals):
                if i < len(self.returns):
                    self.returns[i] = L.join(self.returns[i], v)[0]
                else:
                    self.returns.append(v)
            return
        if isinstance(ir, LibraryCall):
            self._library_call(node, ir, site)
            return
        if isinstance(ir, HighLevelCall):
            self._high_level_call(node, ir, site)
            return
        if isinstance(ir, InternalCall):
            if ir.is_modifier_call:
                return
            fn = ir.function
            if fn is None:
                self._result(ir, (TOP,), site)
                return
            args = tuple(self.value(a, node, site) for a in ir.arguments)
            rets = self.ca.call(fn, args, self.stack + (self.fn.canonical_name,), self.live and self.committing)
            step = _step("call", f"{fn.name}()", site)
            rets = tuple(r.with_conf(Conf.INFERRED).with_step(step) if r.kind is Kind.UNIT else r for r in rets)
            self._result(ir, rets, site)
            return
        if isinstance(ir, LowLevelCall):
            if ir.call_value is not None:
                self._sink(ir.call_value, node, NATIVE, site, text_of(ir))
            self._result(ir, (TOP, TOP), site)
            return
        if isinstance(ir, (Transfer, Send)):
            self._sink(ir.call_value, node, NATIVE, site, text_of(ir))
            if isinstance(ir, Send):
                self._set(ir.lvalue, TOP, site)
            return
        if isinstance(ir, SolidityCall):
            name = ir.function.name if isinstance(ir.function, SolidityFunction) else str(ir.function)
            u = SOLIDITY_CALL_UNITS.get(name)
            if ir.lvalue is not None:
                if u is None:
                    self._set(ir.lvalue, TOP, site)
                else:
                    if u == NATIVE:
                        self.touches_value = True
                    self._set(ir.lvalue, Value.of(u, Conf.DEFINITE, (_step("source", text_of(ir), site, u),)), site)
            return
        if isinstance(ir, Length):
            self._set(ir.lvalue, Value.of(DIMENSIONLESS), site)
            return
        if isinstance(ir, OperationWithLValue) and ir.lvalue is not None:
            self._set(ir.lvalue, TOP, site)

    def _result(self, ir: Any, rets: tuple[Value, ...], site: Site) -> None:
        lv = ir.lvalue
        if lv is None:
            return
        if isinstance(lv, TupleVariable):
            self.tuples[_key(lv)] = rets
            self.env[_key(lv)] = TOP
        else:
            self._set(lv, rets[0] if rets else TOP, site)

    def _binary(self, node: Any, ir: Any, site: Site) -> None:
        lhs, rhs = ir.variable_left, ir.variable_right
        a, b = self.value(lhs, node, site), self.value(rhs, node, site)
        t = ir.type
        if t in (BinaryType.ADDITION, BinaryType.SUBTRACTION):
            folded = L.fold_literals("+" if t is BinaryType.ADDITION else "-", a, b)
            if folded is not None:
                self._set(ir.lvalue, folded, site)
                return
            res, col = L.check_equal(a, b)
            # compound assignment into storage (`cell += x`): the write contributes x's unit, so a cross-view
            # write is caught once as TW-005 at the cell instead of as TW-001 here (§4.2, §6).
            lroot = self.ref_roots.get(_key(ir.lvalue)) if isinstance(ir.lvalue, ReferenceVariable) else None
            compound = lroot is not None and lroot[0] == "cell" and (
                self._root_of(lhs) == lroot or self._root_of(rhs) == lroot)
            if compound:
                other = b if self._root_of(lhs) == lroot else a
                self._set(ir.lvalue, res, site, write=other if col is not None else None)
                return
            if col is not None:
                self._collision(col, "arith", site, lhs, rhs)
            self._set(ir.lvalue, res, site)
            return
        if t in _COMPARISONS:
            _, col = L.check_equal(a, b)
            if col is not None:
                self._collision(col, "compare", site, lhs, rhs)
            self._set(ir.lvalue, Value.of(DIMENSIONLESS), site)
            return
        if t is BinaryType.MULTIPLICATION:
            self._set(ir.lvalue, L.mul(a, b), site)
        elif t is BinaryType.DIVISION:
            self._set(ir.lvalue, L.div(a, b), site)
        elif t is BinaryType.POWER:
            self._set(ir.lvalue, L.power(a, b), site)
        elif t is BinaryType.MODULO:
            if b.kind is Kind.LIT and is_view_conversion_scale(b.mul_unit() or DIMENSIONLESS) and a.trace:
                self.mod_keys.add(a.trace[0].expr)
            self._set(ir.lvalue, L.modulo(a, b), site)
        else:
            self._set(ir.lvalue, TOP, site)

    # ---------------------------------------------------------------- external / library calls
    def _usdc_binding(self, dest: Any, node: Any, site: Site) -> Conf | None:
        """Is `dest` the USDC ERC-20? Literal addresses flow through the lattice; static bindings add the rest."""
        base = _base(dest)
        val = self.value(dest, node, site)
        if val.kind is Kind.LIT and val.lit == USDC_ERC20_ADDRESS:
            if _is_state(base):
                name = f"{base.contract.name}.{base.name}" if getattr(base, "contract", None) is not None \
                    else base.name
                dep = self.ca.e.deployed.get(base.canonical_name)
                if dep is not None:
                    method, mutable = dep.method, dep.mutable
                else:
                    method = "constant" if base.is_constant else ("immutable" if base.is_immutable else "storage")
                    mutable = not (base.is_constant or base.is_immutable)
                self.ca.e.bindings.setdefault(name, Binding(name, method, Conf.DEFINITE, mutable))
            return Conf.DEFINITE
        if isinstance(base, StateVariable):
            b = self.ca.e.static.lookup(base)
            if b is not None:
                self.ca.e.bindings.setdefault(b.var, b)
                return b.conf
        return None

    def _token_id(self, dest: Any) -> str | None:
        base = _base(dest)
        if isinstance(base, (StateVariable, LocalVariable)) and type(getattr(base, "type", None)).__name__ \
                == "UserDefinedType":
            return base.canonical_name if isinstance(base, StateVariable) else f"{self.fn.full_name}.{base.name}"
        return None

    def _high_level_call(self, node: Any, ir: Any, site: Site) -> None:
        name = str(ir.function_name)
        if ir.call_value is not None:
            self._sink(ir.call_value, node, NATIVE, site, text_of(ir))
        conf = self._usdc_binding(ir.destination, node, site)
        out: Value = TOP
        if conf is not None:
            self.touches_value = True
            if name in ERC20_AMOUNT_GETTERS:
                out = Value.of(ERC20, conf, (_step("source", text_of(ir), site, ERC20),))
            elif name == ERC20_DECIMALS_GETTER:
                out = Value.literal(USDC_DECIMALS)
            elif name in ERC20_SINKS and ERC20_SINKS[name] < len(ir.arguments):
                self._sink(ir.arguments[ERC20_SINKS[name]], node, ERC20, site, text_of(ir), conf)
        else:
            tok = self._token_id(ir.destination)
            if tok is not None and name in ERC20_AMOUNT_GETTERS:
                out = Value.of_token(tok, trace=(_step("source", text_of(ir), site),))
            elif tok is not None and name in ERC20_SINKS and ERC20_SINKS[name] < len(ir.arguments):
                arg = ir.arguments[ERC20_SINKS[name]]
                val = self.value(arg, node, site)
                _, col = L.check_equal(Value.of_token(tok), val)
                if col is not None and col.kind is CollisionKind.TOKEN_MIX:
                    self._report("TW-900", col.conf, site, self._operand(arg, val), None,
                                 val.trace + (_step("sink", text_of(ir), site),))
        self._result(ir, (out,), site)

    def _library_call(self, node: Any, ir: Any, site: Site) -> None:
        name = str(ir.function_name)
        args = list(ir.arguments)
        vals = [self.value(a, node, site) for a in args]
        if name in MULDIV_FUNCTIONS and len(vals) >= 3:
            self._result(ir, (L.div(L.mul(vals[0], vals[1]), vals[2]),), site)
            return
        if name in MINMAX_FUNCTIONS and len(vals) == 2:
            res, col = L.check_equal(vals[0], vals[1])
            if col is not None:
                self._collision(col, "compare", site, args[0], args[1])
            self._result(ir, (res,), site)
            return
        if name in ERC20_LIBRARY_SINKS and args:
            conf = self._usdc_binding(args[0], node, site)
            idx = ERC20_LIBRARY_SINKS[name]
            if conf is not None and idx < len(args):
                self.touches_value = True
                self._sink(args[idx], node, ERC20, site, text_of(ir), conf)
                self._result(ir, (TOP,), site)
                return
        fn = ir.function
        if isinstance(fn, Function) and fn.is_implemented:
            rets = self.ca.call(fn, tuple(vals), self.stack + (self.fn.canonical_name,), self.live and self.committing)
            step = _step("call", f"{fn.name}()", site)
            rets = tuple(r.with_conf(Conf.INFERRED).with_step(step) if r.kind is Kind.UNIT else r for r in rets)
            self._result(ir, rets, site)
            return
        self._result(ir, (TOP,), site)


def analyze(slither: Any, sources: dict[str, str], config: dict[str, str],
            deployed: dict[str, DeployedValue] | None = None, target: tuple[str, str] | None = None) -> Engine:
    e = Engine(slither, sources, config, deployed, target)
    e.run()
    return e

