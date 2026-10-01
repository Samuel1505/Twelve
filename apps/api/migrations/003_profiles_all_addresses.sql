-- ADR-020: profiles exist for every address that moves USDC; contract-ness lives in `accounts` and is resolved
-- lazily for alert candidates only.
ALTER TABLE profiles DROP COLUMN is_contract;
ALTER TABLE profiles DROP COLUMN delegated;
