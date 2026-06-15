import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import i18nPlugin from './vite-plugins/i18n.js';
import sriPlugin from './vite-plugins/sri.js';
import cacheBustPlugin from './vite-plugins/cache-bust.js';

export default defineConfig(({ mode }) => {
  // Language-specific configuration
  const langConfig = {
    en: { lang: 'en', dir: 'ltr', title: 'Carshine Redsea | Mobile Waterless Car Wash in El Gouna, Hurghada & Sahl Hasheesh' },
    ar: { lang: 'ar', dir: 'rtl', title: 'كارشاين ريد سي | غسيل عربيات متنقل من غير هدر مياه في الجونة والغردقة وسهل حشيش' },
    de: { lang: 'de', dir: 'ltr', title: 'Carshine Redsea | Mobile wasserlose Autowäsche in El Gouna, Hurghada & Sahl Hasheesh' }
  };

  const buildLang = langConfig[mode] ? mode : 'en';
  const currentLang = langConfig[buildLang];

  return {
    root: '.',
    publicDir: 'public',
    
    build: {
      outDir: `dist/${buildLang}`,
      emptyOutDir: true,
      
      // Minification
      minify: 'esbuild',
      cssMinify: true,
      
      // Chunk size warning limit
      chunkSizeWarningLimit: 500,
      
      rollupOptions: {
        input: {
          main: `index.${buildLang}.html`
        },
        output: {
          // Content-hash based cache busting for all assets
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const ext = assetInfo.name.split('.').pop();
            return `assets/[name]-[hash].${ext}`;
          },
          
          // Code splitting strategy
          manualChunks(id) {
            // Three.js gets its own chunk (large, only loaded on hero)
            if (id.includes('three') || id.includes('hero-three')) {
              return 'vendor-three';
            }
            // GSAP animations
            if (id.includes('gsap') || id.includes('animations')) {
              return 'vendor-gsap';
            }
            // Booking form + location
            if (id.includes('booking-form') || id.includes('location')) {
              return 'feature-booking';
            }
            // Modals + offer popup
            if (id.includes('modals') || id.includes('offer-popup')) {
              return 'feature-modals';
            }
            // Shared utilities (used everywhere)
            if (id.includes('/shared/')) {
              return 'shared';
            }
          }
        }
      }
    },
    
    // CSS code splitting
    css: {
      codeSplit: true,
      minify: true
    },
    
    plugins: [
      // i18n transformation (must run first)
      i18nPlugin({ debug: process.env.NODE_ENV !== 'production' }),
      // Legacy browser support
      legacy({
        targets: ['defaults', 'not IE 11'],
        modernPolyfills: true
      }),
      // SRI preparation (after build)
      sriPlugin(),
      // Cache busting for non-hashed assets
      cacheBustPlugin()
    ],
    
    // Define language-specific variables
    define: {
      __LANG__: JSON.stringify(currentLang.lang),
      __DIR__: JSON.stringify(currentLang.dir),
      __TITLE__: JSON.stringify(currentLang.title)
    },
    
    // Development server
    server: {
      port: 5173,
      open: true
    },
    
    // Preview server
    preview: {
      port: 4173
    }
  };
});
