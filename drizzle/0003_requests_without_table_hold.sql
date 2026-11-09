ALTER TABLE trip_reservations ADD COLUMN closed_reason TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX trip_one_committed_reservation ON trip_reservations(event, lounge)
WHERE state IN ('creating','awaiting','paid','review') OR (state = 'offered' AND confirmed_at IS NOT NULL);
--> statement-breakpoint
DROP INDEX trip_one_active_reservation;
--> statement-breakpoint
CREATE TRIGGER trip_close_other_requests_after_confirmation
AFTER UPDATE OF state, confirmed_at ON trip_reservations
WHEN NEW.state = 'paid' OR (NEW.state = 'offered' AND NEW.confirmed_at IS NOT NULL)
BEGIN
  UPDATE trip_reservations SET state = 'void', closed_reason = 'table_assigned'
  WHERE event = NEW.event AND lounge = NEW.lounge AND id <> NEW.id
    AND state = 'offered' AND confirmed_at IS NULL;
END;
