import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock } from 'lucide-react';

type Props = {
  title: string;
  description?: string;
  eta?: string;
};

export default function ComingSoonPage({ title, description, eta }: Props) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-xl border-primary/10 shadow-md">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Clock className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            {description ?? `The ${title} workspace is still being built.`}
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-secondary px-4 py-1.5 text-xs font-medium text-secondary-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Coming soon{eta ? ` · Scheduled for ${eta}` : ''}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
