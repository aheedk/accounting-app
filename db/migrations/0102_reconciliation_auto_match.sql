-- Item 71, 2026-10-16 follow-ups: auto-tick a reconciliation item when it was
-- matched against an uploaded bank statement's own lines at Start time, so the
-- worksheet can tell "the system ticked this" apart from "the user did."
ALTER TABLE reconciliation_items ADD COLUMN auto_matched boolean NOT NULL DEFAULT false;
