import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gerador: resolve(__dirname, 'gerador.html'), 
        admin: resolve(__dirname, 'admin.html'),     
      },
    },
  },
});