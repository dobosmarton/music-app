import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

/**
 * Record whether a source's numbers are settled.
 *
 * FreqBlog answers the first lookup of an uncatalogued track from a fast preview
 * analysis (`feature_source: "essentia_preview"`) and queues the real one, so the same
 * track can report different features minutes apart. Without this column the store
 * cannot tell the two apart after the fact, and an evaluation baseline could be built on
 * values that have since changed — which would make the engine-versus-baseline
 * comparison meaningless.
 *
 * Existing rows default to `provisional` rather than `final`: everything written before
 * this column existed was recorded without checking, so claiming it is settled would be
 * asserting something we never verified.
 */
export const migration = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    ALTER TABLE feature ADD COLUMN quality text NOT NULL DEFAULT 'provisional'
      CHECK (quality IN ('final', 'provisional'))
  `.withoutTransform
})
