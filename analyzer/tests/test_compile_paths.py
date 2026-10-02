"""Source-mode inputs: relative imports that leave the scanned file's directory (found by Phase 6, guard/Usdc.sol)."""

from __future__ import annotations

from pathlib import Path

from twelve.compile import standard_json_for_path


def _write(p: Path, text: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def test_import_outside_directory_keeps_shared_root(tmp_path: Path) -> None:
    _write(tmp_path / "src/guard/U.sol", "pragma solidity 0.8.30;\nlibrary U {}\n")
    entry = _write(tmp_path / "src/demo/A.sol", 'pragma solidity 0.8.30;\nimport {U} from "../guard/U.sol";\ncontract A {}\n')
    std = standard_json_for_path(entry)
    assert sorted(std["sources"]) == ["demo/A.sol", "guard/U.sol"]


def test_self_contained_file_names_are_unchanged(tmp_path: Path) -> None:
    entry = _write(tmp_path / "case/bug.sol", "pragma solidity 0.8.30;\ncontract B {}\n")
    assert list(standard_json_for_path(entry)["sources"]) == ["bug.sol"]


def test_directory_mode_names_relative_to_directory(tmp_path: Path) -> None:
    _write(tmp_path / "d/x/A.sol", 'pragma solidity 0.8.30;\nimport "../y/B.sol";\ncontract A {}\n')
    _write(tmp_path / "d/y/B.sol", "pragma solidity 0.8.30;\ncontract B {}\n")
    assert sorted(standard_json_for_path(tmp_path / "d")["sources"]) == ["x/A.sol", "y/B.sol"]
