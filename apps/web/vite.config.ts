import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// On a developer's computer the web app asks its own address for /api and Vite passes it on
// to the API, so the sign-in cookie is first-party exactly as it is online. `--mode demo` (pnpm
// dev:demo) is the demo company beside it: web on :5181, its API on :4101 (.data/demo).
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  const api = process.env.API_URL ?? (demo ? "http://localhost:4101" : "http://localhost:4100");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: demo ? 5181 : 5180,
      strictPort: true,
      // /webhooks too: Meta and the websites call the address the web app is on.
      proxy: { "/api": api, "/webhooks": api },
    },
  };
});
