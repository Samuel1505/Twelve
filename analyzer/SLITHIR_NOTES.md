# SLITHIR_NOTES.md — API facts for the pinned Slither

Pinned: `slither-analyzer==0.11.6`, `crytic-compile==0.4.2` (Python 3.12). Everything below was read from the
installed source under `.venv/lib/python3.12/site-packages/{slither,crytic_compile}` and confirmed by running
`scripts/phase0/slithir_probe.py` over `tests/fixtures/slithir_probe.sol` with solc 0.8.30. Re-verify on any upgrade.
Paths are relative to `site-packages/slither/`.

## 1. SSA access

- `Function.slithir_ssa_operations -> list[Operation]` (`core/declarations/function.py:992`): the flattened
  `[ir for n in f.nodes for ir in n.irs_ssa]`. Cached. **Node order is CFG construction order, not
  topological.** The fixpoint must iterate to convergence and not rely on list order.
- `Node.irs_ssa` (`core/cfg/node.py:682`), `Node.sons` / `fathers` / `dominators`, `Node.source_mapping`.
- `Function.parameters_ssa`, `returns_ssa`, `return_values_ssa`; `Function.is_constructor`, `visibility`,
  `is_implemented`, `contract_declarer` (filter inherited copies), `full_name`, `canonical_name`.
- SSA variable classes (`slithir/variables/`): `LocalIRVariable`, `StateIRVariable`, `TemporaryVariableSSA`,
  `ReferenceVariableSSA`, `TupleVariableSSA`. Each has `.non_ssa_version` (the declaration) and `.ssa_name`
  (for example `credits_3`); `LocalIRVariable` and `StateIRVariable` also have `.index`. **Key per-version facts on the SSA object, but key
  storage cells on `non_ssa_version`** (the global cell in ANALYZER §4.2).
- `slitherConstructorConstantVariables()` / `slitherConstructorVariables()` are synthetic functions holding
  constant and state initialisers. Their SSA list can be empty (it is for constants). Read initial values from
  `StateVariable.expression` instead (§6).

## 2. `Binary` (`slithir/operations/binary.py`)

- Fields: `lvalue`, `variable_left`, `variable_right`, `read` (= `[left, right]`), `type: BinaryType`.
- `BinaryType` members: `POWER ** MULTIPLICATION * DIVISION / MODULO % ADDITION + SUBTRACTION - LEFT_SHIFT <<
  RIGHT_SHIFT >> AND & CARET ^ OR | LESS < GREATER > LESS_EQUAL <= GREATER_EQUAL >= EQUAL == NOT_EQUAL !=
  ANDAND && OROR ||`. `BinaryType.return_bool(t)` covers comparisons and the logical ops.
- `type_str` prefixes `(c)` for checked arithmetic; it is display only.
- Compound assignment to a mapping appears as a `Binary` **whose lvalue is a `ReferenceVariableSSA`**:
  `REF_0(-> credits_2) = REF_0 (c)+ msg.value`. Follow `lvalue.points_to` (a chain) to reach the state var.
- **Literal folding (observed):** `1e12` is a single `Constant` with `value=1000000000000`,
  `original_value='1e12'`. `10**12` is **not** folded: it is `Binary(POWER, Constant(10), Constant(12))` into
  a temp. `units.py` must therefore classify both `Constant.value` powers of ten and `POWER(10, k)` results
  as scale `(0,k)`. `Constant(val, type, subdenomination)` also exposes `original_value` for `ether`/`gwei`
  suffix detection (the conversion is already applied to `value`).

## 3. `LowLevelCall` (`slithir/operations/low_level_call.py`)

- `destination` (the target; after `payable(x)` it is the `TemporaryVariableSSA` from a `TypeConversion`),
  `function_name: Constant` (`call`, `delegatecall`, `staticcall`), `arguments`, `lvalue` (a
  `TupleVariableSSA`, unpacked by a following `Unpack`).
