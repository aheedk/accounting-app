import { AgingReportView } from '../components/AgingReportView';
import { getApAging } from '../services/api';

export default function ApAgingScreen() {
  return (
    <AgingReportView
      title="AP Aging"
      partyLabel="Vendor"
      reportKey="ap-aging"
      fetchReport={(businessId, asOf) => getApAging(businessId, { as_of: asOf })}
    />
  );
}
