import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));

// Append "-dev" suffix when building locally (CI builds produce clean versions)
const version = process.env.CI ? pkg.version : `${pkg.version}-dev`;

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/ui'),
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/ui/ui.html'),
    },
  },
});
