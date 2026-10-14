import { cn } from '@/lib/utils';
import { SkeletonRows } from './skeleton';

type LoadingIndicatorProps = {
  /** Small dots for inline/button use, instead of the default centered size. */
  size?: 'default' | 'sm';
  /** Sits on top of existing content instead of replacing it — for a refresh
   * that shouldn't clear what's already on screen. The caller's container
   * needs `relative` for this to anchor correctly. */
  overlay?: boolean;
  /** Shape-of-the-content placeholder (table rows) instead of dots, for a
   * first load where showing the eventual layout reads better than a spinner. */
  skeleton?: boolean;
  rows?: number;
  columns?: number;
  /** Screen-reader label; the dots themselves are decorative. */
  label?: string;
  className?: string;
};

/**
 * The app's one loading animation — three dots in the brand blue, pulsing in
 * a wave (see .loading-dots in index.css). Not QBO's bouncing green dots, and
 * used the same way everywhere: page loads, within-page fetches, and (at
 * size="sm") inline in a busy button next to or instead of its label.
 */
export function LoadingIndicator({
  size = 'default', overlay = false, skeleton = false, rows, columns, label = 'Loading', className,
}: LoadingIndicatorProps) {
  if (skeleton) {
    return <SkeletonRows {...(rows !== undefined ? { rows } : {})} {...(columns !== undefined ? { columns } : {})} />;
  }

  // The dots themselves use currentColor (no color class of their own), so
  // size="sm" dropped inline inside a button picks up that button's text
  // color (white on a colored button) automatically. The standalone cases
  // below set text-primary on their wrapper for the plain brand-blue look.
  const dots = (
    <span className={cn('loading-dots inline-flex items-center gap-1.5', size === 'sm' && 'loading-dots--sm gap-1')} role="status" aria-label={label}>
      <span /><span /><span />
    </span>
  );

  if (overlay) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-primary">
        {dots}
      </div>
    );
  }

  if (size === 'sm') return dots;

  return (
    <div className={cn('flex items-center justify-center py-10 text-primary', className)}>
      {dots}
    </div>
  );
}
