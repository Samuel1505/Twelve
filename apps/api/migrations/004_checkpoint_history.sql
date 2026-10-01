-- Whether this chain's ingestion began at genesis (exact balances → D3/BALANCE enabled). A property of the
-- database's history, fixed at first start; never re-derived from configuration on restart.
ALTER TABLE checkpoints ADD COLUMN complete_history boolean NOT NULL DEFAULT false;
