import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API answers under /api itself, so this forwards requests as they are, as production does.
const proxy = { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5181, strictPort: true, proxy },
  preview: { strictPort: true, proxy },
});
