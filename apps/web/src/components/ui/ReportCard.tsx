import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';

// QBO-style report frame: centered company name / report title / as-of line,
// report body (usually a table), and a centered generated-at footer.
export function ReportCard({
  companyName,
  title,
  subtitle,
  children,
}: {
  companyName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const generatedAt = new Date().toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="text-center">
          <div className="text-2xl font-semibold">{companyName}</div>
          <div className="mt-1 text-sm font-medium text-muted-foreground">{title}</div>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        </div>
        {children}
        <div className="border-t pt-4 text-center text-xs text-muted-foreground">{generatedAt}</div>
      </CardContent>
    </Card>
  );
}
