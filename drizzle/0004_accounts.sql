CREATE TABLE trip_accounts (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','customer')),
  must_change INTEGER NOT NULL DEFAULT 0 CHECK(must_change IN (0,1)),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE trip_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES trip_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX trip_sessions_by_account ON trip_sessions(account_id);
--> statement-breakpoint
CREATE INDEX trip_sessions_by_expiry ON trip_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE trip_auth_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX trip_auth_limits_by_expiry ON trip_auth_limits(expires_at);
--> statement-breakpoint
CREATE TRIGGER trip_revoke_sessions_after_password_change
AFTER UPDATE OF password_hash ON trip_accounts
BEGIN
  DELETE FROM trip_sessions WHERE account_id = NEW.id;
END;
