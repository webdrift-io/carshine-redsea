import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Multi-language Vite build configuration.
 * Processes root index.html, ar/index.html, de/index.html.
 * Outputs: dist/{lang}/index.html with extracted, minified, cache-busted assets.
 */

export default defineConfig(({ mode }) => {
  // Default: build all 3 languages
  const langs = mode === 'en' || mode === 'ar' || mode === 'de'
    ? [mode]
    : ['en', 'ar', 'de'];

  return {
    root: '.',
    publicDir: 'shared/public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: 'esbuild',
      cssMinify: true,
      rollupOptions: {
        input: langs.reduce((acc, lang) => {
          acc[`${lang}/index`] = resolve(
            __dirname,
            lang === 'en' ? 'index.html' : `${lang}/index.html`
          );
          return acc;
        }, {}),
        // External CDN imports handled via importmap in HTML
        external: (id) => {
          if (id === 'three') return true;
          if (id.startsWith('three/addons/') || id.startsWith('three/examples/')) return true;
          return false;
        },
        output: {
          // Cache busting with content hashes
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const ext = assetInfo.name.split('.').pop();
            return `assets/[name]-[hash].${ext}`;
          },
          // Code splitting
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('three')) return 'vendor-three';
              if (id.includes('gsap')) return 'vendor-gsap';
              return 'vendor';
            }
          }
        }
      },
      target: 'es2020',
      chunkSizeWarningLimit: 800,
      assetsInlineLimit: 2048
    },
    css: {
      codeSplit: true,
      minify: 'esbuild'
    },
    server: {
      port: 5173,
      open: false
    },
    plugins: [
      {
        name: 'extract-inline-styles',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            // Replace inline <style> blocks with <link> to extracted CSS
            const lang = html.match(/<html[^>]*lang="(\w+)"/)?.[1] || 'en';
            return html.replace(
              /  <style>[\s\S]*?<\/style>/,
              `  <link rel="stylesheet" href="/shared/assets/styles-${lang}.css" data-build="extracted">`
            );
          }
        }
      },
      {
        name: 'inline-style-remover',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            // Final cleanup - remove any remaining inline styles that may be in scripts
            return html;
          }
        }
      }
    ]
  };
});
