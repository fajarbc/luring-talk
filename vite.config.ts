import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

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
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: [
          'icon.svg',
          'icon-192.png',
          'icon-512.png',
          'icon-512-maskable.png',
        ],
        manifest: {
          name: 'LuringTalk Call',
          short_name: 'LuringTalk',
          description: 'Offline peer-to-peer video calling over a local Wi-Fi network.',
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#050505',
          theme_color: '#00d4ff',
          orientation: 'portrait',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
        },
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      host: true,
      port: 3000,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
