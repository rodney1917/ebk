import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 127.0.0.1 explicitly: 'localhost' can resolve to IPv6 ::1 only, which SSH tunnels (IPv4) can't reach.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { sourcemap: true, target: 'es2022' },
  define: {
    // The in-memory demo backend is compiled out of production builds entirely.
    __EBK_DEMO__: JSON.stringify(process.env.EBK_DEMO === 'true' && process.env.NODE_ENV !== 'production'),
  },
});
