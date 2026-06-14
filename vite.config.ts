import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl'; // npm i -D @vitejs/plugin-basic-ssl
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [basicSsl(),
          VitePWA({
      registerType: 'autoUpdate', // Автоматически обновлять SW при изменении кода
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Мое PWA Приложение',
        short_name: 'Моё PWA',
        description: 'Описание моего приложения, работающего оффлайн',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // Важно для открытия без интерфейса браузера
        scope: '/',
        start_url: '/',
        // Иконки обязательны для iOS и Android. Минимум 192x192 и 512x512
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable' // Для адаптивных иконок Android
          }
        ]
      },
      workbox: {
        // Стратегия кэширования для оффлайн-работы
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Если пользователь оффлайн и переходит по роуту, отдаем index.html
        navigateFallback: '/index.html',
        // Игнорируем запросы к API или внешним ресурсам, если они не должны кэшироваться
        navigateFallbackDenylist: [/^\/api\//], 
      }
    })
    ], // Добавит локальный HTTPS

  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['wa-sqlite'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    host: true
  },
});