- **Value field: `call_value`** (None when absent), `call_gas`. `can_send_eth()` ⇔ `call_value is not None`.
  Observed: `call{value: a6}("")` gives `call_value=a6_1 (LocalIRVariable)`. The value is set on the
  operation itself, with no separate `Member` in the SSA output.

## 4. `HighLevelCall` (`slithir/operations/high_level_call.py`)

- `destination: Variable | SolidityVariable | Contract` (a `Contract` only for `LibraryCall`, which is a subclass).
  For `USDC.transfer(...)` with `USDC` a constant state var, `destination` is a **`StateIRVariable`**
  (`USDC_1`). Resolve the binding through `destination.non_ssa_version` (a `StateVariable`), then §6.
- `function_name: Constant` (the string name), `function` (the resolved `Function` or, for public-var getters,
  `Variable`; can be `None` if unresolved), `function.canonical_name` (for example `IERC20.transfer(address,uint256)`),
  `arguments`, `nbr_arguments`, `call_value`, `call_gas`, `is_static_call()`, `lvalue`.
- Every external call is followed by a `PhiCallback` over state vars that the callee might modify (§7).

## 5. `Transfer` / `Send` (`slithir/operations/transfer.py`, `send.py`)

- Both: `destination`, `call_value` (the amount, a Variable or Constant despite the `Constant` annotation;
  observed `x_1: LocalIRVariable`). `Send` also has `lvalue` (bool). `Transfer` has no lvalue.
- Both are native 18-dec sinks.

## 6. Sources: `msg.value`, balances, constants

