CREATE TABLE trip_profiles (
  user_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  private_data TEXT NOT NULL,
  ci_hint TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE trip_reservations ADD COLUMN receipt_sent_at INTEGER;
--> statement-breakpoint
ALTER TABLE trip_reservations ADD COLUMN receipt_error INTEGER NOT NULL DEFAULT 0;
