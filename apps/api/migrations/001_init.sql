-- Scan pipeline, content-addressed reports, attestations (docs/ARCHITECTURE.md §3, §4).
-- Addresses/hashes are bytea; amounts (later phases) are NUMERIC(78,0) with the view in the column name.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id    integer     NOT NULL,
  address     bytea       NOT NULL CHECK (length(address) = 20),
  codehash    bytea       NULL CHECK (codehash IS NULL OR length(codehash) = 32),
  state       text        NOT NULL,
  error       jsonb       NULL,
  report_hash bytea       NULL,
  attest_tx   bytea       NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scans_target ON scans (chain_id, address, created_at DESC);

CREATE TABLE scan_events (
  id         bigserial PRIMARY KEY,
  scan_id    uuid        NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  stage      text        NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz NULL,
  error      jsonb       NULL
);
CREATE INDEX scan_events_scan ON scan_events (scan_id, id);

-- Content-addressed and immutable: report_hash = keccak256(core_jcs). core_jcs is served verbatim.
CREATE TABLE reports (
  report_hash    bytea PRIMARY KEY CHECK (length(report_hash) = 32),
  schema_version integer     NOT NULL,
  tool_version   text        NOT NULL,
  chain_id       integer     NULL,
  address        bytea       NULL,
  codehash       bytea       NULL,
  verdict        text        NOT NULL,
  core_jcs       text        NOT NULL,
  meta           jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_dedupe ON reports (chain_id, address, codehash, tool_version);

CREATE TABLE attestations (
  chain_id    integer  NOT NULL,
  target      bytea    NOT NULL,
  attester    bytea    NOT NULL,
  codehash    bytea    NOT NULL,
  report_hash bytea    NOT NULL,
  verdict     smallint NOT NULL,
  revoked     boolean  NOT NULL DEFAULT false,
  tx          bytea    NOT NULL,
  block       bigint   NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, target, attester)
);
