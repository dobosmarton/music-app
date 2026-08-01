import { PgClient, PgMigrator } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { MIGRATIONS_TABLE } from "../Migrations.ts"
import { migrations } from "../migrations/index.ts"

/**
 * A real Postgres for store tests, on its own database beside the development one.
 *
 * Faking `SqlClient` would test the code around the queries rather than the queries
 * themselves, and the queries are the part most likely to be wrong — null-stripped
 * JSON documents, vector casts and upsert conflict targets all fail silently against
 * a fake. This needs Docker running.
 */
const TEST_DATABASE = "music_test"

/** Postgres cannot create a database from a connection to that same database. */
const MAINTENANCE_DATABASE = "postgres"

const withDatabaseName = (url: string, name: string) => {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

const developmentUrl = Effect.gen(function*() {
  return yield* Config.string("DATABASE_URL")
})

/**
 * Create the test database if it is missing, from a throwaway connection to the
 * maintenance database. `CREATE DATABASE` cannot run inside a transaction, so this
 * cannot simply be a migration.
 */
const ensureTestDatabase = Layer.effectDiscard(
  Effect.gen(function*() {
    const url = yield* developmentUrl
    const create = Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const existing = yield* sql<{ present: boolean }>`
        SELECT count(*) > 0 AS present FROM pg_database WHERE datname = ${TEST_DATABASE}
      `
      if (existing[0]?.present !== true) {
        yield* sql`CREATE DATABASE ${sql(TEST_DATABASE)}`.withoutTransform
      }
    })

    yield* create.pipe(
      Effect.provide(
        PgClient.layer({
          url: Redacted.make(withDatabaseName(url, MAINTENANCE_DATABASE)),
          applicationName: "music-app-test-setup"
        })
      )
    )
  })
)

const TestClientLive = Layer.unwrap(
  Effect.map(developmentUrl, (url) =>
    PgClient.layer({
      url: Redacted.make(withDatabaseName(url, TEST_DATABASE)),
      applicationName: "music-app-test"
    }))
).pipe(Layer.provide(ensureTestDatabase))

const MigratedLive = Layer.effectDiscard(
  PgMigrator.run({ loader: migrations, table: MIGRATIONS_TABLE })
).pipe(Layer.provide(TestClientLive))

/** The migrated test database, ready to have repositories layered on top. */
export const TestDatabaseLive = Layer.merge(TestClientLive, MigratedLive)

/** Empty every table so each test group starts from a known state. */
export const truncateAll = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    TRUNCATE recording, external_id, feature, lyric_signal, feedback, upstream_call
    RESTART IDENTITY CASCADE
  `.withoutTransform
})
