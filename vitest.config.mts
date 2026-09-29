import { defineConfig } from "vitest/config";

// tsconfig.json に paths alias は無いので、ここでも alias は定義しない (相対 import のまま)
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup/env.ts", "./test/setup/no-network.ts"],
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
