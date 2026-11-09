ALTER TABLE trip_reservations ADD COLUMN user_id TEXT;
--> statement-breakpoint
ALTER TABLE trip_reservations ADD COLUMN customer_email TEXT;
--> statement-breakpoint
ALTER TABLE trip_reservations ADD COLUMN channel TEXT NOT NULL DEFAULT 'staff' CHECK(channel IN ('staff','manual','online'));
--> statement-breakpoint
ALTER TABLE trip_reservations ADD COLUMN confirmed_at INTEGER;
--> statement-breakpoint
CREATE INDEX trip_orders_by_user ON trip_reservations(user_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE trip_table_settings (
  event TEXT NOT NULL,
  lounge INTEGER NOT NULL CHECK(lounge BETWEEN 1 AND 84),
  zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','blocked','reserved')),
  PRIMARY KEY(event, lounge)
);
