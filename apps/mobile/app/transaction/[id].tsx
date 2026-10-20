import { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Appbar, Card, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import {
  getDeposit, getExpense, getCheck, getJournalEntry,
  type DepositDetail, type ExpenseDetail, type CheckDetail, type JournalEntryDetail,
} from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, type AppTheme } from '../../theme';

// Phase 1 item 5 scopes mobile viewing to these 4 types — read-only for this
// chunk (editing is a deliberate follow-up, not silently dropped). Any other
// unified-transaction type (bill, payment, invoice, credit_memo, ...) lands
// on its own list/detail screen later and is a graceful dead-end here.
const SUPPORTED_TYPES = new Set(['deposit', 'expense', 'check', 'journal']);

const TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit', expense: 'Expense', check: 'Check', journal: 'Journal Entry',
};

export default function TransactionDetailScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>();
  const supported = SUPPORTED_TYPES.has(type);

  const query = useQuery<DetailData>({
    queryKey: ['transaction-detail', type, activeBusinessId, id],
    queryFn: (): Promise<DetailData> => {
      if (!activeBusinessId) throw new Error('no business');
      switch (type) {
        case 'deposit': return getDeposit(activeBusinessId, id);
        case 'expense': return getExpense(activeBusinessId, id);
        case 'check': return getCheck(activeBusinessId, id);
        case 'journal': return getJournalEntry(activeBusinessId, id);
        default: throw new Error('unsupported type');
      }
    },
    enabled: !!activeBusinessId && supported,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title={TYPE_LABELS[type] ?? 'Transaction'} titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      {!supported ? (
        <View style={styles.centered}>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Viewing this transaction type isn't available on mobile yet.
          </Text>
        </View>
      ) : query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DetailBody type={type} data={query.data} theme={theme} insets={insets} />
      )}
    </View>
  );
}

type DetailData = DepositDetail | ExpenseDetail | CheckDetail | JournalEntryDetail;

function DetailBody({ type, data, theme, insets }: { type: string; data: DetailData; theme: AppTheme; insets: { bottom: number } }) {
  const header = useMemo(() => summarizeHeader(type, data), [type, data]);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={styles.amountBlock}>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>{header.refLabel}</Text>
        <Text style={{ fontSize: 32, fontWeight: '700', color: theme.app.foreground, marginTop: 2 }}>
          ${fmtMoney(header.amount)}
        </Text>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
          {fmtShortDate(header.date)}
        </Text>
      </View>

      <Card style={{ backgroundColor: theme.app.surface, marginBottom: spacing.md }}>
        <Card.Content>
          {header.fields.map((f, i) => (
            <FieldRow key={f.label} label={f.label} value={f.value} theme={theme} last={i === header.fields.length - 1} />
          ))}
        </Card.Content>
      </Card>

      <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Lines</Text>
      <Card style={{ backgroundColor: theme.app.surface }}>
        <Card.Content>
          {header.lines.map((l, i) => (
            <View key={i}>
              <View style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>{l.primary}</Text>
                  {l.secondary ? (
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{l.secondary}</Text>
                  ) : null}
                </View>
                <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(l.amount)}</Text>
              </View>
              {i < header.lines.length - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
            </View>
          ))}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last: boolean }) {
  if (!value) return null;
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontWeight: '500', marginTop: 1 }}>{value}</Text>
    </View>
  );
}

type HeaderSummary = {
  refLabel: string;
  amount: string;
  date: string;
  fields: Array<{ label: string; value: string }>;
  lines: Array<{ primary: string; secondary?: string; amount: string }>;
};

// Each type has its own field names (confirmed against the real service
// return shapes) — this maps all 4 onto one stacked-layout shape instead of
// branching the whole render tree per type.
function summarizeHeader(type: string, data: DetailData): HeaderSummary {
  if (type === 'deposit') {
    const d = data as DepositDetail;
    return {
      refLabel: d.deposit_number ? `Deposit #${d.deposit_number}` : 'Deposit',
      amount: d.total_amount,
      date: d.deposit_date,
      fields: [
        { label: 'Bank account', value: d.bank_account_name },
        { label: 'Memo', value: d.memo ?? '' },
        { label: 'Status', value: d.voided_at ? 'Voided' : d.is_reconciled ? 'Reconciled' : 'Open' },
      ],
      lines: d.lines.map(l => ({
        primary: l.received_from ?? l.description ?? l.line_type,
        secondary: [l.account_name, l.ref_no ? `#${l.ref_no}` : null].filter(Boolean).join(' · ') || undefined,
        amount: l.amount,
      })),
    };
  }
  if (type === 'expense') {
    const e = data as ExpenseDetail;
    return {
      refLabel: e.reference ? `Expense #${e.reference}` : 'Expense',
      amount: e.total_amount,
      date: e.transaction_date,
      fields: [
        { label: 'Paid to', value: e.vendor_name ?? e.payee_name ?? e.payee_text ?? '' },
        { label: 'Payment account', value: e.payment_account_name },
        { label: 'Payment method', value: e.payment_method },
        { label: 'Memo', value: e.memo ?? '' },
        { label: 'Status', value: e.status },
      ],
      lines: e.lines.map(l => ({
        primary: l.category_name,
        secondary: l.description ?? l.category_code,
        amount: l.amount,
      })),
    };
  }
  if (type === 'check') {
    const c = data as CheckDetail;
    return {
      refLabel: c.check_number ? `Check #${c.check_number}` : 'Check',
      amount: c.total_amount,
      date: c.payment_date,
      fields: [
        { label: 'Paid to', value: c.vendor_name ?? c.payee_name ?? c.payee_text ?? '' },
        { label: 'Bank account', value: c.bank_account_name },
        { label: 'Memo', value: c.memo ?? '' },
        { label: 'Status', value: c.status },
      ],
      lines: c.lines.map(l => ({
        primary: l.account_name,
        secondary: l.description ?? l.account_code,
        amount: l.amount,
      })),
    };
  }
  // journal
  const j = data as JournalEntryDetail;
  const total = j.lines.reduce((s, l) => s + parseFloat(l.debit || '0'), 0);
  return {
    refLabel: `Journal Entry #${j.entry.journal_number}`,
    amount: String(total),
    date: j.entry.entry_date,
    fields: [
      { label: 'Memo', value: j.entry.memo ?? '' },
      { label: 'Reference', value: j.entry.reference ?? '' },
      { label: 'Status', value: j.entry.status },
    ],
    lines: j.lines.map(l => {
      const debit = parseFloat(l.debit || '0');
      const credit = parseFloat(l.credit || '0');
      return {
        primary: `${l.account_code} ${l.account_name}`,
        secondary: `${debit > 0 ? 'Debit' : 'Credit'}${l.memo ? ` · ${l.memo}` : ''}`,
        amount: String(debit > 0 ? debit : credit),
      };
    }),
  };
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  amountBlock: { alignItems: 'center', marginBottom: spacing.lg, marginTop: spacing.sm },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  fieldRow: { marginBottom: spacing.sm },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
