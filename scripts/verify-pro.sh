#!/usr/bin/env bash
# Verify a contract through the Blockscout Pro API (etherscan-compatible form POST).
# Mainnet's public explorer is permissioned and `forge verify-contract` cannot parse the Pro API's submit response on
# 5042, so we build the standard-JSON input with forge and submit it ourselves.
# usage: scripts/verify-pro.sh <chainId> <address> <path:Contract> [constructorArgsHex] [forge-root]
set -euo pipefail
cd "$(dirname "$0")/.."
CHAIN=$1 ADDR=$2 ID=$3 ARGS=${4:-} ROOT=${5:-contracts}
KEY=$(grep '^BLOCKSCOUT_API_KEY=' .env | cut -d= -f2-)
API="https://api.blockscout.com/$CHAIN/api/"
TMP=$(mktemp)
# outside contracts/ there is no foundry.toml: pass the project's compile settings explicitly
extra=(); [ "$ROOT" != "contracts" ] && extra=(--root "$ROOT" --compiler-version 0.8.30 --evm-version osaka --optimizer-runs 200)
(cd contracts && forge verify-contract "$ADDR" "$ID" ${extra[@]+"${extra[@]}"} --show-standard-json-input) > "$TMP"
SOLC=0.8.30  # pinned (CLAUDE.md §8)
LONG=$("$HOME/Library/Application Support/svm/$SOLC/solc-$SOLC" --version | sed -n 's/.*Version: \([^.]*\.[^.]*\.[^+]*+commit\.[0-9a-f]*\).*/v\1/p')
RESP=$(curl -s -m 60 -X POST "$API?module=contract&action=verifysourcecode&apikey=$KEY" \
  --data-urlencode "contractaddress=$ADDR" --data-urlencode "sourceCode@$TMP" \
  --data-urlencode "codeformat=solidity-standard-json-input" --data-urlencode "contractname=$ID" \
  --data-urlencode "compilerversion=$LONG" --data-urlencode "constructorArguements=${ARGS#0x}")
rm -f "$TMP"
# node, not the system python3: Apple's python3 shim can be blocked by an unaccepted Xcode license
GUID=$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);console.log(d.status==="1"?d.result:"")}catch{console.log("")}})')
[ -z "$GUID" ] && { echo "$ADDR submit failed: $RESP"; exit 1; }
for i in $(seq 1 30); do
  R=$(curl -s -m 30 "$API?module=contract&action=checkverifystatus&guid=$GUID&apikey=$KEY")
  case "$R" in *Pending*) sleep 10 ;; *) echo "$ADDR $ID: $R"; break ;; esac
done
