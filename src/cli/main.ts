import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { PgMigrator } from "@effect/sql-pg"
import { Console, Effect, Runtime } from "effect"
import { Command } from "effect/unstable/cli"
import { DatabaseLive } from "../store/Database.ts"
import { MIGRATIONS_TABLE, readAppliedMigrations } from "../store/Migrations.ts"
import { migrations } from "../store/migrations/index.ts"
import { quota } from "./commands/quota.ts"
import { trackLookup } from "./commands/track.ts"

// Commands that need a database attach it themselves. Providing it globally would
// build a connection pool for every invocation, including `--help` on a machine that
// has no DATABASE_URL.
const migrate = Command.make("db:migrate", {}, () =>
  Effect.gen(function*() {
    const applied = yield* PgMigrator.run({ loader: migrations, table: MIGRATIONS_TABLE })
    if (applied.length === 0) {
      return yield* Console.log("Already up to date.")
    }
    yield* Effect.forEach(applied, ([id, name]) => Console.log(`Applied ${id} ${name}`))
  })).pipe(
    Command.provide(DatabaseLive),
    Command.withDescription("Apply any pending migrations.")
  )

const status = Command.make("db:status", {}, () =>
  Effect.gen(function*() {
    const applied = yield* readAppliedMigrations()
    const latest = applied[0]
    yield* Console.log(
      latest === undefined
        ? "No migrations applied yet. Run: pnpm cli db:migrate"
        : `Schema version ${latest.id} (${latest.name}), ${applied.length} applied.`
    )
  })).pipe(
    Command.provide(DatabaseLive),
    Command.withDescription("Show the applied schema version.")
  )

const cli = Command.make("music").pipe(
  Command.withDescription("Vibe-driven music recommendation engine."),
  Command.withSubcommands([migrate, status, trackLookup, quota])
)

/**
 * Say plainly what happened, for the failures the runtime has been told not to report.
 *
 * Those failures are answers rather than malfunctions — an absent track, a queued
 * ingest, a spent allowance — so they suppress the usual stack trace. Something still
 * has to print them, and it belongs here rather than in any one command: a missing key
 * fails while the layer is being built, before a command body ever runs.
 *
 * Keying off the marker rather than a list of tags means this cannot fall out of step
 * with the errors themselves. Anything that opts out of reporting gets reported here.
 */
const announceQuietFailures = Effect.tapError((error: unknown) =>
  error instanceof Error && !Runtime.getErrorReported(error)
    ? Console.log(error.message)
    : Effect.void
)

// Only the platform services the CLI itself needs. The database is attached per
// command, so help and version work without one.
Command.run(cli, { version: "0.0.0" }).pipe(
  announceQuietFailures,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
