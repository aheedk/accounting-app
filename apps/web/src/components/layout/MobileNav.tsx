import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { SidebarBrand, SidebarNav } from './Sidebar';

// Off-canvas navigation drawer shown below the `lg` breakpoint, where the static
// sidebar is hidden. Tapping a destination closes the drawer.
export function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left">
        <SheetTitle className="sr-only">Main navigation</SheetTitle>
        <SidebarBrand />
        <SidebarNav expandOnHover={false} onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
