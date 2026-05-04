import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET;
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      proxy: proxyTarget
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              secure: true,
              rewrite: (p) => p.replace(/^\/api/, ''),
              cookiePathRewrite: { '/auth': '/api/auth' },
              configure: (proxy) => {
                // Remove the browser's Origin header so the upstream API doesn't
                // treat this as a cross-origin browser call. The API allows
                // requests with no Origin (it's the proxy now, not a browser).
                proxy.on('proxyReq', (proxyReq) => {
                  proxyReq.removeHeader('origin');
                });
              },
            },
          }
        : undefined,
    },
  };
});
