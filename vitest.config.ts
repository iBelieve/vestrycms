import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The integration provides this module; the control panel's tests get
      // the one a project without Prettier gets.
      "virtual:vestry/formatter": fileURLToPath(
        new URL("./test/ui/formatter-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
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
