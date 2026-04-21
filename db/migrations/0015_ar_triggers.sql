-- =====================================================================
-- Immutability triggers for invoices / payments / credit_memos
-- Pattern: same as JE — once status='posted', only the void path is
-- allowed to mutate the row, gated by app.allow_void session setting.
-- COALESCE on current_setting because NULL <> 'on' silently no-ops.
-- =====================================================================
CREATE OR REPLACE FUNCTION ar_protect_posted()
RETURNS TRIGGER AS $$
DECLARE
  v_entity text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted % %', v_entity, OLD.id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided' THEN
      IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted % % outside controlled void path', v_entity, OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Allow transitioning posted -> paid (invoices) via sub-ledger update.
    -- Nested IF (rather than AND) so the NEW.status literal is only evaluated
    -- for the matching v_entity; comparing to 'paid' under a payments NEW row
    -- would fail the payment_status enum cast.
    IF v_entity = 'invoice' THEN
      IF NEW.status = 'paid' THEN
        RETURN NEW;
      END IF;
    END IF;
    -- Allow transitioning posted -> applied (credit_memos) via sub-ledger update.
    IF v_entity = 'credit_memo' THEN
      IF NEW.status = 'applied' THEN
        RETURN NEW;
      END IF;
    END IF;
    -- Disallow any other column change on a posted row
    IF v_entity = 'invoice' THEN
      IF (NEW.status, NEW.invoice_number, NEW.customer_id, NEW.issue_date, NEW.due_date,
          NEW.subtotal, NEW.tax_total, NEW.total, NEW.ar_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.invoice_number, OLD.customer_id, OLD.issue_date, OLD.due_date,
          OLD.subtotal, OLD.tax_total, OLD.total, OLD.ar_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted invoice %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'payment' THEN
      IF (NEW.status, NEW.amount, NEW.customer_id, NEW.payment_date, NEW.cash_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.customer_id, OLD.payment_date, OLD.cash_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted payment %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'credit_memo' THEN
      IF (NEW.status, NEW.amount, NEW.customer_id, NEW.memo_date, NEW.ar_account_id,
          NEW.revenue_account_id, NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.customer_id, OLD.memo_date, OLD.ar_account_id,
          OLD.revenue_account_id, OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted credit_memo %', OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_protect_posted
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('invoice');

CREATE TRIGGER trg_payments_protect_posted
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('payment');

CREATE TRIGGER trg_credit_memos_protect_posted
  BEFORE UPDATE OR DELETE ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('credit_memo');

-- =====================================================================
-- Extend journal_entries source sanity trigger (replaces the prior version
-- from Plan 1.1 migration 0008). Now that invoice/payment/credit_memo
-- tables exist, validate polymorphic source FKs.
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
  ELSIF NEW.source_type = 'manual' AND NEW.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual entry must not have source_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
