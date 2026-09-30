import json
from pathlib import Path

import pytest

from twelve.compile import OUTPUT_SELECTION
from twelve.fetch.rebuild import Unsupported, rebuild

FIXTURE = Path(__file__).parent / "fixtures" / "blockscout_smart_contract.json"


def test_rebuild_from_live_fixture() -> None:
    sc = json.loads(FIXTURE.read_text())
    rb = rebuild(sc)
    assert rb.compiler == "0.8.24+commit.e11b9ed9"
    assert (rb.file, rb.name) == (sc["file_path"], sc["name"])
    srcs = rb.standard_json["sources"]
    assert len(srcs) == 1 + len(sc["additional_sources"]) and list(srcs) == sorted(srcs)
    settings = rb.standard_json["settings"]
    assert settings["metadata"] == sc["compiler_settings"]["metadata"]  # affects bytecode: kept verbatim
    assert settings["remappings"] == sc["compiler_settings"]["remappings"]
    assert settings["outputSelection"] == OUTPUT_SELECTION


def test_version_prefix_and_flat_settings() -> None:
    rb = rebuild({"language": "solidity", "name": "A", "file_path": "", "source_code": "contract A {}",
                  "compiler_version": "v0.8.28+commit.7893614a", "optimization_enabled": True,
                  "optimization_runs": 10000, "evm_version": "default"})
    assert rb.compiler == "0.8.28+commit.7893614a" and rb.file == "A.sol"
    assert rb.standard_json["settings"]["optimizer"] == {"enabled": True, "runs": 10000}
    assert "evmVersion" not in rb.standard_json["settings"]


def test_vyper_is_unsupported() -> None:
    with pytest.raises(Unsupported):
        rebuild({"language": "vyper", "name": "V", "source_code": "", "compiler_version": "0.3.10"})
