import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite on :5173 proxies /api to the Express server on :5174.
// Prod: `vite build` emits dist/, which the Express server serves itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5174",
    },
  },
  build: {
    outDir: "dist",
  },
});
