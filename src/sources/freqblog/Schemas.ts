import { Schema } from "effect"

/**
 * The FreqBlog wire format.
 *
 * These field names come from FreqBlog's OpenAPI document, not from an observed
 * response — we do not have an API key yet. Everything except the track identity is
 * optional, so a field we named wrongly degrades to "unknown" rather than failing the
 * whole decode. When the key arrives, record a real response and tighten this.
 *
 * This is the only module in the codebase allowed to know these names.
 */

/** A wire field may be absent, or present and null. Both mean "not known". */
const unknownable = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

export class WireTrack extends Schema.Class<WireTrack>("WireTrack")({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  artist: Schema.NonEmptyString,
  album: unknownable(Schema.String),
  isrc: unknownable(Schema.String),
  mbid: unknownable(Schema.String),
  duration_ms: unknownable(Schema.Int),
  release_year: unknownable(Schema.Int),

  bpm: unknownable(Schema.Finite),
  bpm_confidence: unknownable(Schema.Finite),
  camelot: unknownable(Schema.String),
  energy: unknownable(Schema.Finite),
  valence: unknownable(Schema.Finite),
  danceability: unknownable(Schema.Finite),
  acousticness: unknownable(Schema.Finite),
  loudness: unknownable(Schema.Finite),
  mood: unknownable(Schema.String),
  genres: unknownable(Schema.Array(Schema.String)),
  embedding: unknownable(Schema.Array(Schema.Finite))
}) {}

/** `/similar` and `/recommendations` return a list under a `tracks` key. */
export class WireTrackList extends Schema.Class<WireTrackList>("WireTrackList")({
  tracks: Schema.Array(WireTrack)
}) {}
