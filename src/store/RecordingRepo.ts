import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import type { SqlError, Statement } from "effect/unstable/sql"
import { RecordingId } from "../domain/Identity.ts"
import type { TrackQuery } from "../domain/Identity.ts"
import { Recording } from "../domain/Recording.ts"
import type { TrackFacts } from "../domain/Recording.ts"

/**
 * Rows come back as null-stripped JSON documents rather than columns.
 *
 * Postgres omits null keys, which lines up exactly with the domain's optional fields,
 * so a row decodes into a domain type in one step. The alternative — reading columns
 * and hand-mapping every null to an absent key — is the same logic written out once
 * per field, with more places to get it wrong.
 */
const recordingDocument = "json_strip_nulls(json_build_object(" +
  "'id', r.id, 'title', r.title, 'artist', r.artist, 'mbid', r.mbid, 'isrc', r.isrc," +
  "'durationMs', r.duration_ms, 'releaseYear', r.release_year))"

const decodeRecording = Schema.decodeUnknownEffect(Recording)
const decodeInsertedId = Schema.decodeUnknownEffect(Schema.Struct({ id: RecordingId }))

type RepoError = SqlError.SqlError | Schema.SchemaError

export class RecordingRepo extends Context.Service<RecordingRepo, {
  readonly findByQuery: (query: TrackQuery) => Effect.Effect<Option.Option<Recording>, RepoError>
  readonly findById: (id: RecordingId) => Effect.Effect<Option.Option<Recording>, RepoError>
  /** Insert the recording if new, link its external id, and return our own id either way. */
  readonly upsert: (facts: TrackFacts) => Effect.Effect<RecordingId, RepoError>
}>()("RecordingRepo") {}

export const RecordingRepoLive = Layer.effect(RecordingRepo)(
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    const select = (where: Statement.Fragment) =>
      sql<{ doc: unknown }>`SELECT ${sql.literal(recordingDocument)} AS doc FROM recording r ${where}`

    const firstRecording = (rows: ReadonlyArray<{ readonly doc: unknown }>) => {
      const row = rows[0]
      return row === undefined
        ? Effect.succeed(Option.none<Recording>())
        : Effect.map(decodeRecording(row.doc), Option.some)
    }

    const whereFor = (query: TrackQuery) => {
      switch (query._tag) {
        case "ByIsrc":
          return sql`WHERE r.isrc = ${query.isrc}`
        case "ByMbid":
          return sql`WHERE r.mbid = ${query.mbid}`
        case "ByExternalRef":
          return sql`
            JOIN external_id e ON e.recording_id = r.id
            WHERE e.namespace = ${query.ref.namespace} AND e.value = ${query.ref.value}
          `
        case "ByName":
          return sql`
            WHERE lower(r.artist) = lower(${query.artist}) AND lower(r.title) = lower(${query.title})
          `
      }
    }

    const findByQuery = Effect.fn("RecordingRepo.findByQuery")(function*(query: TrackQuery) {
      return yield* firstRecording(yield* select(whereFor(query)))
    })

    const findById = Effect.fn("RecordingRepo.findById")(function*(id: RecordingId) {
      return yield* firstRecording(yield* select(sql`WHERE r.id = ${id}::uuid`))
    })

    /**
     * Idempotent by external id: re-resolving the same track returns the id already
     * assigned rather than creating a second row for it.
     */
    const upsert = Effect.fn("RecordingRepo.upsert")(function*(facts: TrackFacts) {
      return yield* sql.withTransaction(Effect.gen(function*() {
        const existing = yield* findByQuery({ _tag: "ByExternalRef", ref: facts.externalRef })
        if (Option.isSome(existing)) {
          return existing.value.id
        }

        const inserted = yield* sql`
          INSERT INTO recording (title, artist, mbid, isrc, duration_ms, release_year)
          VALUES (
            ${facts.title},
            ${facts.artist},
            ${facts.mbid ?? null},
            ${facts.isrc ?? null},
            ${facts.durationMs ?? null},
            ${facts.releaseYear ?? null}
          )
          RETURNING id
        `
        const { id } = yield* decodeInsertedId(inserted[0])

        yield* sql`
          INSERT INTO external_id (recording_id, namespace, value)
          VALUES (${id}::uuid, ${facts.externalRef.namespace}, ${facts.externalRef.value})
          ON CONFLICT (namespace, value) DO NOTHING
        `

        return id
      }))
    })

    return { findByQuery, findById, upsert }
  })
)
