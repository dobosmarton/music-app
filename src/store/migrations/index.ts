import { Migrator } from "effect/unstable/sql"
import { migration as init } from "./0001_init.ts"

/**
 * Migrations are listed explicitly rather than discovered from disk. Static imports
 * keep this working under Node's type stripping, and an accidental rename cannot
 * silently change which migrations run.
 *
 * Keys are `<id>_<name>` and must never be reordered or renumbered once applied.
 */
export const migrations = Migrator.fromRecord({
  "0001_init": init
})
