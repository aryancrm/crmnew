import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// On a developer's computer the web app asks its own address for /api and Vite passes it on
// to the API, so the sign-in cookie is first-party exactly as it is online.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    // /webhooks too: Meta and the websites call the address the web app is on.
    proxy: { "/api": process.env.API_URL ?? "http://localhost:4100", "/webhooks": process.env.API_URL ?? "http://localhost:4100" },
  },
});
