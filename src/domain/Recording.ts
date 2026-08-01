import { Schema } from "effect"
import { ExternalRef, Isrc, Mbid, RecordingId } from "./Identity.ts"
import { Source } from "./Provenance.ts"

/**
 * Acoustic description of a track.
 *
 * Note what is missing: instrumentalness, speechiness and liveness. Essentia's own
 * documentation deprecates them on data-quality grounds and FreqBlog's operator flags
 * them as unreliable, so there is deliberately nowhere to put them. Vocal detection
 * comes from lyric sources instead.
 */
const featureFields = {
  bpm: Schema.optional(Schema.Finite),
  bpmConfidence: Schema.optional(Schema.Finite),
  keyCamelot: Schema.optional(Schema.NonEmptyString),
  energy: Schema.optional(Schema.Finite),
  valence: Schema.optional(Schema.Finite),
  danceability: Schema.optional(Schema.Finite),
  acousticness: Schema.optional(Schema.Finite),
  loudnessDb: Schema.optional(Schema.Finite),
  mood: Schema.optional(Schema.NonEmptyString),
  genres: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  embedding: Schema.optional(Schema.Array(Schema.Finite))
}

/** Acoustic values on their own, before they are attributed to a recording. */
export class FeatureValues extends Schema.Class<FeatureValues>("FeatureValues")(featureFields) {}

/** Acoustic values as stored: attributed to a recording, and to the source that supplied them. */
export class Features extends Schema.Class<Features>("Features")({
  recordingId: RecordingId,
  source: Source,
  ...featureFields
}) {}

const identityFields = {
  title: Schema.NonEmptyString,
  artist: Schema.NonEmptyString,
  mbid: Schema.optional(Mbid),
  isrc: Schema.optional(Isrc),
  durationMs: Schema.optional(Schema.Int),
  releaseYear: Schema.optional(Schema.Int)
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
  features: FeatureValues
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
