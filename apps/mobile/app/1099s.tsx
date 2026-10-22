import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { getTenNinetyNineReport, type TenNinetyNineRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

const currentYear = new Date().getFullYear();
const YEARS = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

/** No $600 threshold logic server-side (every nonzero total is returned) —
 * mobile flags the IRS reporting threshold client-side, same as a human
 * reading the list would, not duplicated business logic the API doesn't have. */
const REPORTING_THRESHOLD = 600;

export default function TenNinetyNineScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [yearMenuOpen, setYearMenuOpen] = useState(false);

  const query = useQuery({
    queryKey: ['1099', activeBusinessId, year],
    queryFn: () => getTenNinetyNineReport(activeBusinessId!, year),
    enabled: !!activeBusinessId,
  });

  const rows = query.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + parseFloat(r.total_paid), 0);
  const overThreshold = rows.filter(r => parseFloat(r.total_paid) >= REPORTING_THRESHOLD).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="1099s" />

      <View style={styles.filterBar}>
        <AppMenu
          visible={yearMenuOpen}
          onDismiss={() => setYearMenuOpen(false)}
          anchor={
            <Pressable onPress={() => setYearMenuOpen(true)} style={[styles.yearField, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{year}</Text>
              <MaterialCommunityIcons name="chevron-down" size={18} color={theme.app.mutedForeground} />
            </Pressable>
          }
        >
          {YEARS.map(y => (
            <AppMenuItem key={y} title={String(y)} trailingIcon={y === year ? 'check' : undefined} onPress={() => { setYear(y); setYearMenuOpen(false); }} />
          ))}
        </AppMenu>
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
            <View style={styles.statsRow}>
              <Stat theme={theme} label="Contractors paid" value={String(rows.length)} />
              <Stat theme={theme} label="Total paid" value={`$${fmtMoney(total)}`} />
              <Stat theme={theme} label="Over $600" value={String(overThreshold)} />
            </View>
          </AppCard>

          {rows.length === 0 ? (
            <EmptyState icon="file-document-outline" message={`No 1099 payments recorded for ${year}.`} />
          ) : (
            <AppCard>
              {rows.map((row, i) => (
                <RowItem key={row.vendor_id} row={row} theme={theme} last={i === rows.length - 1} />
              ))}
            </AppCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ theme, label, value }: { theme: AppTheme; label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function RowItem({ row, theme, last }: { row: TenNinetyNineRow; theme: AppTheme; last: boolean }) {
  const eligible = parseFloat(row.total_paid) >= REPORTING_THRESHOLD;
  const maskedId = row.tax_id_last_four
    ? (row.tax_id_type === 'EIN' ? `**-***${row.tax_id_last_four}` : `***-**-${row.tax_id_last_four}`)
    : 'No tax ID';
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{row.vendor_name}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{maskedId}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(row.total_paid)}</Text>
        {!eligible ? <Text style={{ color: theme.app.mutedForeground, fontSize: 10 }}>Under $600</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  yearField: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: minTouchTarget - 8, borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.sm, alignSelf: 'flex-start' },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
});
