import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Modal, Portal, Text, useTheme } from 'react-native-paper';
import { AppTextInput } from './ui/AppTextInput';
import { AppMenu, AppMenuItem } from './ui/AppMenu';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { listVendors, listCustomers } from '../services/api';
import { PickerField } from './PickerField';
import { SearchablePicker } from './SearchablePicker';
import { AppButton } from './ui/AppButton';
import {
  DATE_PRESETS, DATE_PRESET_LABELS, AMOUNT_OPS, EMPTY_FILTERS,
  type TransactionFilters, type DatePreset, type AmountOp,
} from '../lib/transactionFilters';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'expense', label: 'Expense' },
  { value: 'check', label: 'Check' },
  { value: 'journal', label: 'Journal Entry' },
  { value: 'bill', label: 'Bill' },
  { value: 'payment', label: 'Payment' },
  { value: 'credit_memo', label: 'Credit Memo' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill_payment', label: 'Bill Payment' },
  { value: 'vendor_credit', label: 'Vendor Credit' },
];

/**
 * Same filter set as web's /accounting/transactions page (date range,
 * type, reference number, contact, amount) in one panel instead of a row
 * of type chips — matches our surface/border/radius tokens, not a native
 * action sheet.
 */
export function TransactionFilterPanel({
  visible, onDismiss, filters, onApply,
}: {
  visible: boolean;
  onDismiss: () => void;
  filters: TransactionFilters;
  onApply: (next: TransactionFilters) => void;
}) {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [draft, setDraft] = useState<TransactionFilters>(filters);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [datePresetMenuOpen, setDatePresetMenuOpen] = useState(false);
  const [amountOpMenuOpen, setAmountOpMenuOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);

  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId && visible, staleTime: 5 * 60_000,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId && visible, staleTime: 5 * 60_000,
  });
  const contactOptions = [
    ...(vendorsQuery.data ?? []).map(v => ({ id: v.id, label: v.name, sublabel: 'Vendor' })),
    ...(customersQuery.data ?? []).map(c => ({ id: c.id, label: c.name, sublabel: 'Customer' })),
  ];

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.sheet, { backgroundColor: theme.app.surface }]}>
        <Text style={{ fontSize: typeScale.h2, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.md }}>
          Filter transactions
        </Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          <AppMenu
            visible={typeMenuOpen}
            onDismiss={() => setTypeMenuOpen(false)}
            anchor={
              <PickerField
                label="Type"
                value={TYPE_OPTIONS.find(t => t.value === draft.type)?.label ?? 'All types'}
                onPress={() => setTypeMenuOpen(true)}
              />
            }
          >
            {TYPE_OPTIONS.map(t => (
              <AppMenuItem key={t.value} title={t.label} onPress={() => { setDraft(d => ({ ...d, type: t.value })); setTypeMenuOpen(false); }} />
            ))}
          </AppMenu>

          <AppMenu
            visible={datePresetMenuOpen}
            onDismiss={() => setDatePresetMenuOpen(false)}
            anchor={
              <PickerField
                label="Date range"
                value={DATE_PRESET_LABELS[draft.datePreset]}
                onPress={() => setDatePresetMenuOpen(true)}
              />
            }
          >
            <AppMenuItem title="All dates" onPress={() => { setDraft(d => ({ ...d, datePreset: 'unset' })); setDatePresetMenuOpen(false); }} />
            {DATE_PRESETS.map(p => (
              <AppMenuItem key={p.value} title={p.label} onPress={() => { setDraft(d => ({ ...d, datePreset: p.value as DatePreset })); setDatePresetMenuOpen(false); }} />
            ))}
          </AppMenu>
          {draft.datePreset === 'custom' ? (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppTextInput
                  label="From (YYYY-MM-DD)" value={draft.dateStart}
                  onChangeText={v => setDraft(d => ({ ...d, dateStart: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppTextInput
                  label="To (YYYY-MM-DD)" value={draft.dateEnd}
                  onChangeText={v => setDraft(d => ({ ...d, dateEnd: v }))}
                />
              </View>
            </View>
          ) : null}

          <AppTextInput
            label="Reference number" value={draft.refNo}
            onChangeText={v => setDraft(d => ({ ...d, refNo: v }))}
            placeholder="e.g. 1042"
            containerStyle={{ marginBottom: spacing.md }}
          />

          <PickerField
            label="Contact"
            value={draft.contactLabel}
            placeholder="Any vendor or customer"
            onPress={() => setContactPickerOpen(true)}
          />
          <SearchablePicker
            visible={contactPickerOpen}
            onDismiss={() => setContactPickerOpen(false)}
            title="Pick a contact"
            options={contactOptions}
            onSelect={(contactId) => {
              const match = contactOptions.find(c => c.id === contactId);
              setDraft(d => ({ ...d, contactId, contactLabel: match?.label ?? null }));
            }}
            footer={(
              <AppButton variant="ghost" onPress={() => { setDraft(d => ({ ...d, contactId: null, contactLabel: null })); setContactPickerOpen(false); }}>
                Clear contact
              </AppButton>
            )}
          />

          <FilterLabel theme={theme} text="Amount" />
          <View style={styles.row}>
            <View style={{ flex: 1.2 }}>
              <AppMenu
                visible={amountOpMenuOpen}
                onDismiss={() => setAmountOpMenuOpen(false)}
                anchor={
                  <PickerField
                    label=""
                    value={AMOUNT_OPS.find(o => o.value === draft.amountOp)?.label ?? null}
                    placeholder="Any amount"
                    onPress={() => setAmountOpMenuOpen(true)}
                  />
                }
              >
                <AppMenuItem title="Any amount" onPress={() => { setDraft(d => ({ ...d, amountOp: null })); setAmountOpMenuOpen(false); }} />
                {AMOUNT_OPS.map(o => (
                  <AppMenuItem key={o.value} title={o.label} onPress={() => { setDraft(d => ({ ...d, amountOp: o.value as AmountOp })); setAmountOpMenuOpen(false); }} />
                ))}
              </AppMenu>
            </View>
            {draft.amountOp ? (
              <View style={{ flex: 1 }}>
                <AppTextInput
                  placeholder="0.00" keyboardType="decimal-pad"
                  value={draft.amountValue}
                  onChangeText={v => setDraft(d => ({ ...d, amountValue: v.replace(/[^0-9.]/g, '') }))}
                  left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
                />
              </View>
            ) : null}
          </View>
          {draft.amountOp === 'between' ? (
            <AppTextInput
              placeholder="and… 0.00" keyboardType="decimal-pad"
              value={draft.amountValue2}
              onChangeText={v => setDraft(d => ({ ...d, amountValue2: v.replace(/[^0-9.]/g, '') }))}
              left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
              containerStyle={{ marginBottom: spacing.md }}
            />
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <AppButton variant="outline" onPress={() => { setDraft(EMPTY_FILTERS); onApply(EMPTY_FILTERS); }}>Clear</AppButton>
          <AppButton onPress={() => onApply(draft)}>Apply</AppButton>
        </View>
      </Modal>
    </Portal>
  );
}

function FilterLabel({ theme, text }: { theme: AppTheme; text: string }) {
  return <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium, marginBottom: spacing.xs }}>{text}</Text>;
}

const styles = StyleSheet.create({
  sheet: { margin: spacing.lg, borderRadius: 10, padding: spacing.lg, maxHeight: '85%' },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm,
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
});
