import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Every source file, so code no test loads counts as untested.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      // coverage-final.json is what `pnpm health` reads.
      reporter: ["json", "text-summary"],
    },
  },
});
