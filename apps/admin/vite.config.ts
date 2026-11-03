import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API answers under /api itself, so this forwards requests as they are, as production does.
const proxy = { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000" };

// The admin app always lives under /admin, whether it has an address of its own or shares one with
// a community. Only what sits in front of it changes. See ADR 21.
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: { port: 5181, strictPort: true, proxy },
  preview: { strictPort: true, proxy },
});
