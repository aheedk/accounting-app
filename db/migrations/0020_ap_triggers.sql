-- =====================================================================
-- Immutability triggers for bills / bill_payments / vendor_credits.
-- Mirrors the Slice 1 ar_protect_posted pattern.
-- Nested IFs (not compound AND with NEW.status literal) so enum-literal
-- comparisons only evaluate under matching v_entity — prevents eager
-- resolution from failing on mismatched status enum types.
-- =====================================================================
CREATE OR REPLACE FUNCTION ap_protect_posted()
RETURNS TRIGGER AS $$
DECLARE
  v_entity text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted % %', v_entity, OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided' THEN
      IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted % % outside controlled void path', v_entity, OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Allow posted -> paid (bills) via sub-ledger update
    -- Nested IF so NEW.status literal only evaluates under matching v_entity branch
    IF v_entity = 'bill' THEN
      IF NEW.status = 'paid' THEN RETURN NEW; END IF;
    END IF;
    -- Allow posted -> applied (vendor_credits)
    IF v_entity = 'vendor_credit' THEN
      IF NEW.status = 'applied' THEN RETURN NEW; END IF;
    END IF;
    IF v_entity = 'bill' THEN
      IF (NEW.status, NEW.bill_number, NEW.vendor_id, NEW.bill_date, NEW.due_date,
          NEW.subtotal, NEW.total, NEW.ap_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.bill_number, OLD.vendor_id, OLD.bill_date, OLD.due_date,
          OLD.subtotal, OLD.total, OLD.ap_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted bill %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'bill_payment' THEN
      IF (NEW.status, NEW.amount, NEW.vendor_id, NEW.payment_date, NEW.cash_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.vendor_id, OLD.payment_date, OLD.cash_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted bill_payment %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'vendor_credit' THEN
      IF (NEW.status, NEW.amount, NEW.vendor_id, NEW.credit_date, NEW.ap_account_id,
          NEW.offset_account_id, NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.vendor_id, OLD.credit_date, OLD.ap_account_id,
          OLD.offset_account_id, OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted vendor_credit %', OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bills_protect_posted BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('bill');
CREATE TRIGGER trg_bill_payments_protect_posted BEFORE UPDATE OR DELETE ON bill_payments FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('bill_payment');
CREATE TRIGGER trg_vendor_credits_protect_posted BEFORE UPDATE OR DELETE ON vendor_credits FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('vendor_credit');

-- =====================================================================
-- Extend journal_entry_source_type ENUM with AP source types.
-- journal_entries.source_type is an ENUM column (not a CHECK constraint),
-- so new values are added via ALTER TYPE ADD VALUE.
-- =====================================================================
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'bill';
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'bill_payment';
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'vendor_credit';

-- =====================================================================
-- Extend je_check_source to validate AP polymorphic source FKs.
-- Keeps the Slice 1 guardrails (manual must not have source_id, reversal
-- must match reversed_entry_id) and adds bill / bill_payment / vendor_credit.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type = 'reversal' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'reversal entry must reference an existing journal_entries row'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.reversed_entry_id IS NULL OR NEW.reversed_entry_id <> NEW.source_id THEN
      RAISE EXCEPTION 'reversal entry: reversed_entry_id must equal source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'invoice' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'invoice-sourced JE must reference invoices(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'payment' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'payment-sourced JE must reference payments(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'credit_memo' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM credit_memos WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'credit_memo-sourced JE must reference credit_memos(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'bill' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM bills WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'bill-sourced JE must reference bills(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'bill_payment' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM bill_payments WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'bill_payment-sourced JE must reference bill_payments(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'vendor_credit' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM vendor_credits WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'vendor_credit-sourced JE must reference vendor_credits(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'manual' AND NEW.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual entry must not have source_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
