import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gerador: resolve(__dirname, 'gerador.html'), // 👈 Avisa o Vite para incluir esta página no build
      },
    },
  },
});