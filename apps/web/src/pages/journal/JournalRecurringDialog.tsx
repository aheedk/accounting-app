import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { todayLocal } from '@/lib/dates';
import type { JournalEntryFormValues } from './journalEntryForm';
import {
  journalRecurringTemplateRequest,
  type JournalRecurrence,
  type JournalRecurringSchedule,
} from './journalRecurring';

type JournalRecurringDialogProps = {
  businessId: string;
  form: JournalEntryFormValues;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

function defaultSchedule(form: JournalEntryFormValues): JournalRecurringSchedule {
  const today = todayLocal();
  return {
    name: form.memo.trim() || `Journal Entry ${form.journalNo}`.trim(),
    recurrence: 'monthly',
    nextRunDate: form.date >= today ? form.date : today,
    endDate: '',
  };
}

export default function JournalRecurringDialog({
  businessId,
  form,
  open,
  onOpenChange,
  onCreated,
}: JournalRecurringDialogProps) {
  const [schedule, setSchedule] = useState<JournalRecurringSchedule>(() => defaultSchedule(form));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchedule(defaultSchedule(form));
    setError(null);
  }, [form, open]);

  function patch(next: Partial<JournalRecurringSchedule>) {
    setSchedule(current => ({ ...current, ...next }));
  }

  async function createTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!schedule.name.trim() || !schedule.nextRunDate) return;
    if (schedule.endDate && schedule.endDate < schedule.nextRunDate) {
      setError('End date cannot be before the next run date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/businesses/${businessId}/recurring-templates`,
        journalRecurringTemplateRequest(form, schedule),
      );
      onOpenChange(false);
      onCreated();
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={event => { void createTemplate(event); }}>
          <DialogHeader>
            <DialogTitle>Make recurring journal entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="recurring-je-name">Template name</label>
              <Input
                id="recurring-je-name"
                value={schedule.name}
                onChange={event => patch({ name: event.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="recurring-je-frequency">Repeat</label>
              <select
                id="recurring-je-frequency"
                value={schedule.recurrence}
                onChange={event => patch({ recurrence: event.target.value as JournalRecurrence })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="recurring-je-next">Next date</label>
                <DateInput
                  id="recurring-je-next"
                  value={schedule.nextRunDate}
                  onChange={event => patch({ nextRunDate: event.target.value })}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="recurring-je-end">End date (optional)</label>
                <DateInput
                  id="recurring-je-end"
                  value={schedule.endDate}
                  onChange={event => patch({ endDate: event.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Each occurrence gets a new journal number and uses the scheduled date.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !schedule.name.trim() || !schedule.nextRunDate}>
              {busy ? 'Saving...' : 'Save template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
