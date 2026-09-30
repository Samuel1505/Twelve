"""Pre-deploy binding sources (ANALYZER §3.3) and parameter annotations, end to end through a scan."""

from pathlib import Path

from twelve.bindings import doc_comment_above, param_unit_annotations
from twelve.scan import scan_path

HDR = """// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IERC20 { function transfer(address, uint256) external returns (bool); }
"""


def _scan(tmp_path: Path, body: str, toml: str | None = None) -> dict:
    (tmp_path / "t.sol").write_text(HDR + body)
    if toml is not None:
        (tmp_path / "twelve.toml").write_text(toml)
    return scan_path(tmp_path / "t.sol").core


def test_doc_comment_above() -> None:
    src = "contract A {\n    /// @notice x\n    /// @custom:twelve usdc\n    IERC20 public token;\n}\n"
    start = src.encode().index(b"IERC20 public")
    assert "@custom:twelve usdc" in doc_comment_above(src, start)
    assert doc_comment_above("uint a;\nuint b;\n", 8) == ""
    assert param_unit_annotations("/// @custom:twelve-unit amount usdc6\n/// @custom:twelve-unit v usdc18") == \
        {"amount": "usdc6", "v": "usdc18"}


def test_natspec_binding(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    /// @custom:twelve usdc
    IERC20 public token;
    constructor(IERC20 t) { token = t; }
    function f() external payable { token.transfer(msg.sender, msg.value); }
}""")
    assert [f["rule"] for f in core["findings"]] == ["TW-004"]
    assert core["bindings"][0]["method"] == "config"


def test_toml_binding(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    IERC20 public token;
    constructor(IERC20 t) { token = t; }
    function f() external payable { token.transfer(msg.sender, msg.value); }
}""", toml='[bindings]\n"t.sol:A.token" = "USDC_ERC20"\n')
    assert [f["rule"] for f in core["findings"]] == ["TW-004"]


def test_name_heuristic_caps_severity(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    IERC20 public usdc;
    constructor(IERC20 t) { usdc = t; }
    function f() external payable { usdc.transfer(msg.sender, msg.value); }
}""")
    [f] = core["findings"]
    assert (f["rule"], f["severity"], f["confidence"]) == ("TW-004", "MEDIUM", "HEURISTIC")
    assert core["bindings"][0]["method"] == "nameHeuristic"


def test_param_annotation(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    /// @custom:twelve-unit amount usdc6
    function refund(uint256 amount) external {
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok);
    }
}""")
    [f] = core["findings"]
    assert (f["rule"], f["confidence"]) == ("TW-003", "DEFINITE")


def test_unannotated_param_is_unknown(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    function refund(uint256 amount) external {
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok);
    }
}""")
    assert core["findings"] == [] and core["verdict"] == "CLEAN"


def test_assembly_on_value_path_is_incomplete(tmp_path: Path) -> None:
    core = _scan(tmp_path, """
contract A {
    function f() external payable {
        uint256 v = msg.value;
        assembly { v := shr(1, v) }
        (bool ok,) = payable(msg.sender).call{value: v}("");
        require(ok);
    }
}""")
    assert core["findings"] == []
    assert core["coverage"]["unsupported"] == [{"function": "A.f()", "reason": "UNSUPPORTED_ASM"}]
    assert core["verdict"] == "INCOMPLETE"
