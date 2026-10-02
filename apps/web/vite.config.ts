import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET;
  const proxy: Record<string, ProxyOptions> | undefined = proxyTarget
    ? {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
          cookiePathRewrite: { '/auth': '/api/auth' },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin');
            });
          },
        },
      }
    : undefined;
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      ...(proxy ? { proxy } : {}),
      // Pre-transform these on server start instead of on first visit. Without
      // this, Vite dev mode transforms a route's whole module graph lazily on
      // its first request after every `vite` restart — the actual source of
      // the "10 second first click" reports, not API or DB latency (both
      // measured in the single-digit milliseconds, see the debugging that
      // informed this change).
      warmup: {
        clientFiles: [
          './src/pages/accounting/BankDepositPage.tsx',
          './src/pages/accounting/BankDepositListPage.tsx',
          './src/pages/reports/GeneralLedgerPage.tsx',
          './src/pages/accounting/RecurringTransactionsPage.tsx',
        ],
      },
    },
  };
});
