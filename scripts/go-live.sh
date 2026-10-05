#!/usr/bin/env bash
# Option A hosting: web on Vercel, api + monitor + Postgres on this Mac, published through a Cloudflare quick tunnel.
#   scripts/go-live.sh          start everything; if the tunnel URL changed, point Vercel at it and redeploy
#   scripts/go-live.sh status   show what is running and the public URLs
#   scripts/go-live.sh stop     stop api, monitor, tunnel (Postgres keeps running)
# The site is up only while this Mac is awake and online; the script keeps it awake while the tunnel runs.
# Secrets are read from .env (and the attester key from contracts/.env if the root one is malformed); none are printed.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
LIVE="$ROOT/.live"
mkdir -p "$LIVE"
WEB_URL=${WEB_URL:-https://twelve-arc.vercel.app}
PORT=8787
V() { npx -y vercel@latest "$@" 2>&1 | grep -v "npm notice"; }

stop() {
  for n in tunnel monitor api; do pkill -f "$(pattern $n)" 2>/dev/null || true; done
  pkill -f "caffeinate -ims -w" 2>/dev/null || true
  rm -f "$LIVE"/*.pid
  echo "stopped api, monitor, tunnel"
}

# liveness by the real process (pid files can point at short-lived wrappers)
pattern() {
  case $1 in
    api) echo "src/index.ts twelve-role=api" ;;
    monitor) echo "src/index.ts twelve-role=monitor" ;;
    tunnel) echo "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT" ;;
  esac
}
alive() { pgrep -f "$(pattern "$1")" >/dev/null 2>&1; }
# start detached in a new session, so the services outlive the shell (and tool runners) that launched them
detach() { nohup python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@" </dev/null & }

status() {
  for n in api monitor tunnel; do printf '%-8s %s\n' "$n" "$(alive $n && echo running || echo stopped)"; done
  [[ -f "$LIVE/tunnel-url" ]] && echo "api      $(cat "$LIVE/tunnel-url")"
  echo "web      $WEB_URL"
}

case "${1:-start}" in
  stop) stop; exit 0 ;;
  status) status; exit 0 ;;
  start) ;;
  *) echo "usage: $0 [start|status|stop]" >&2; exit 2 ;;
esac

healthy() { [[ "$(curl -s -m 5 "$1/healthz" 2>/dev/null)" == *'"db":true'* ]]; }
hex64() { local k=${1#0x}; [[ ${#k} -eq 64 && "$k" =~ ^[0-9a-fA-F]+$ ]]; }
envval() { grep "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' | sed "s/^'//; s/'$//"; }

# ---- environment for the services (exported only into their processes)
export DATABASE_URL=${DATABASE_URL:-postgres://twelve:twelve@localhost:5432/twelve}
export ARC_RPC_URL=$(envval ARC_RPC_URL .env)
export ARC_TESTNET_RPC_URL=$(envval ARC_TESTNET_RPC_URL .env)
export BLOCKSCOUT_API_KEY=$(envval BLOCKSCOUT_API_KEY .env)
ATT=$(envval ATTESTER_PRIVATE_KEY .env)
hex64 "$ATT" || ATT=$(envval ATTESTER_PRIVATE_KEY contracts/.env)
hex64 "$ATT" || { echo "no valid ATTESTER_PRIVATE_KEY in .env or contracts/.env (64 hex chars)" >&2; exit 1; }
export REGISTRY_ADDRESS=0x6670030e9df18e3A454eA77d69D00Fd8d17728A1
export ATTESTER_ADDRESS=0xe98540d28F45830E01D237251Bfc4777E69c9A46
export DISCLOSED_ADDRESSES=$(envval DISCLOSED_ADDRESSES .env.example)
export PRIVATE_TARGETS=$( [[ -f apps/monitor/.replay/private-targets.txt ]] && paste -sd, apps/monitor/.replay/private-targets.txt || echo "")
export WEB_ORIGIN="$WEB_URL,http://localhost:3000"
export MONITOR_CHAIN_ID=5042 API_PORT=$PORT API_HOST=127.0.0.1 TRUST_PROXY=1
[[ -n "$ARC_RPC_URL" ]] || { echo "ARC_RPC_URL missing in .env" >&2; exit 1; }

# ---- Postgres
docker info >/dev/null 2>&1 || { open -a Docker; for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done; }
docker compose -f infra/compose.yml up -d >/dev/null
for _ in $(seq 1 30); do docker exec infra-postgres-1 pg_isready -U twelve >/dev/null 2>&1 && break; sleep 1; done

# ---- api (holds the attester key) and monitor (public attester address only, I12)
if ! alive api; then
  (cd apps/api && export ATTESTER_PRIVATE_KEY=$ATT && detach npx tsx src/index.ts twelve-role=api >"$LIVE/api.log" 2>&1)
fi
if ! alive monitor; then
  (cd apps/monitor && unset ATTESTER_PRIVATE_KEY && detach npx tsx src/index.ts twelve-role=monitor >"$LIVE/monitor.log" 2>&1)
fi
unset ATT
for _ in $(seq 1 60); do healthy "http://127.0.0.1:$PORT" && break; sleep 1; done
healthy "http://127.0.0.1:$PORT" || { echo "api did not come up; see .live/api.log" >&2; exit 1; }

# ---- tunnel (a quick tunnel keeps its URL for the life of the process)
if ! alive tunnel; then
  : >"$LIVE/tunnel.log"
  detach cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$LIVE/tunnel.log" 2>&1
  for _ in $(seq 1 60); do grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LIVE/tunnel.log" && break; sleep 1; done
  detach caffeinate -ims -w "$(pgrep -f "$(pattern tunnel)" | head -1)" >/dev/null 2>&1
fi
URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LIVE/tunnel.log" | head -1)
[[ -n "$URL" ]] || { echo "tunnel URL not found; see .live/tunnel.log" >&2; exit 1; }
for _ in $(seq 1 30); do healthy "$URL" && break; sleep 2; done
healthy "$URL" || { echo "api not reachable through $URL" >&2; exit 1; }

# ---- point the web app at the tunnel when it changed
if [[ "$(cat "$LIVE/tunnel-url" 2>/dev/null)" != "$URL" || "${FORCE_DEPLOY:-0}" == "1" ]]; then
  V env rm NEXT_PUBLIC_API_URL production --yes >/dev/null || true
  printf '%s' "$URL" | V env add NEXT_PUBLIC_API_URL production >/dev/null
  out=$(V deploy --prod --yes) || true
  printf '%s\n' "$out" | grep -E "Production|Error|error" || true
  # remember the URL only once a deployment that uses it is live
  if printf "%s" "$out" | grep -qE "ready\. Production URL: https://|Production: https://"; then echo "$URL" >"$LIVE/tunnel-url"; else echo "deploy failed" >&2; exit 1; fi
fi
status
