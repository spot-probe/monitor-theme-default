import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // import.meta.dirname rather than new URL(...).pathname: the latter is
  // URL-encoded, so a checkout under a path containing a space or a non-ASCII
  // name resolves to %20 and the alias silently points nowhere.
  resolve: { alias: { "@": import.meta.dirname + "/src" } },
  build: {
    chunkSizeWarningLimit: 900,
    // Country flags stay files. Vite would inline every one under 4 KiB -- which
    // is all of them -- as a data URL, and since the page imports the whole set
    // for `Country` to choose from, all 267 would then ship in the entry chunk
    // whatever countries a hub's nodes are actually in.
    assetsInlineLimit: (file) => (file.includes("/country-flag-icons/") ? false : undefined),
  },
  server: { proxy: { "/api": { target: "http://127.0.0.1:9911", ws: true } } },
})
