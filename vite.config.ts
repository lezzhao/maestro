import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@radix-ui") || id.includes("cmdk")) return "vendor-ui";
          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("/remark-") ||
            id.includes("/mdast-") ||
            id.includes("/micromark-") ||
            id.includes("/hast-") ||
            id.includes("/unist-") ||
            id.includes("/vfile") ||
            id.includes("/property-information") ||
            id.includes("/comma-separated-tokens") ||
            id.includes("/space-separated-tokens") ||
            id.includes("/decode-named-character-reference") ||
            id.includes("/character-entities")
          ) {
            return "vendor-markdown";
          }
          if (
            id.includes("react-syntax-highlighter") ||
            id.includes("/refractor/") ||
            id.includes("/prismjs/") ||
            id.includes("/highlight.js/") ||
            id.includes("/lowlight/")
          ) {
            return undefined;
          }
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and other backend-generated folders
      ignored: ["**/src-tauri/**", "**/.maestro-cli/**", "**/.git/**", "**/.bmad/**"],
    },
  },
}));
