import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, Alert } from 'react-native';
import { Text, Appbar, Checkbox, IconButton, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import {
  listEmailImports, listChartOfAccounts, listVendors, createVendor,
  approveEmailImport, rejectEmailImport, type StagedTransaction,
} from '../../services/api';
import { statementBankAccounts } from '../../lib/bankAccountOptions';
import { deriveImportTitle, bestVendorMatch, isInflowLine } from '../../lib/emailImportLabel';
import { pickErr } from '../../services/apiClient';
import { PickerField } from '../../components/PickerField';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { SearchablePicker, type PickerOption } from '../../components/SearchablePicker';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { AppButton } from '../../components/ui/AppButton';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

/** "03/14/2026" -> "3/14/26", matching the rest of the app's date display. */
function fmtStatementDate(mdy: string): string {
  const [m, d, y] = mdy.split('/');
  if (!m || !d || !y) return mdy;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

type LineState = { offsetAccountId: string; payeeName: string; include: boolean; remember: boolean };

export default function InboxReviewScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  // No GET /email-imports/:id exists (confirmed gap) — the list endpoint is
  // the only source, same pattern already used for customer/vendor detail.
  const importsQuery = useQuery({
    queryKey: ['email-imports', activeBusinessId],
    queryFn: () => listEmailImports(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const imp = importsQuery.data?.find(i => i.id === id);

  const [statementAccountId, setStatementAccountId] = useState<string | null>(null);
  const [statementAccountPickerOpen, setStatementAccountPickerOpen] = useState(false);
  const [lineState, setLineState] = useState<Record<number, LineState> | null>(null);
  const [offsetPickerFor, setOffsetPickerFor] = useState<number | null>(null);
  const [payeePickerFor, setPayeePickerFor] = useState<number | null>(null);
  const [statementAccountError, setStatementAccountError] = useState<string | undefined>(undefined);
  const [missingOffsetIndexes, setMissingOffsetIndexes] = useState<Set<number>>(new Set());
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed local edit state once, the first time the import and lookups are
  // all loaded — every edit (offset account, payee override, include,
  // "remember") lives only here until Approve, since there's no per-line
  // save endpoint (confirmed gap — see services/api.ts's comment).
  if (imp && lineState === null && !coaQuery.isLoading && !vendorsQuery.isLoading) {
    const seeded: Record<number, LineState> = {};
    imp.extracted_transactions.forEach((tx, i) => {
      // check_stub's payee wins when a matched check stub exists (same
      // precedence as attachCheckStubs on the API); otherwise the AI's own
      // extracted name, fuzzy-matched against known vendors as a starting
      // point the reviewer can still correct either way.
      const rawName = tx.check_stub?.payee_name ?? tx.payee_name ?? '';
      const matched = rawName ? bestVendorMatch(rawName, vendorsQuery.data ?? []) : null;
      seeded[i] = {
        offsetAccountId: tx.suggested_account_id ?? '',
        payeeName: matched ?? rawName,
        include: true,
        remember: false,
      };
    });
    setLineState(seeded);
    setStatementAccountId(imp.account_id ?? imp.suggested_statement_account_id ?? null);
  }

  const bankingAccountIds = useMemo(() => new Set<string>(), []); // bank_accounts lookup not needed for a card-first heuristic here
  const statementAccountOptions = useMemo(() => {
    if (!imp || !coaQuery.data) return [];
    if (imp.statement_kind === 'credit_card') {
      return coaQuery.data.filter(a => a.account_type === 'liability' && a.detail_type === 'Credit Card');
    }
    return statementBankAccounts(coaQuery.data, bankingAccountIds, statementAccountId ?? '');
  }, [imp, coaQuery.data, bankingAccountIds, statementAccountId]);

  const refreshing = importsQuery.isFetching;

  function updateLine(index: number, patch: Partial<LineState>) {
    setLineState(prev => (prev ? { ...prev, [index]: { ...prev[index]!, ...patch } } : prev));
  }

  async function handleAddVendor(index: number, name: string) {
    try {
      await createVendor(activeBusinessId!, name);
      await queryClient.invalidateQueries({ queryKey: ['vendors', activeBusinessId] });
      updateLine(index, { payeeName: name });
    } catch (e) {
      setServerError(pickErr(e));
    }
  }

  async function approve() {
    if (!imp || !lineState) return;
    const missingOffset = new Set(
      Object.entries(lineState).filter(([, s]) => s.include && !s.offsetAccountId).map(([index]) => Number(index)),
    );
    setStatementAccountError(statementAccountId ? undefined : 'Pick the statement\'s own account first.');
    setMissingOffsetIndexes(missingOffset);
    if (!statementAccountId || missingOffset.size > 0) return;
    setServerError(null);
    setSaving(true);
    try {
      await approveEmailImport(activeBusinessId!, imp.id, {
        bank_account_id: statementAccountId,
        transactions: imp.extracted_transactions.map((_tx, index) => {
          const s = lineState[index]!;
          return {
            index,
            offset_account_id: s.offsetAccountId || (coaQuery.data?.[0]?.id ?? ''),
            include: s.include,
            remember: s.remember,
            payee_name: s.payeeName || undefined,
          };
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['email-imports', activeBusinessId] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  function reject() {
    Alert.alert('Reject this statement?', 'All its extracted transactions are dropped from the queue.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!imp) return;
            setSaving(true);
            try {
              await rejectEmailImport(activeBusinessId!, imp.id);
              await queryClient.invalidateQueries({ queryKey: ['email-imports', activeBusinessId] });
              router.back();
            } catch (e) {
              setServerError(pickErr(e));
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  }

  const loading = importsQuery.isLoading || coaQuery.isLoading || vendorsQuery.isLoading;
  const selectedCount = lineState ? Object.values(lineState).filter(s => s.include).length : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title={imp ? deriveImportTitle(imp) : 'Statement'} titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      {loading ? (
        <LoadingIndicator />
      ) : !imp ? (
        <ErrorState message="Couldn't find this statement." onRetry={() => void importsQuery.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void importsQuery.refetch()} tintColor={theme.app.primary} />}
        >
          <PickerField
            label={imp.statement_kind === 'credit_card' ? 'Card account' : 'Bank account'}
            value={coaQuery.data?.find(a => a.id === statementAccountId) ? `${coaQuery.data!.find(a => a.id === statementAccountId)!.code} — ${coaQuery.data!.find(a => a.id === statementAccountId)!.name}` : null}
            onPress={() => setStatementAccountPickerOpen(true)}
            error={statementAccountError}
          />
          <SearchablePicker
            visible={statementAccountPickerOpen}
            onDismiss={() => setStatementAccountPickerOpen(false)}
            title="Pick the statement's own account"
            options={statementAccountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
            onSelect={setStatementAccountId}
          />

          {imp.extracted_transactions.map((tx, index) => (
            <LineCard
              key={index}
              tx={tx}
              state={lineState?.[index]}
              theme={theme}
              coaOptions={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
              vendorOptions={(vendorsQuery.data ?? []).map(v => ({ id: v.name, label: v.name }))}
              onToggleInclude={(v) => updateLine(index, { include: v })}
              onToggleRemember={(v) => updateLine(index, { remember: v })}
              onPickOffset={() => setOffsetPickerFor(index)}
              onPickPayee={() => setPayeePickerFor(index)}
              offsetError={missingOffsetIndexes.has(index) ? 'Pick an offset account.' : undefined}
            />
          ))}

          <SearchablePicker
            visible={offsetPickerFor !== null}
            onDismiss={() => setOffsetPickerFor(null)}
            title="Pick an offset account"
            options={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
            onSelect={(accountId) => { if (offsetPickerFor !== null) updateLine(offsetPickerFor, { offsetAccountId: accountId }); }}
          />
          <SearchablePicker
            visible={payeePickerFor !== null}
            onDismiss={() => setPayeePickerFor(null)}
            title="Pick a vendor"
            options={(vendorsQuery.data ?? []).map(v => ({ id: v.name, label: v.name }))}
            onSelect={(name) => { if (payeePickerFor !== null) updateLine(payeePickerFor, { payeeName: name }); }}
            footer={<AddVendorFooter theme={theme} onAdd={(name) => { if (payeePickerFor !== null) void handleAddVendor(payeePickerFor, name); setPayeePickerFor(null); }} />}
          />

          {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.sm }}>{serverError}</Text> : null}
        </ScrollView>
      )}

      {imp ? (
        <View style={[styles.footer, { borderTopColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
          <AppButton variant="destructive" onPress={reject} disabled={saving} style={{ flex: 1, marginRight: spacing.sm }}>
            Reject
          </AppButton>
          <AppButton onPress={() => void approve()} disabled={selectedCount === 0} loading={saving} style={{ flex: 1 }}>
            {`Approve selected (${selectedCount})`}
          </AppButton>
        </View>
      ) : null}
    </View>
  );
}

function LineCard({
  tx, state, theme, coaOptions, vendorOptions, onToggleInclude, onToggleRemember, onPickOffset, onPickPayee, offsetError,
}: {
  tx: StagedTransaction; state: LineState | undefined; theme: AppTheme;
  coaOptions: PickerOption[]; vendorOptions: PickerOption[];
  onToggleInclude: (v: boolean) => void; onToggleRemember: (v: boolean) => void;
  onPickOffset: () => void; onPickPayee: () => void; offsetError?: string;
}) {
  const inflow = isInflowLine(tx);
  const offsetAccount = coaOptions.find(a => a.id === state?.offsetAccountId);
  return (
    <View style={[styles.lineCard, { borderColor: theme.app.border, backgroundColor: theme.app.surface, opacity: state?.include === false ? 0.6 : 1 }]}>
      <View style={styles.lineTop}>
        <Checkbox status={state?.include ? 'checked' : 'unchecked'} onPress={() => onToggleInclude(!state?.include)} color={theme.app.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>{tx.description}</Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtStatementDate(tx.date)}</Text>
        </View>
        <Text style={{ color: inflow ? theme.app.statusGreenFg : theme.app.statusRedFg, fontWeight: '700' }}>
          {inflow ? '+' : '-'}${fmtMoney(tx.amount)}
        </Text>
      </View>

      <ConfidenceBadge suggestion={tx.suggestion} />

      <EditableField
        theme={theme} label="Payee" value={state?.payeeName || null} placeholder="Tap to pick a vendor"
        onPress={onPickPayee}
      />

      <EditableField
        theme={theme} label="Offset account" value={offsetAccount?.label ?? null} placeholder="Tap to pick an account"
        onPress={onPickOffset} error={offsetError}
      />

      <Pressable style={styles.rememberRow} onPress={() => onToggleRemember(!state?.remember)}>
        <Checkbox status={state?.remember ? 'checked' : 'unchecked'} onPress={() => onToggleRemember(!state?.remember)} color={theme.app.primary} />
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, flex: 1 }}>
          Remember this account for {state?.payeeName || 'this payee'}
        </Text>
      </Pressable>
    </View>
  );
}

// Payee/Offset account previously rendered as plain text once set, with no
// visual cue they were still tappable — looked identical to a static label.
// Styled like the rest of the app's PickerField now (bordered box + chevron)
// so it unambiguously reads as an editable control, same as web's inline
// dropdowns on this screen.
function EditableField({
  theme, label, value, placeholder, onPress, error,
}: { theme: AppTheme; label: string; value: string | null; placeholder: string; onPress: () => void; error?: string }) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginBottom: 2 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={[
          styles.editableField,
          { borderColor: error ? theme.app.destructive : theme.app.border, backgroundColor: theme.app.page },
        ]}
      >
        <Text style={{ color: value ? theme.app.foreground : theme.app.mutedForeground, flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={theme.app.mutedForeground} />
      </Pressable>
      {error ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginTop: 2 }}>{error}</Text> : null}
    </View>
  );
}

function AddVendorFooter({ theme, onAdd }: { theme: AppTheme; onAdd: (name: string) => void }) {
  const [text, setText] = useState('');
  return (
    <View style={{ paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }}>
      <AppTextInput
        placeholder="+ Add new vendor"
        value={text}
        onChangeText={setText}
        right={text ? <IconButton icon="check" size={18} onPress={() => onAdd(text)} style={{ margin: 0 }} /> : undefined}
        onSubmitEditing={() => text && onAdd(text)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  lineCard: { borderWidth: 1, borderRadius: 12, padding: spacing.sm, marginBottom: spacing.sm },
  lineTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  editableField: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: spacing.sm, minHeight: minTouchTarget - 8,
  },
  rememberRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  footer: {
    flexDirection: 'row', padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
    position: 'absolute', left: 0, right: 0, bottom: 0,
  },
});
