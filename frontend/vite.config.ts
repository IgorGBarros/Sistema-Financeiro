import path from "node:path";

import react from "@vitejs/plugin-react";
// defineConfig do vitest, não do vite: só ele conhece a chave `test`.
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Sistema Financeiro",
        short_name: "Financeiro",
        description:
          "Controle de receitas e despesas, com leitura de cupom fiscal.",
        lang: "pt-BR",
        start_url: "/fluxo",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icone-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Ler cupom",
            short_name: "Cupom",
            url: "/notas?scan=1",
            icons: [{ src: "/icone-192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        // O app inteiro entra no precache: abrir offline precisa funcionar,
        // senão a fila de cupons não serve para nada — a pessoa não conseguiria
        // nem abrir o scanner sem sinal.
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "/index.html",
        // A API NÃO é cacheada, de propósito. Saldo e projeção desatualizados
        // são pior que ausentes: a pessoa tomaria decisão financeira com número
        // velho sem saber. Offline, as telas de dados mostram erro claro;
        // só o scanner continua funcionando.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Service worker desligado em desenvolvimento: cache agressivo durante
        // o dia a dia gera "por que minha mudança não aparece?".
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // jsdom fornece o localStorage que a fila usa.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  build: {
    rollupOptions: {
      output: {
        // O scanner é usado no celular, muitas vezes em rede fraca dentro do
        // mercado. Separar os pesados (câmera, gráficos, Firebase) faz a
        // primeira tela abrir sem baixar o app inteiro.
        manualChunks: {
          scanner: ["html5-qrcode"],
          graficos: ["recharts"],
          firebase: ["firebase/app", "firebase/auth"],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Evita configurar CORS em desenvolvimento: o Vite repassa /api para o
    // Django, então o navegador enxerga tudo na mesma origem.
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
