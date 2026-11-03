import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API answers under /api itself, so this forwards requests as they are, as production does.
// /admin goes to the admin app, as it would for a deployment that shares one address.
const proxy = {
  "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
  "^/admin(/|$)": process.env.ADMIN_PROXY_TARGET ?? "http://localhost:5181",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true, proxy },
  preview: { strictPort: true, proxy },
});
