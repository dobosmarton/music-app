import { Schema } from "effect"

/**
 * How a recording is identified.
 *
 * These are branded rather than bare strings because the codebase handles several
 * kinds of identifier at once, and mixing them up is silent: a vendor id and our own
 * id are both text, and passing one where the other belongs would compile happily.
 */

/** Our own primary key. Assigned by the database, never by an upstream. */
export const RecordingId = Schema.NonEmptyString.pipe(Schema.brand("RecordingId"))
export type RecordingId = typeof RecordingId.Type

/** MusicBrainz recording id — the portable identity the store is keyed to conceptually. */
export const Mbid = Schema.NonEmptyString.pipe(Schema.brand("Mbid"))
export type Mbid = typeof Mbid.Type

/** International Standard Recording Code. */
export const Isrc = Schema.NonEmptyString.pipe(Schema.brand("Isrc"))
export type Isrc = typeof Isrc.Type

/**
 * Namespaces for identifiers we do not own.
 *
 * Vendor ids live in `external_id` under one of these, never as a column on
 * `recording` — that separation is what keeps the core entity free of any one
 * provider's shape.
 */
export const ExternalNamespace = Schema.Literals(["freqblog", "spotify", "itunes"])
export type ExternalNamespace = typeof ExternalNamespace.Type

export class ExternalRef extends Schema.Class<ExternalRef>("ExternalRef")({
  namespace: ExternalNamespace,
  value: Schema.NonEmptyString
}) {}

/**
 * How a caller asks for a recording.
 *
 * Ordered by how reliably each resolves: an exact identifier beats a name, which is
 * why the store tries them in this order rather than treating them as equivalent.
 */
export const TrackQuery = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("ByIsrc"), isrc: Isrc }),
  Schema.Struct({ _tag: Schema.Literal("ByMbid"), mbid: Mbid }),
  Schema.Struct({ _tag: Schema.Literal("ByExternalRef"), ref: ExternalRef }),
  Schema.Struct({
    _tag: Schema.Literal("ByName"),
    artist: Schema.NonEmptyString,
    title: Schema.NonEmptyString
  })
])
export type TrackQuery = typeof TrackQuery.Type
