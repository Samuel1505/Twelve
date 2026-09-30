"""On-chain binding extraction (ANALYZER §3.2) against a synthetic solc output and a fake RPC."""

from twelve.fetch.deployed import deployed_values
from twelve.fetch.match import Match

USDC = 0x3600000000000000000000000000000000000000
OUTPUT = {
    "sources": {"a.sol": {"id": 0, "ast": {"nodeType": "SourceUnit", "nodes": [
        {"nodeType": "ContractDefinition", "name": "Vault", "nodes": [
            {"nodeType": "VariableDeclaration", "id": 11, "name": "token", "stateVariable": True},
            {"nodeType": "VariableDeclaration", "id": 12, "name": "fee", "stateVariable": True},
        ]}]}}},
    "contracts": {"a.sol": {"Vault": {"storageLayout": {
        "storage": [
            {"contract": "a.sol:Vault", "label": "owner", "slot": "0", "offset": 0, "type": "t_address"},
            {"contract": "a.sol:Vault", "label": "pay", "slot": "0", "offset": 20, "type": "t_uint96"},
            {"contract": "a.sol:Base", "label": "usdc", "slot": "1", "offset": 0, "type": "t_contract(IERC20)1"},
        ],
        "types": {"t_address": {"label": "address"}, "t_uint96": {"label": "uint96"},
                  "t_contract(IERC20)1": {"label": "contract IERC20"}},
    }}}},
}


class FakeRpc:
    def __init__(self) -> None:
        self.reads: list[tuple[str, int]] = []

    def storage(self, address: str, slot: int, block: int) -> bytes:
        self.reads.append((address, slot))
        if slot == 0:  # owner at offset 0 (rightmost 20 bytes), a uint96 packed above it
            return (7).to_bytes(12, "big") + (0xAB).to_bytes(20, "big")
        return USDC.to_bytes(32, "big")


def test_immutables_and_storage_bindings_read_from_proxy_storage() -> None:
    m = Match("exact", [], immutables={11: [USDC.to_bytes(32, "big")], 12: [(5).to_bytes(32, "big")]})
    rpc = FakeRpc()
    out = deployed_values(OUTPUT, "a.sol", "Vault", m, rpc, "0xproxy", 9)  # type: ignore[arg-type]
    assert out["Vault.token"].address == USDC and out["Vault.token"].method == "immutable"
    assert out["Vault.fee"].address == 5  # small integer immutables still decode; only 0x3600 binds
    assert out["Vault.owner"].address == 0xAB and out["Vault.owner"].mutable
    assert out["Base.usdc"].address == USDC and out["Base.usdc"].method == "storage"
    assert "Vault.pay" not in out
    assert {a for a, _ in rpc.reads} == {"0xproxy"}
