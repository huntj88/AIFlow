import path from 'node:path';

import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
