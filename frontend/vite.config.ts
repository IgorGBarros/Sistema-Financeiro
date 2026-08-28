import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
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
