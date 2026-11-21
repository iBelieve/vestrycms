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
      // A site with a `pages` preview; the tests set how it checks requests.
      "virtual:vestry/preview": fileURLToPath(
        new URL("./test/preview-stub.ts", import.meta.url),
      ),
      // No bundled logo, so the panel loads it through the API.
      "virtual:vestry/logo": fileURLToPath(
        new URL("./test/ui/logo-stub.ts", import.meta.url),
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
