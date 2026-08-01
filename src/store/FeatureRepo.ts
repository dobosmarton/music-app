import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import type { SqlError } from "effect/unstable/sql"
import type { RecordingId } from "../domain/Identity.ts"
import type { Source } from "../domain/Provenance.ts"
import { Features } from "../domain/Recording.ts"
import type { FeatureValues } from "../domain/Recording.ts"

/**
 * See `RecordingRepo` for why rows arrive as null-stripped JSON.
 *
 * `embedding` needs the extra `::text::json` step: pgvector renders a vector as the
 * string `"[1,2,3]"` rather than a JSON array, so without the cast it decodes as text.
 * Its text form is already valid JSON, which is why the round trip is this cheap.
 */
const featureDocument = "json_strip_nulls(json_build_object(" +
  "'recordingId', f.recording_id, 'source', f.source, 'bpm', f.bpm," +
  "'bpmConfidence', f.bpm_confidence, 'keyCamelot', f.key_camelot, 'energy', f.energy," +
  "'valence', f.valence, 'danceability', f.danceability, 'acousticness', f.acousticness," +
  "'loudnessDb', f.loudness_db, 'mood', f.mood, 'genres', f.genres," +
  "'embedding', f.embedding::text::json))"

const decodeFeatures = Schema.decodeUnknownEffect(Schema.Array(Features))

type RepoError = SqlError.SqlError | Schema.SchemaError

export class FeatureRepo extends Context.Service<FeatureRepo, {
  readonly findByRecording: (
    id: RecordingId
  ) => Effect.Effect<ReadonlyArray<Features>, RepoError>
  readonly upsert: (
    options: {
      readonly recordingId: RecordingId
      readonly source: Source
      readonly values: FeatureValues
    }
  ) => Effect.Effect<void, RepoError>
}>()("FeatureRepo") {}

export const FeatureRepoLive = Layer.effect(FeatureRepo)(
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    const findByRecording = Effect.fn("FeatureRepo.findByRecording")(function*(id: RecordingId) {
      const rows = yield* sql<{ doc: unknown }>`
        SELECT ${sql.literal(featureDocument)} AS doc
        FROM feature f
        WHERE f.recording_id = ${id}::uuid
        ORDER BY f.source
      `
      return yield* decodeFeatures(rows.map((row) => row.doc))
    })

    /**
     * Re-fetching a track overwrites that source's row and refreshes `fetched_at`,
     * so provenance always reflects the newest answer from each source rather than
     * accumulating duplicates.
     */
    const upsert = Effect.fn("FeatureRepo.upsert")(function*(options: {
      readonly recordingId: RecordingId
      readonly source: Source
      readonly values: FeatureValues
    }) {
      const { source, values } = options
      yield* sql`
        INSERT INTO feature (
          recording_id, source, fetched_at, bpm, bpm_confidence, key_camelot,
          energy, valence, danceability, acousticness, loudness_db, mood, genres, embedding
        ) VALUES (
          ${options.recordingId}::uuid,
          ${source},
          now(),
          ${values.bpm ?? null},
          ${values.bpmConfidence ?? null},
          ${values.keyCamelot ?? null},
          ${values.energy ?? null},
          ${values.valence ?? null},
          ${values.danceability ?? null},
          ${values.acousticness ?? null},
          ${values.loudnessDb ?? null},
          ${values.mood ?? null},
          ${values.genres === undefined ? null : [...values.genres]},
          ${values.embedding === undefined ? null : JSON.stringify(values.embedding)}::vector
        )
        ON CONFLICT (recording_id, source) DO UPDATE SET
          fetched_at = excluded.fetched_at,
          bpm = excluded.bpm,
          bpm_confidence = excluded.bpm_confidence,
          key_camelot = excluded.key_camelot,
          energy = excluded.energy,
          valence = excluded.valence,
          danceability = excluded.danceability,
          acousticness = excluded.acousticness,
          loudness_db = excluded.loudness_db,
          mood = excluded.mood,
          genres = excluded.genres,
          embedding = excluded.embedding
      `
    })

    return { findByRecording, upsert }
  })
)
