import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run build:demo` produces a self-contained build (API emulated in the browser, see src/demo)
// that scripts/inline-demo.mjs turns into a single HTML file.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: mode === "demo" ? { "import.meta.env.VITE_DEMO": JSON.stringify("1") } : {},
  build:
    mode === "demo"
      ? { outDir: "dist-demo", rollupOptions: { output: { inlineDynamicImports: true } } }
      : { rollupOptions: { output: { manualChunks: { charts: ["recharts"], vendor: ["react", "react-dom", "react-router-dom"] } } } },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
}));
