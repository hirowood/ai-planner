import { defineConfig } from "vitest/config";

// ベンチ専用 (npm run bench)。通常の npm test には入らない (*.bench.ts は既定の include 外)
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup/env.ts", "./test/setup/no-network.ts"],
    include: ["bench/**/*.bench.ts"],
    testTimeout: 120_000,
  },
});
