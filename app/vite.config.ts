import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // относительные пути — работает и на GitHub Pages, и локально
  plugins: [react()],
  // Коммит сборки: по нему приложение понимает, что на сервере появилась новая версия.
  define: {
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA || ''),
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
