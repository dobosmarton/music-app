import { Schema } from "effect"
import { ExternalRef, Isrc, Mbid, RecordingId } from "./Identity.ts"
import { Source } from "./Provenance.ts"

/**
 * Whether an upstream's numbers are settled.
 *
 * FreqBlog answers a first lookup from a fast preview analysis and queues the real one,
 * so the same track can report different features minutes apart. Carrying the
 * distinction means an evaluation run can refuse to score against provisional data
 * rather than silently baking it into a baseline.
 */
export const FeatureQuality = Schema.Literals(["final", "provisional"])
export type FeatureQuality = typeof FeatureQuality.Type

/**
 * Acoustic description of a track.
 *
 * Note what is missing: instrumentalness, speechiness and liveness. Essentia's own
 * documentation deprecates them on data-quality grounds and FreqBlog's operator flags
 * them as unreliable, so there is deliberately nowhere to put them. Vocal detection
 * comes from lyric sources instead.
 */
const featureFields = {
  bpm: Schema.optionalKey(Schema.Finite),
  bpmConfidence: Schema.optionalKey(Schema.Finite),
  keyCamelot: Schema.optionalKey(Schema.NonEmptyString),
  energy: Schema.optionalKey(Schema.Finite),
  valence: Schema.optionalKey(Schema.Finite),
  danceability: Schema.optionalKey(Schema.Finite),
  acousticness: Schema.optionalKey(Schema.Finite),
  loudnessDb: Schema.optionalKey(Schema.Finite),
  mood: Schema.optionalKey(Schema.NonEmptyString),
  genres: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  embedding: Schema.optionalKey(Schema.Array(Schema.Finite))
}

/** Acoustic values on their own, before they are attributed to a recording. */
export class FeatureValues extends Schema.Class<FeatureValues>("FeatureValues")(featureFields) {}

/** Acoustic values as stored: attributed to a recording, and to the source that supplied them. */
export class Features extends Schema.Class<Features>("Features")({
  recordingId: RecordingId,
  source: Source,
  /** Whether the source considered these settled when we read them. */
  quality: FeatureQuality,
  ...featureFields
}) {}

const identityFields = {
  title: Schema.NonEmptyString,
  artist: Schema.NonEmptyString,
  mbid: Schema.optionalKey(Mbid),
  isrc: Schema.optionalKey(Isrc),
  durationMs: Schema.optionalKey(Schema.Int),
  releaseYear: Schema.optionalKey(Schema.Int)
}

/**
 * What an upstream can tell us about a track.
 *
 * Deliberately has no `RecordingId`: that is ours to assign, and a source has no
 * business supplying one. This is the shape adapters return, which is how vendor
 * vocabulary is prevented from reaching the rest of the application.
 */
export class TrackFacts extends Schema.Class<TrackFacts>("TrackFacts")({
  ...identityFields,
  externalRef: ExternalRef,
  features: FeatureValues,
  quality: FeatureQuality
}) {}

/**
 * A track an upstream offered as a candidate, before we know anything acoustic about it.
 *
 * This exists because FreqBlog's `/similar` and `/recommendations` return identity only.
 * Filtering on tempo, key or energy requires hydrating each candidate through `/lookup`
 * at one quota request apiece, so the un-hydrated form has to be nameable in the domain
 * rather than papered over.
 */
export class TrackCandidate extends Schema.Class<TrackCandidate>("TrackCandidate")({
  ...identityFields,
  externalRef: ExternalRef,
  /** Cosine similarity to the seed over the upstream's own embedding. */
  score: Schema.Finite,
  /** How the candidate's genre relates to the seed's: `same`, `adjacent` or `cross`. */
  genreRelation: Schema.optionalKey(Schema.NonEmptyString),
  /** The one non-acoustic descriptor a stub carries. Not normalised by the upstream. */
  genre: Schema.optionalKey(Schema.NonEmptyString)
}) {}

/** A track as the application knows it, once stored. */
export class Recording extends Schema.Class<Recording>("Recording")({
  id: RecordingId,
  ...identityFields
}) {}

/** A recording together with everything currently known about it. */
export class KnownRecording extends Schema.Class<KnownRecording>("KnownRecording")({
  recording: Recording,
  features: Schema.Array(Features)
}) {}
