import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    // daily-js is one legitimately large chunk; hush Vite's 500kB grumble so
    // real problems stand out in build logs.
    chunkSizeWarningLimit: 1200,
    // Two pages: the builder (/) and the Apex Wealth demo console (/apex).
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        apex: resolve(__dirname, "apex/index.html"),
      },
    },
  },
  server: {
    // When running the UI alone (npm run dev:ui), proxy /api to `vercel dev`
    // running on 3000 so persona generation still works.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