- `SolidityVariableComposed` (`core/declarations/solidity_variables.py:176`): `.name` is the full dotted
  string. Units-relevant names: `msg.value`, `tx.gasprice`, `block.basefee`, `block.blobbasefee` (all native
  18-dec on Arc). It appears **directly as an operand** (for example the right side of `Binary`, or `Assignment`'s rvalue)
  with no temp in between. `SOLIDITY_VARIABLES` (not composed): `this`, `now`, …
- **`address(x).balance` is not a `Member`.** It lowers to `TypeConversion(this → address)` followed by
  `SolidityCall` with `function.name == 'balance(address)'` (`SolidityFunction`). The source rule matches
  `SolidityCall` on that name. Also check `'self.balance'` (Vyper only, ignore in v1).
- **Constant or immutable address bindings:** `StateVariable.expression` for
  `IERC20 constant USDC = IERC20(0x3600…)` is `TypeConversion(Literal 0x3600…)` (`expressions/`).
  `expression.expression.value` is the address string, and `expression.type` is the interface. Flags:
  `is_constant`, `is_immutable`, `is_stored` (`core/variables/variable.py:91,133`, `state_variable.py:39`).
  Immutables assigned in the constructor show up there as `Assignment usdcImm_1 := TMP_0` after a
  `TypeConversion` of the parameter. Their deployed value comes from bytecode `immutableReferences`
  (ANALYZER §3), not from IR.

## 7. `Phi` and `PhiCallback` (`slithir/operations/phi.py`, `phi_callback.py`)

- `Phi.lvalue`, `Phi.rvalues` (list of SSA versions), `Phi.nodes`. Real joins look like
  `r_3 := ϕ(['r_1', 'r_2'])`.
- **Noise:** Slither also emits a `Phi` at function entry for every state variable read (including
  **constants**), listing all versions across the contract (`USDC_1 := ϕ([USDC_2, USDC_0, USDC_6, USDC_4])`),
  and `PhiCallback` after each external call. `PhiCallback` **subclasses `Phi`**, so any `isinstance(ir, Phi)`
  test also catches callbacks. Use `callee_ir` and `rvalue_no_callback` to tell them apart. For unit
  inference, state-var phis should read from the global storage cell (ANALYZER §4.2) rather than joining
  per-version facts, or constants will pick up spurious "merge" events.

## 8. `TypeConversion` (`slithir/operations/type_conversion.py`)

- `variable` (source), `type` (`ElementaryType | UserDefinedType | TypeAlias | ArrayType`), `lvalue`.
- UDVT `U6.wrap(x)` lowers to `TypeConversion(x → U6)` (a `TypeAlias` type). `unwrap` is the reverse. This is
  how Guard types appear to the analyzer.
- `payable(msg.sender)` becomes `TypeConversion(msg.sender → address)`. `IERC20(0x36…)` becomes a
  `TypeConversion` to `UserDefinedType` and creates a binding (ANALYZER §3).

## 9. Source mapping (`core/source_mapping/source_mapping.py`)

- Every IR has `.expression` (may be `None`) and `.node`. Use `ir.expression.source_mapping` when present,
  else `ir.node.source_mapping`.
- `Source` fields: `start`, `length`, `end` (**byte** offsets into the UTF-8 file), `lines: list[int]`,
  `starting_column`, `ending_column`, `content` (byte-sliced correctly), `filename: Filename`.
- `Filename(absolute, used, relative, short)`. **Only `filename.used` is deterministic.** It is the
  standard-JSON source-unit key (`probe/Probe.sol`). `relative` is relative to the *process cwd* (observed
  `../../../../../var/folders/…`), and `absolute` contains the temp dir. Using either in the report breaks
  I4. Always serialize `filename.used`.

## 10. Storage layout API (`core/compilation_unit.py:323,380`)

- `SlitherCompilationUnit.storage_layout_of(contract, var) -> (slot, offset)`. Valid only for
  `var.is_stored`; raises `KeyError` otherwise. The layout is computed unconditionally during parsing
  (`solc_parsing/slither_compilation_unit_solc.py:600`); no explicit `compute_storage_layout()` call is needed.
- Order: `contract.storage_variables_ordered` (and `transient_variables_ordered`). Constants and
  immutables are absent (`is_stored=False`). Observed: `usdcStore → (0,0)`, `credits → (1,0)`.
- `contract.custom_storage_layout` gives the base slot for `layout at` (solc ≥ 0.8.29). Cross-check against
  solc's own `storageLayout` output (requested in `outputSelection`) before trusting it for
  `eth_getStorageAt` bindings.

## 11. crytic-compile standard-JSON input path (`crytic_compile/platform/solc_standard_json.py`)

Entry: `Slither(CryticCompile(SolcStandardJson(std_dict), solc=<binary path>, solc_working_dir=<dir>))`.
`SolcStandardJson(target)` accepts a dict, a JSON string or a file path. `solc` defaults to `"solc"` on PATH;
pass the exact svm binary. Pitfalls (all observed):

1. **The input dict is mutated in place.** `build_standard_json_default` fills missing keys, and
   `add_optimization` **rewrites** `settings.optimizer` to `{enabled, runs}`. This **drops
   `optimizer.details`** and drops `runs` when it is 0. Consequences: (a) compute `standardJsonHash` on a
   `copy.deepcopy` taken *before* handing the dict over. (b) Slither's IR may be built from different optimizer
   settings than the verified build. IR is pre-optimizer, so analysis is unaffected, but **bytecode match
   (I5) must run solc ourselves** on the untouched input, never on crytic's artifacts.
2. **Sources must exist on disk.** Inline `sources[*].content` alone fails in `parse_standard_json_output →
   convert_filename` with `InvalidCompilation: Unknown file`. Write every source to
   `<tmp>/<source-unit-name>` and pass `solc_working_dir=<tmp>`. Keep the source-unit names verbatim so
   `filename.used` matches the verified metadata.
3. **`outputSelection` must include** `evm.bytecode` and `evm.deployedBytecode` per contract and `"": ["ast"]`,
   or parsing raises `KeyError: 'evm'`. Defaults apply only when `outputSelection` is absent. Recommended set:
   `["abi","evm.bytecode","evm.deployedBytecode","storageLayout"]` plus `"": ["ast"]`.
   `outputSelection` does not affect bytecode.
4. `compiler_version` is read from `solc --version` of the binary passed, not from the input.
