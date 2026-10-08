import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // The runner can report many CPUs on memory-constrained developer machines.
    maxWorkers: 2,
    setupFiles: ["./test/storage-isolation.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
  },
})
