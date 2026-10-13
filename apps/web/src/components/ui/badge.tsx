import { cn } from '@/lib/utils';

export type BadgeStatus = 'green' | 'red' | 'blue' | 'gray';

const STATUS_CLASS: Record<BadgeStatus, string> = {
  green: 'bg-status-green-bg text-status-green-fg',
  red: 'bg-status-red-bg text-status-red-fg',
  blue: 'bg-status-blue-bg text-status-blue-fg',
  gray: 'bg-status-gray-bg text-status-gray-fg',
};

/** A small status pill — Posted/Active (green), Voided (red), Imported (blue), Draft (gray). */
export function Badge({ status, className, children }: { status: BadgeStatus; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[status], className)}>
      {children}
    </span>
  );
}
