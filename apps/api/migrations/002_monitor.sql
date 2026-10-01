-- Monitor (docs/MONITOR.md, ARCHITECTURE §4). Every table carries chain_id: the monitor runs on mainnet and testnet.
-- logs_raw is the source of truth; movements and profiles are rebuildable by replay.

CREATE TABLE logs_raw (
  chain_id   integer NOT NULL,
  block      bigint  NOT NULL,
  log_index  integer NOT NULL,
  block_hash bytea   NOT NULL,
  tx         bytea   NOT NULL,
  emitter    bytea   NOT NULL,
  topic0     bytea   NOT NULL,
  "from"     bytea   NULL,
  "to"       bytea   NULL,
  value_raw  NUMERIC(78,0) NULL, -- unit depends on emitter: 18-dec from 0xff..fe, 6-dec from 0x3600 (ARC_LEDGER §2)
  PRIMARY KEY (chain_id, block, log_index)
);

CREATE TABLE movements (
  chain_id      integer NOT NULL,
  block         bigint  NOT NULL,
  tx            bytea   NOT NULL,
  idx           integer NOT NULL, -- logIndex of the system (18-dec) log
  erc20_idx     integer NULL,     -- logIndex of the paired 6-dec twin, if iface = 'erc20'
  "from"        bytea   NOT NULL,
  "to"          bytea   NOT NULL,
  amount_18     NUMERIC(78,0) NOT NULL,
  iface         text    NOT NULL CHECK (iface IN ('erc20', 'native', 'mint', 'burn')),
  PRIMARY KEY (chain_id, block, idx)
);
CREATE INDEX movements_from ON movements (chain_id, "from", block);
CREATE INDEX movements_to ON movements (chain_id, "to", block);

-- Per-contract outflow profiles (MONITOR §3). Histograms: 64 log10 buckets of amount_18.
CREATE TABLE profiles (
  chain_id       integer NOT NULL,
  address        bytea   NOT NULL,
  is_contract    boolean NOT NULL,
  delegated      boolean NOT NULL DEFAULT false, -- EIP-7702 EOA profiled as a contract (gotcha #9)
  n_out_native   integer NOT NULL DEFAULT 0,
  n_out_erc20    integer NOT NULL DEFAULT 0,
  hist_native    integer[] NOT NULL,
  hist_erc20     integer[] NOT NULL,
  balance_18     NUMERIC(78,0) NOT NULL DEFAULT 0,
  max_out_frac   double precision NOT NULL DEFAULT 0, -- dimensionless ratio, not an amount
  updated_block  bigint  NOT NULL,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE accounts (
  chain_id    integer NOT NULL,
  address     bytea   NOT NULL,
  is_contract boolean NOT NULL,
  delegated   boolean NOT NULL,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE alerts (
  id          bigserial PRIMARY KEY,
  chain_id    integer NOT NULL,
  detector    text    NOT NULL,
  severity    text    NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW', 'INFO', 'OPS')),
  address     bytea   NULL,
  tx          bytea   NULL,
  block       bigint  NULL,
  evidence    jsonb   NOT NULL,
  dedupe_key  text    NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_address ON alerts (chain_id, address, id DESC);
CREATE INDEX alerts_recent ON alerts (id DESC);

CREATE TABLE checkpoints (
  chain_id   integer NOT NULL,
  stream     text    NOT NULL,
  block      bigint  NOT NULL,
  block_hash bytea   NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, stream)
);

CREATE TABLE subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address     bytea NOT NULL,
  webhook_url text  NOT NULL,
  secret      text  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_address ON subscriptions (address);

CREATE TABLE deliveries (
  id              bigserial PRIMARY KEY,
  alert_id        bigint NOT NULL REFERENCES alerts (id),
  subscription_id uuid   NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  attempts        integer NOT NULL DEFAULT 0,
  status          text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  last_error      text   NULL,
  next_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, subscription_id)
);

-- the registry stream keeps attestations in sync with chain and needs the proxy implementation (MONITOR §7)
ALTER TABLE attestations ADD COLUMN implementation bytea NULL;
