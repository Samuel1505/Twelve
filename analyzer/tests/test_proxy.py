import pytest

from twelve.fetch.proxy import (
    EIP1967_BEACON_SLOT,
    EIP1967_IMPLEMENTATION_SLOT,
    ZOS_IMPLEMENTATION_SLOT,
    NotAContract,
    UnsupportedTarget,
    classify,
)

IMPL = "0x" + "ab" * 20
BEACON = "0x" + "cd" * 20


def _word(addr: str) -> bytes:
    return bytes(12) + bytes.fromhex(addr[2:])


class FakeRpc:
    def __init__(self, code: dict[str, bytes], storage: dict[tuple[str, int], bytes] | None = None,
                 calls: dict[str, bytes] | None = None) -> None:
        self._code, self._storage, self._calls = code, storage or {}, calls or {}

    def code(self, a: str, block: int) -> bytes:
        return self._code.get(a, b"")

    def storage(self, a: str, slot: int, block: int) -> bytes:
        return self._storage.get((a, slot), bytes(32))

    def eth_call(self, to: str, data: str, block: int) -> bytes:
        return self._calls.get(to, bytes(32))


def test_plain_contract() -> None:
    t = classify(FakeRpc({"0x1": b"\x60\x80"}), "0x1", 1)  # type: ignore[arg-type]
    assert t.kind == "contract" and t.implementation is None


@pytest.mark.parametrize("slot,kind", [(EIP1967_IMPLEMENTATION_SLOT, "eip1967Proxy"),
                                       (ZOS_IMPLEMENTATION_SLOT, "zosProxy")])
def test_slot_proxies(slot: int, kind: str) -> None:
    rpc = FakeRpc({"0x1": b"\x36", IMPL: b"\x60\x80"}, {("0x1", slot): _word(IMPL)})
    t = classify(rpc, "0x1", 1)  # type: ignore[arg-type]
    assert (t.kind, t.implementation, t.impl_code) == (kind, IMPL, b"\x60\x80")
    assert t.as_json(5042)["implementation"]["address"] == IMPL


def test_beacon_proxy() -> None:
    rpc = FakeRpc({"0x1": b"\x36", IMPL: b"\x60"}, {("0x1", EIP1967_BEACON_SLOT): _word(BEACON)},
                  {BEACON: _word(IMPL)})
    t = classify(rpc, "0x1", 1)  # type: ignore[arg-type]
    assert (t.kind, t.implementation) == ("beaconProxy", IMPL)


def test_eip1167_clone() -> None:
    code = bytes.fromhex("363d3d373d3d3d363d73" + IMPL[2:] + "5af43d82803e903d91602b57fd5bf3")
    t = classify(FakeRpc({"0x1": code, IMPL: b"\x60"}), "0x1", 1)  # type: ignore[arg-type]
    assert (t.kind, t.implementation) == ("eip1167Clone", IMPL)


def test_eoa_and_7702() -> None:
    with pytest.raises(NotAContract):
        classify(FakeRpc({}), "0x1", 1)  # type: ignore[arg-type]
    with pytest.raises(UnsupportedTarget):
        classify(FakeRpc({"0x1": b"\xef\x01\x00" + bytes(20)}), "0x1", 1)  # type: ignore[arg-type]
