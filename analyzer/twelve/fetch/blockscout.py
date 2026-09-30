"""Verified source from the Blockscout Pro API (ADR-011; response shape in ARC_LEDGER §7)."""

from __future__ import annotations

from typing import Any

from twelve.fetch.http import HttpError, request_json

API = "https://api.blockscout.com/{chain_id}/api/v2"


class NotVerified(Exception):
    pass


def smart_contract(chain_id: int, address: str, api_key: str) -> dict[str, Any]:
    url = f"{API.format(chain_id=chain_id)}/smart-contracts/{address}?apikey={api_key}"
    try:
        body = request_json(url)
    except HttpError as e:
        if e.status == 404:
            raise NotVerified(address) from e
        raise
    if not isinstance(body, dict) or not body.get("is_verified") or not body.get("source_code"):
        raise NotVerified(address)
    return body


def list_verified(chain_id: int, api_key: str, pages: int = 1, query: str = "") -> list[dict[str, Any]]:
    """Paginated list of verified contracts (used by the sweep and the Phase 2 exit run)."""
    url = f"{API.format(chain_id=chain_id)}/smart-contracts?apikey={api_key}" + (f"&q={query}" if query else "")
    out: list[dict[str, Any]] = []
    for _ in range(pages):
        body = request_json(url)
        out.extend(body.get("items", []))
        nxt = body.get("next_page_params")
        if not nxt:
            break
        params = "&".join(f"{k}={v}" for k, v in nxt.items())
        url = f"{API.format(chain_id=chain_id)}/smart-contracts?apikey={api_key}&{params}"
    return out
