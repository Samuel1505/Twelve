import pytest

from twelve.fetch.match import MatchFailed, match_runtime

CBOR = bytes.fromhex("a264697066735822") + b"\x11" * 34 + bytes.fromhex("64736f6c6343000818") + b"\x00\x33"


def _code(body: bytes, cbor: bytes = CBOR) -> bytes:
    return body + cbor


def test_exact_with_immutables_extracts_values() -> None:
    compiled = _code(b"\x60\x80" + b"\x00" * 32 + b"\x56")
    addr = bytes(12) + bytes.fromhex("3600000000000000000000000000000000000000")
    onchain = _code(b"\x60\x80" + addr + b"\x56")
    m = match_runtime({"object": compiled.hex(), "immutableReferences": {"7": [{"start": 2, "length": 32}]}},
                      onchain)
    assert m.status == "exact" and m.masked_ranges == [[2, 32]]
    assert m.immutables[7][0] == addr


def test_metadata_only_difference_is_masked() -> None:
    other = CBOR[:-11] + b"\x22" * 9 + CBOR[-2:]
    m = match_runtime({"object": _code(b"\x60\x80\x56").hex()}, _code(b"\x60\x80\x56", other))
    assert m.status == "masked" and m.masked_ranges[-1] == [3, len(CBOR)]


def test_linked_library_is_masked_and_recorded() -> None:
    lib = "3600000000000000000000000000000000000abc"
    obj = "73" + "__$" + "a" * 34 + "$__" + "56" + CBOR.hex()
    onchain = bytes.fromhex("73" + lib + "56") + CBOR
    m = match_runtime({"object": obj, "linkReferences": {"L.sol": {"L": [{"start": 1, "length": 20}]}}}, onchain)
    assert m.status == "masked" and m.libraries == {"L.sol:L": "0x" + lib}


def test_code_difference_fails_with_offset() -> None:
    with pytest.raises(MatchFailed) as e:
        match_runtime({"object": _code(b"\x60\x80\x56").hex()}, _code(b"\x60\x81\x56"))
    assert e.value.first_diff == 1
    with pytest.raises(MatchFailed):
        match_runtime({"object": _code(b"\x60\x80").hex()}, _code(b"\x60\x80\x56"))
    with pytest.raises(MatchFailed):
        match_runtime({"object": "6080"}, b"")


def test_factory_with_embedded_child_metadata() -> None:
    child_a = b"\x60\x01" + CBOR
    child_b = b"\x60\x01" + CBOR[:-11] + b"\x44" * 9 + CBOR[-2:]
    other_tail = CBOR[:-11] + b"\x55" * 9 + CBOR[-2:]
    compiled = _code(b"\x60\x80" + child_a + b"\x56")
    onchain = _code(b"\x60\x80" + child_b + b"\x56", other_tail)
    m = match_runtime({"object": compiled.hex()}, onchain)
    assert m.status == "masked" and len(m.masked_ranges) == 2
    # a code byte change next to identical metadata still fails
    with pytest.raises(MatchFailed):
        match_runtime({"object": compiled.hex()}, _code(b"\x60\x81" + child_b + b"\x56", other_tail))
