import { Schema } from "effect"

/**
 * The FreqBlog wire format, as observed against API v1.5.0.
 *
 * These names come from a recorded response and `https://api.freqblog.com/openapi.json`,
 * not from a guess. Where the spec marks a field required we still accept it as absent
 * for acoustic values only: a missing number is a legitimate "unknown" in our domain and
 * should not fail a decode that is otherwise usable. Identity fields stay strict, because
 * a track we cannot name or key is of no use to us.
 *
 * This is the only module in the codebase allowed to know these names.
 */

/**
 * A wire field may be absent, or present and null. Both mean "not known".
 *
 * `optionalKey` rather than `optional`: JSON has no `undefined`, so the key is either
 * missing or carries a value, and `optional` would widen the decoded type with a state
 * the wire cannot produce.
 */
const unknownable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))

/** The three-value classifier block. Present on catalogue tracks, absent on fallbacks. */
export class WireExtended extends Schema.Class<WireExtended>("WireExtended")({
  gender: unknownable(Schema.String),
  timbre: unknownable(Schema.String),
  tonal_atonal: unknownable(Schema.String)
}) {}

/**
 * The `/lookup` 200 body — the only endpoint that returns audio features.
 *
 * `instrumentalness`, `speechiness` and `liveness` are deliberately not modelled even
 * though the wire carries them: the operator flags them unreliable and there is nowhere
 * in the domain to put them. See AGENTS.md.
 */
export class WireTrackLookup extends Schema.Class<WireTrackLookup>("WireTrackLookup")({
  itunes_track_id: Schema.NonEmptyString,
  track_name: Schema.NonEmptyString,
  artist_name: Schema.NonEmptyString,
  album_name: unknownable(Schema.String),
  isrc: unknownable(Schema.String),
  mbid: unknownable(Schema.String),
  release_date: unknownable(Schema.String),
  duration_ms: unknownable(Schema.Int),

  bpm: unknownable(Schema.Finite),
  bpm_confidence: unknownable(Schema.Finite),
  camelot: unknownable(Schema.String),
  energy: unknownable(Schema.Finite),
  valence: unknownable(Schema.Finite),
  danceability: unknownable(Schema.Finite),
  acousticness: unknownable(Schema.Finite),
  loudness_db: unknownable(Schema.Finite),
  mood: unknownable(Schema.String),
  genre: unknownable(Schema.String),
  extended: unknownable(WireExtended),

  /**
   * Whether these numbers are final.
   *
   * `feature_source: "essentia_preview"` with `backfill_status: "queued"` means a real
   * analysis is still running and the values may change. Carried through to the domain
   * so nothing downstream mistakes a provisional reading for a settled one.
   */
  feature_source: unknownable(Schema.String),
  backfill_status: unknownable(Schema.String)
}) {}

/**
 * What `/similar` and `/recommendations` return per track.
 *
 * Note what is absent: every acoustic field. These endpoints answer with identity only,
 * so a candidate has to be hydrated through `/lookup` before it can be filtered on tempo,
 * key or energy.
 */
export class WireTrackStub extends Schema.Class<WireTrackStub>("WireTrackStub")({
  itunes_track_id: Schema.NonEmptyString,
  track_name: Schema.NonEmptyString,
  artist_name: Schema.NonEmptyString,
  album_name: unknownable(Schema.String),
  isrc: unknownable(Schema.String),
  mbid: unknownable(Schema.String),
  genre: unknownable(Schema.String),
  release_date: unknownable(Schema.String),
  duration_ms: unknownable(Schema.Int),
  popularity: unknownable(Schema.Int)
}) {}

/** One ranked candidate. `/similar` and `/recommendations` share this shape. */
export class WireScoredTrack extends Schema.Class<WireScoredTrack>("WireScoredTrack")({
  track: WireTrackStub,
  /** `same`, `adjacent` or `cross` — how the candidate's genre relates to the seed's. */
  genre_relation: unknownable(Schema.String),
  /** Raw cosine similarity over FreqBlog's 18-feature embedding. */
  score: Schema.Finite
}) {}

export class WireSimilarResponse extends Schema.Class<WireSimilarResponse>("WireSimilarResponse")({
  seed: WireTrackStub,
  count: Schema.Int,
  results: Schema.Array(WireScoredTrack)
}) {}

/** Echo of one supplied seed, so an id that resolved to nothing is visible. */
export class WireRecommendationSeed extends Schema.Class<WireRecommendationSeed>("WireRecommendationSeed")({
  id: Schema.NonEmptyString,
  found: Schema.Boolean
}) {}

export class WireRecommendationsResponse
  extends Schema.Class<WireRecommendationsResponse>("WireRecommendationsResponse")({
    seeds: Schema.Array(WireRecommendationSeed),
    /** Populated only when seeding by name, echoing what the name resolved to. */
    seed_query: unknownable(WireTrackStub),
    count: Schema.Int,
    tracks: Schema.Array(WireScoredTrack)
  })
{}

/**
 * The `/track/{id}/embedding` body.
 *
 * `embedding_mask` marks which positions came from real analysis; the rest are filler and
 * must be excluded from any distance calculation, or tracks with little real data will
 * appear spuriously close to everything.
 */
export class WireEmbeddingResponse extends Schema.Class<WireEmbeddingResponse>("WireEmbeddingResponse")({
  itunes_track_id: Schema.NonEmptyString,
  dim: Schema.Int,
  fields: Schema.Array(Schema.String),
  embedding: Schema.Array(Schema.Finite),
  embedding_mask: Schema.Array(Schema.Boolean)
}) {}
