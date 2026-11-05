import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  // Check if we're building the service worker
  const isServiceWorker = process.env.BUILD_TARGET === 'service-worker';
  // Check if we're building the content script
  const isContentScript = process.env.BUILD_TARGET === 'content-script';

  if (isServiceWorker) {
    // Separate config for service worker
    return {
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/background/service-worker.js'),
          name: 'ServiceWorker',
          fileName: 'service-worker',
          formats: ['es']
        },
        rollupOptions: {
          output: {
            entryFileNames: 'service-worker.js',
            inlineDynamicImports: true,
          }
        },
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: false,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src')
        }
      }
    };
  }

  if (isContentScript) {
    // Separate config for content script
    return {
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/content/leetcode-integration.js'),
          name: 'ContentScript',
          fileName: 'leetcode-integration',
          formats: ['iife']
        },
        rollupOptions: {
          output: {
            entryFileNames: 'leetcode-integration.js',
            inlineDynamicImports: true,
          }
        },
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: false,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src')
        }
      }
    };
  }

  // Default config for UI components
  return {
    plugins: [react()],
    base: './',
    build: {
      // Optimize chunk sizing for faster initial load
      minify: 'esbuild',
      rollupOptions: {
        input: {
          popup: path.resolve(__dirname, 'popup.html'),
          options: path.resolve(__dirname, 'options.html'),
          blocked: path.resolve(__dirname, 'blocked.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      },
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // Reduce chunk size thresholds for better loading
      chunkSizeWarningLimit: 500,
      // Enable CSS code splitting
      cssCodeSplit: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    }
  };
});