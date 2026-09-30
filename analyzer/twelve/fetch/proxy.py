"""Target classification (ARCHITECTURE §3 RESOLVING; ADR-005, ADR-018)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from twelve.fetch.rpc import Rpc
from twelve.report import hex_keccak

# EIP-1967 (ARC_LEDGER §6) and the legacy ZeppelinOS slot used by Arc's own 0x3600 (ARC_LEDGER §4, ADR-018).
EIP1967_IMPLEMENTATION_SLOT = 0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC
EIP1967_BEACON_SLOT = 0xA3F0AD74E5423AEBFD80D3EF4346578335A9A72AEAEE59FF6CB3582B35133D50
ZOS_IMPLEMENTATION_SLOT = 0x7050C9E0F4CA769C69BD3A8EF740BC37934F8E2C036E5A723FD8EE048ED3F8C3
BEACON_IMPLEMENTATION_SELECTOR = "0x5c60da1b"  # implementation()

_EIP1167 = re.compile(rb"^\x36\x3d\x3d\x37\x3d\x3d\x3d\x36\x3d\x73(.{20})\x5a\xf4\x3d\x82\x80\x3e\x90\x3d\x91\x60\x2b"
                      rb"\x57\xfd\x5b\xf3$", re.DOTALL)
_EIP7702 = b"\xef\x01\x00"


class NotAContract(Exception):
    pass


class UnsupportedTarget(Exception):
    pass


@dataclass(frozen=True)
class Target:
    address: str
    code: bytes
    kind: str  # contract | eip1967Proxy | beaconProxy | zosProxy | eip1167Clone
    implementation: str | None = None
    impl_code: bytes = b""

    @property
    def codehash(self) -> str:
        return hex_keccak(self.code)

    def as_json(self, chain_id: int) -> dict[str, Any]:
        d: dict[str, Any] = {"chainId": chain_id, "address": self.address.lower(), "codehash": self.codehash,
                             "kind": self.kind}
        if self.implementation is not None:
            d["implementation"] = {"address": self.implementation, "codehash": hex_keccak(self.impl_code)}
        return d


def _addr(word: bytes) -> str | None:
    a = int.from_bytes(word[-20:], "big")
    return None if a == 0 or any(word[:-20]) else "0x" + word[-20:].hex()


def classify(rpc: Rpc, address: str, block: int) -> Target:
    code = rpc.code(address, block)
    if not code:
        raise NotAContract(address)
    if code.startswith(_EIP7702) and len(code) == 23:
        raise UnsupportedTarget("eip7702-delegated")  # CLAUDE.md gotcha #9
    impl = _addr(rpc.storage(address, EIP1967_IMPLEMENTATION_SLOT, block))
    kind = "eip1967Proxy"
    if impl is None:
        beacon = _addr(rpc.storage(address, EIP1967_BEACON_SLOT, block))
        if beacon is not None:
            impl = _addr(rpc.eth_call(beacon, BEACON_IMPLEMENTATION_SELECTOR, block).rjust(32, b"\x00")[-32:])
            kind = "beaconProxy"
            if impl is None:
                raise UnsupportedTarget("beacon-without-implementation")
    if impl is None:
        impl = _addr(rpc.storage(address, ZOS_IMPLEMENTATION_SLOT, block))
        kind = "zosProxy"
    if impl is None:
        m = _EIP1167.match(code)
        if m:
            impl, kind = "0x" + m.group(1).hex(), "eip1167Clone"
    if impl is None:
        return Target(address, code, "contract")
    impl_code = rpc.code(impl, block)
    if not impl_code:
        raise UnsupportedTarget("proxy-implementation-has-no-code")
    return Target(address, code, kind, impl, impl_code)
