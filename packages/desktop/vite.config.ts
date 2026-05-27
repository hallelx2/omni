import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

// Tauri expects a fixed dev-server port and quiet output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
