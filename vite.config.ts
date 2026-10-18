import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// @ts-expect-error type error without @types/node package
import process from 'node:process';
// @ts-expect-error type error without @types/node package
import { readFileSync } from 'node:fs';
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    vue(),
    {
      name: 'pam-build-identity',
      generateBundle() {
        if (!process.env.PAM_BUILD_IDENTITY) return;
        const { version, commit, buildId } = JSON.parse(
          readFileSync(process.env.PAM_BUILD_IDENTITY, 'utf8'),
        );
        this.emitFile({
          type: 'asset',
          fileName: 'build-identity.json',
          source: JSON.stringify({ version, commit, buildId }),
        });
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
