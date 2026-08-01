import { existsSync } from "node:fs"
import { defineConfig } from "vitest/config"

// Store tests talk to a real database, so they need the same DATABASE_URL the CLI
// reads. The CLI gets it from node's --env-file flag; vitest has no equivalent, so
// load it here rather than making every contributor export it by hand.
if (existsSync(".env")) {
  process.loadEnvFile(".env")
}

export default defineConfig({
  test: {
    // .repos holds vendored source for reference only; its tests are not ours to run.
    include: ["src/**/*.test.ts", "eval/**/*.test.ts"]
  }
})
