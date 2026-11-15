import { defineConfig } from "vitest/config";

// Each test file opens its own embedded Postgres, migrates and seeds it: on a busy computer that
// can take longer than vitest's default ten seconds.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000 },
});
