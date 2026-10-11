import { defineConfig } from "vitest/config";

export default defineConfig({
  // Integration tests share one test database, so test files run one after another.
  test: { fileParallelism: false },
});
