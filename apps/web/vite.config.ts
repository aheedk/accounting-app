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
    },
  };
});
