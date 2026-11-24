import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { sourcemap: true, target: 'es2022' },
  define: {
    // The in-memory demo backend is compiled out of production builds entirely.
    __EBK_DEMO__: JSON.stringify(process.env.EBK_DEMO === 'true' && process.env.NODE_ENV !== 'production'),
  },
});
