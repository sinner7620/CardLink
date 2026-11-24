import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: { "/h1": "http://127.0.0.1:7310" },
  },
});
