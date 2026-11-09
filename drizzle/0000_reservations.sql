CREATE TABLE trip_reservations (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  zone TEXT NOT NULL,
  lounge INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'offered' CHECK(state IN ('offered','creating','awaiting','paid','void','review')),
  provider_id TEXT UNIQUE,
  checkout_url TEXT,
  paid_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX trip_one_active_reservation ON trip_reservations(event, lounge) WHERE state <> 'void';
