import { defineConfig } from "vitest/config";
import path from "node:path";

// Aliased straight to each package's source, not its built `dist/` --
// tests run against the code you just edited, no build step in the loop,
// and CI still runs `pnpm build`/`typecheck` separately to catch anything
// a source-level test wouldn't (declaration output, cross-package types).
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@oauth-spa-kit/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@oauth-spa-kit/server": path.resolve(__dirname, "packages/server/src/index.ts"),
    },
  },
});
