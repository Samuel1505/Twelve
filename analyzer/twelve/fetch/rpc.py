"""JSON-RPC reads pinned to one block (the report's `bindingBlock`)."""

from __future__ import annotations

from typing import Any

from twelve.fetch.http import request_json


class RpcError(Exception):
    pass


class Rpc:
    def __init__(self, url: str) -> None:
        self.url = url
        self._id = 0

    def call(self, method: str, params: list[Any]) -> Any:
        self._id += 1
        res = request_json(self.url, {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        if "error" in res:
            raise RpcError(f"{method}: {res['error']}")
        return res["result"]

    def chain_id(self) -> int:
        return int(self.call("eth_chainId", []), 16)

    def block_number(self) -> int:
        return int(self.call("eth_blockNumber", []), 16)

    def code(self, address: str, block: int) -> bytes:
        return bytes.fromhex(self.call("eth_getCode", [address, hex(block)])[2:])

    def storage(self, address: str, slot: int, block: int) -> bytes:
        word = self.call("eth_getStorageAt", [address, hex(slot), hex(block)])
        return bytes.fromhex(word[2:].rjust(64, "0"))

    def eth_call(self, to: str, data: str, block: int) -> bytes:
        return bytes.fromhex(self.call("eth_call", [{"to": to, "data": data}, hex(block)])[2:])
