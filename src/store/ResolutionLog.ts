import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import type { SqlError } from "effect/unstable/sql"
import type { Source } from "../domain/Provenance.ts"

/**
 * A record of every attempt to resolve something, whether or not it reached the
 * network.
 *
 * The monthly request allowance is the scarce resource in this system, so it has to be
 * observable from the first request rather than reconstructed later from vendor
 * invoices. Logging hits as well as misses is what makes the hit rate — the number
 * that actually predicts whether the allowance will last — computable.
 */
export class Attempt extends Schema.Class<Attempt>("Attempt")({
  source: Schema.NonEmptyString,
  endpoint: Schema.NonEmptyString,
  cacheHit: Schema.Boolean,
  status: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Int)
}) {}

export class UsageSummary extends Schema.Class<UsageSummary>("UsageSummary")({
  source: Schema.NonEmptyString,
  hits: Schema.Int,
  misses: Schema.Int
}) {}

const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(UsageSummary))

export class ResolutionLog extends Context.Service<ResolutionLog, {
  readonly record: (attempt: Attempt) => Effect.Effect<void, SqlError.SqlError>
  /** Attempts since the given instant, grouped by source. */
  readonly summarize: (
    since: Date
  ) => Effect.Effect<ReadonlyArray<UsageSummary>, SqlError.SqlError | Schema.SchemaError>
}>()("ResolutionLog") {}

export const ResolutionLogLive = Layer.effect(ResolutionLog)(
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    const record = Effect.fn("ResolutionLog.record")(function*(attempt: Attempt) {
      yield* sql`
        INSERT INTO upstream_call (source, endpoint, cache_hit, status, duration_ms)
        VALUES (
          ${attempt.source},
          ${attempt.endpoint},
          ${attempt.cacheHit},
          ${attempt.status ?? null},
          ${attempt.durationMs ?? null}
        )
      `
    })

    const summarize = Effect.fn("ResolutionLog.summarize")(function*(since: Date) {
      const rows = yield* sql<{ doc: unknown }>`
        SELECT json_build_object(
          'source', source,
          'hits', count(*) FILTER (WHERE cache_hit),
          'misses', count(*) FILTER (WHERE NOT cache_hit)
        ) AS doc
        FROM upstream_call
        WHERE created_at >= ${since}
        GROUP BY source
        ORDER BY source
      `
      return yield* decodeSummaries(rows.map((row) => row.doc))
    })

    return { record, summarize }
  })
)
