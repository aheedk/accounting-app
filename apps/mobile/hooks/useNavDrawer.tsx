import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type NavDrawerState = { isOpen: boolean; open: () => void; close: () => void; toggle: () => void };

const NavDrawerContext = createContext<NavDrawerState | null>(null);

export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo<NavDrawerState>(() => ({
    isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false), toggle: () => setIsOpen(v => !v),
  }), [isOpen]);
  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}

export function useNavDrawer(): NavDrawerState {
  const ctx = useContext(NavDrawerContext);
  if (!ctx) throw new Error('useNavDrawer must be used within NavDrawerProvider');
  return ctx;
}
