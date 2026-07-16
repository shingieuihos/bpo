import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Tests run in Node, where the real `server-only` throws by design.
      // The Next.js build still enforces the boundary; see the stub's note.
      "server-only": fileURLToPath(
        new URL("./src/lib/ingestion/__fixtures__/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
