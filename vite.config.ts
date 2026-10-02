import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBase(base?: string) {
  const trimmed = base?.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  let withoutTrailingSlash = withLeadingSlash;
  while (withoutTrailingSlash.endsWith('/')) {
    withoutTrailingSlash = withoutTrailingSlash.slice(0, -1);
  }
  return `${withoutTrailingSlash}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: normalizeBase(env.VITE_BASE),
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      host: true,
      port: 3000,
    },
  };
});
