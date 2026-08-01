import { Effect, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"

/**
 * The table the migrator records applied migrations in. Passed explicitly to the
 * migrator as well as read here, so the two can never drift apart.
 */
export const MIGRATIONS_TABLE = "effect_sql_migrations"

const AppliedMigration = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  appliedAt: Schema.Date
})

const decodeAppliedMigrations = Schema.decodeUnknownEffect(Schema.Array(AppliedMigration))
const decodeTablePresence = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ present: Schema.Boolean }))
)

/**
 * Applied migrations, newest first.
 *
 * A database that has never been migrated has no migrations table, which would
 * otherwise fail as a missing relation. `to_regclass` returns NULL for an absent
 * table, so that state answers "nothing applied" instead of erroring — and callers
 * get one shape to handle rather than two.
 */
export const readAppliedMigrations = Effect.fn("Migrations.readApplied")(function*() {
  const sql = yield* SqlClient.SqlClient

  const presence = yield* decodeTablePresence(
    yield* sql`SELECT to_regclass(${MIGRATIONS_TABLE}) IS NOT NULL AS present`
  )
  if (presence[0]?.present !== true) {
    return []
  }

  return yield* decodeAppliedMigrations(
    yield* sql`
      SELECT migration_id AS "id", name, created_at AS "appliedAt"
      FROM ${sql(MIGRATIONS_TABLE)}
      ORDER BY migration_id DESC
    `
  )
})
