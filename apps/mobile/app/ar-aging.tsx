import { AgingReportView } from '../components/AgingReportView';
import { getArAging } from '../services/api';

export default function ArAgingScreen() {
  return (
    <AgingReportView
      title="AR Aging"
      partyLabel="Customer"
      reportKey="ar-aging"
      fetchReport={(businessId, asOf) => getArAging(businessId, { as_of: asOf })}
    />
  );
}
