import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

/**
 * Initial schema.
 *
 * Two rules are enforced structurally rather than by convention:
 *
 * 1. Every derived fact carries a `source`. Nothing is stored without a record of
 *    where it came from, which is what lets an upstream be replaced later without
 *    re-deriving the whole store.
 * 2. Vendor identifiers live in `external_id`, never on `recording`. The core
 *    entity stays free of any one provider's shape.
 */
export const migration = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE EXTENSION IF NOT EXISTS vector`.withoutTransform
  yield* sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.withoutTransform

  // The canonical entity. Titles and artists are stored as given; matching happens
  // through `external_id` and normalised comparison, not by trusting these strings.
  yield* sql`
    CREATE TABLE recording (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mbid          text UNIQUE,
      isrc          text,
      title         text NOT NULL,
      artist        text NOT NULL,
      duration_ms   integer,
      release_year  integer,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `.withoutTransform
  yield* sql`CREATE INDEX recording_artist_idx ON recording (lower(artist))`.withoutTransform
  yield* sql`CREATE INDEX recording_isrc_idx ON recording (isrc) WHERE isrc IS NOT NULL`.withoutTransform

  // Lexical retrieval sits beside the vectors: a column and an index, not a service.
  yield* sql`
    ALTER TABLE recording ADD COLUMN search tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || artist)) STORED
  `.withoutTransform
  yield* sql`CREATE INDEX recording_search_idx ON recording USING gin (search)`.withoutTransform

  // Vendor ids are namespaced and kept out of the core entity.
  yield* sql`
    CREATE TABLE external_id (
      recording_id  uuid NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      namespace     text NOT NULL,
      value         text NOT NULL,
      PRIMARY KEY (namespace, value)
    )
  `.withoutTransform
  yield* sql`CREATE INDEX external_id_recording_idx ON external_id (recording_id)`.withoutTransform

  // One row per recording per source. `source` is the provenance marker.
  //
  // Note what is absent: instrumentalness, speechiness and liveness. Essentia's own
  // docs deprecate them on data-quality grounds and FreqBlog's operator flags them as
  // unreliable, so there is deliberately nowhere to put them. Vocal detection lives in
  // `lyric_signal` instead.
  yield* sql`
    CREATE TABLE feature (
      recording_id  uuid NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      source        text NOT NULL,
      fetched_at    timestamptz NOT NULL DEFAULT now(),
      bpm           double precision,
      bpm_confidence double precision,
      key_camelot   text,
      energy        double precision,
      valence       double precision,
      danceability  double precision,
      acousticness  double precision,
      loudness_db   double precision,
      mood          text,
      mood_vector   jsonb,
      genres        text[],
      embedding     vector(18),
      PRIMARY KEY (recording_id, source)
    )
  `.withoutTransform
  // No ANN index. Filters here are selective (tempo band, era, genre), and an exact
  // kNN scan over the survivors beats traversing an approximate index at this scale.
  // Add one only when a measurement demands it.
  yield* sql`CREATE INDEX feature_bpm_idx ON feature (bpm)`.withoutTransform
  yield* sql`CREATE INDEX feature_energy_idx ON feature (energy)`.withoutTransform

  // Vocal vs instrumental, one row per source, so the multi-source vote is a query.
  yield* sql`
    CREATE TABLE lyric_signal (
      recording_id    uuid NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      source          text NOT NULL,
      is_instrumental boolean,
      has_lyrics      boolean,
      fetched_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recording_id, source)
    )
  `.withoutTransform

  // Written from day one even though nothing reads it yet. Feedback is the one asset
  // that cannot be backfilled.
  yield* sql`
    CREATE TABLE feedback (
      id            bigserial PRIMARY KEY,
      recording_id  uuid NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      verdict       text NOT NULL CHECK (verdict IN ('accept', 'skip', 'reject')),
      context       jsonb,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `.withoutTransform
  yield* sql`CREATE INDEX feedback_recording_idx ON feedback (recording_id)`.withoutTransform

  // Quota is the scarce resource, so it has to be observable from the first request.
  yield* sql`
    CREATE TABLE upstream_call (
      id          bigserial PRIMARY KEY,
      source      text NOT NULL,
      endpoint    text NOT NULL,
      cache_hit   boolean NOT NULL,
      status      integer,
      duration_ms integer,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `.withoutTransform
  yield* sql`CREATE INDEX upstream_call_created_idx ON upstream_call (created_at)`.withoutTransform
})
