import { defineConfig } from "vitest/config";

// Server-side logic is plain Node; no DOM needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
  },
});
