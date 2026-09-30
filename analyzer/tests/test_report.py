import json
import shutil
from pathlib import Path

import pytest

from twelve.report import jcs, report_hash, sort_findings, verdict
from twelve.scan import scan_path

CORPUS = Path(__file__).resolve().parents[2] / "corpus"


def test_jcs_is_key_order_independent() -> None:
    a = {"b": [1, {"y": 2, "x": 1}], "a": "z"}
    b = {"a": "z", "b": [1, {"x": 1, "y": 2}]}
    assert jcs(a) == jcs(b) == b'{"a":"z","b":[1,{"x":1,"y":2}]}'
    assert report_hash(a) == report_hash(b)


def test_hash_golden() -> None:
    # keccak256('{"schemaVersion":1}') — pins the hash function and canonical form
    assert report_hash({"schemaVersion": 1}) == \
        "0x" + __import__("Crypto.Hash.keccak", fromlist=["new"]).new(
            digest_bits=256, data=b'{"schemaVersion":1}').hexdigest()


def test_meta_is_never_hashed() -> None:
    with pytest.raises(ValueError):
        report_hash({"meta": {}})


def test_verdict() -> None:
    f = {"severity": "LOW", "location": {"file": "a", "startLine": 1}, "rule": "TW-008", "id": "0x1"}
    assert verdict([f], []) == "CLEAN"
    assert verdict([f], [{"function": "x", "reason": "UNSUPPORTED_ASM"}]) == "INCOMPLETE"
    assert verdict([{**f, "severity": "MEDIUM"}], []) == "FINDINGS"
    g = {**f, "severity": "HIGH", "location": {"file": "a", "startLine": 9}}
    assert sort_findings([f, g])[0] is g


def test_scan_is_deterministic_and_path_independent(tmp_path: Path) -> None:
    src = CORPUS / "c02_native_in_erc20_out" / "bug.sol"
    runs = [scan_path(src) for _ in range(3)]
    moved = tmp_path / "somewhere" / "else"
    moved.mkdir(parents=True)
    shutil.copy(src, moved / "bug.sol")
    runs.append(scan_path(moved / "bug.sol"))
    cores = {jcs(r.core) for r in runs}
    assert len(cores) == 1
    assert len({r.report_hash for r in runs}) == 1
    text = cores.pop().decode()
    assert str(tmp_path) not in text and str(CORPUS) not in text and "/var/" not in text
    assert json.loads(text)["verdict"] == "FINDINGS"
