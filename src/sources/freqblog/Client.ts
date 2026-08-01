import { Config, Context, Effect, Layer, Redacted, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { TrackQuery } from "../../domain/Identity.ts"
import { TrackFacts } from "../../domain/Recording.ts"
import {
  ApiKeyNotConfigured,
  InvalidApiKey,
  NotInCatalog,
  QuotaExceeded,
  Unavailable,
  UnexpectedResponse
} from "./Errors.ts"
import type { FreqBlogError } from "./Errors.ts"
import { WireTrack, WireTrackList } from "./Schemas.ts"

const BASE_URL = "https://api.freqblog.com"

/** Free-tier keys allow six concurrent requests; paid allow ten. */
const MAX_CONCURRENT_REQUESTS = 6

/**
 * How long `/lookup` may hold the connection while ingesting an unknown track.
 *
 * This stands in for a webhook receiver: a single-user CLI can afford to wait a few
 * seconds rather than run a public callback endpoint.
 */
const INGEST_WAIT_SECONDS = 10

const MAX_RETRY_ATTEMPTS = 3

/**
 * Only transport faults and 5xx are retried, and only three times.
 *
 * A CLI invocation should fail quickly during a sustained outage rather than hang, and
 * retrying anything else — a 404, a rejected key — would spend quota to reproduce a
 * certainty.
 */
const retrySchedule = Schedule.exponential("500 millis", 1.5)

const isRetryable = (error: FreqBlogError) => error._tag === "Unavailable"

export class FreqBlog extends Context.Service<FreqBlog, {
  /** Resolve one track. Fails with `NotInCatalog` when the catalogue does not have it. */
  readonly lookup: (query: TrackQuery) => Effect.Effect<TrackFacts, FreqBlogError>
  /** Acoustically nearest neighbours of a track already known to FreqBlog. */
  readonly similar: (
    options: { readonly trackId: string; readonly limit: number }
  ) => Effect.Effect<ReadonlyArray<TrackFacts>, FreqBlogError>
  /** Recommendations from up to five seed tracks. */
  readonly recommendations: (
    options: { readonly seedTrackIds: ReadonlyArray<string>; readonly limit: number }
  ) => Effect.Effect<ReadonlyArray<TrackFacts>, FreqBlogError>
}>()("FreqBlog") {}

const decodeWireTrack = Schema.decodeUnknownEffect(WireTrack)
const decodeWireTrackList = Schema.decodeUnknownEffect(WireTrackList)
const decodeTrackFacts = Schema.decodeUnknownEffect(TrackFacts)

/**
 * Vendor shape to domain shape.
 *
 * Produces a plain object rather than constructing the class directly, so the domain
 * schema does the validating and applies its brands. That keeps the only path into
 * `TrackFacts` a validated one.
 */
const toTrackFactsInput = (wire: WireTrack) => ({
  title: wire.title,
  artist: wire.artist,
  ...(wire.mbid == null ? {} : { mbid: wire.mbid }),
  ...(wire.isrc == null ? {} : { isrc: wire.isrc }),
  ...(wire.duration_ms == null ? {} : { durationMs: wire.duration_ms }),
  ...(wire.release_year == null ? {} : { releaseYear: wire.release_year }),
  externalRef: { namespace: "freqblog", value: wire.id },
  features: {
    ...(wire.bpm == null ? {} : { bpm: wire.bpm }),
    ...(wire.bpm_confidence == null ? {} : { bpmConfidence: wire.bpm_confidence }),
    ...(wire.camelot == null ? {} : { keyCamelot: wire.camelot }),
    ...(wire.energy == null ? {} : { energy: wire.energy }),
    ...(wire.valence == null ? {} : { valence: wire.valence }),
    ...(wire.danceability == null ? {} : { danceability: wire.danceability }),
    ...(wire.acousticness == null ? {} : { acousticness: wire.acousticness }),
    ...(wire.loudness == null ? {} : { loudnessDb: wire.loudness }),
    ...(wire.mood == null ? {} : { mood: wire.mood }),
    ...(wire.genres == null ? {} : { genres: wire.genres }),
    ...(wire.embedding == null ? {} : { embedding: wire.embedding })
  }
})

const queryParams = (query: TrackQuery): Record<string, string> => {
  switch (query._tag) {
    case "ByIsrc":
      return { isrc: query.isrc }
    case "ByMbid":
      return { mbid: query.mbid }
    case "ByExternalRef":
      return { track_id: query.ref.value }
    case "ByName":
      return { artist: query.artist, track: query.title }
  }
}

const describeQuery = (query: TrackQuery): string => {
  switch (query._tag) {
    case "ByIsrc":
      return `isrc ${query.isrc}`
    case "ByMbid":
      return `mbid ${query.mbid}`
    case "ByExternalRef":
      return `${query.ref.namespace} ${query.ref.value}`
    case "ByName":
      return `${query.artist} — ${query.title}`
  }
}

/**
 * Read as a non-empty string and redacted immediately after, so an absent key and a
 * blank one are the same failure, and the error can name the variable instead of
 * reporting a redacted value that reads like corruption.
 */
const readApiKey = Effect.gen(function*() {
  return yield* Config.nonEmptyString("FREQBLOG_API_KEY")
}).pipe(
  Effect.map(Redacted.make),
  Effect.catchTag("ConfigError", () => new ApiKeyNotConfigured({}))
)

export const FreqBlogLive = Layer.effect(FreqBlog)(
  Effect.gen(function*() {
    const apiKey = yield* readApiKey
    const http = yield* HttpClient.HttpClient
    const permits = yield* Semaphore.make(MAX_CONCURRENT_REQUESTS)

    const client = http.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(BASE_URL)),
      HttpClient.mapRequest(HttpClientRequest.setHeader("x-api-key", Redacted.value(apiKey)))
    )

    /**
     * One request, with every non-success status turned into a typed outcome.
     *
     * Statuses are interpreted here rather than through `filterStatusOk` so that 404
     * stays distinguishable from a malfunction — it is a normal answer about the
     * catalogue, not a failure of it.
     */
    const request = (endpoint: string, params: Record<string, string>, label: string) =>
      Effect.gen(function*() {
        const response = yield* client.get(endpoint, { urlParams: params }).pipe(
          Effect.catchTag("HttpClientError", (cause) => new Unavailable({ endpoint, cause }))
        )

        if (response.status === 404) {
          return yield* new NotInCatalog({ query: label })
        }
        if (response.status === 401 || response.status === 403) {
          return yield* new InvalidApiKey({})
        }
        if (response.status === 429) {
          return yield* new QuotaExceeded({})
        }
        if (response.status >= 500) {
          return yield* new Unavailable({
            endpoint,
            status: response.status,
            cause: `upstream returned ${response.status}`
          })
        }
        if (response.status >= 400) {
          return yield* new UnexpectedResponse({
            endpoint,
            detail: `unexpected status ${response.status}`
          })
        }

        return yield* response.json.pipe(
          Effect.catchTag("HttpClientError", (cause) => new Unavailable({ endpoint, cause }))
        )
      }).pipe(
        permits.withPermits(1),
        Effect.retry({ schedule: retrySchedule, times: MAX_RETRY_ATTEMPTS, while: isRetryable })
      )

    /** Decode failures become an adapter error; `SchemaError` never escapes this module. */
    const decodeAt = <A>(
      endpoint: string,
      decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>
    ) =>
    (body: unknown) =>
      decode(body).pipe(
        Effect.catchTag("SchemaError", (error) =>
          new UnexpectedResponse({ endpoint, detail: error.message }))
      )

    const lookup = Effect.fn("FreqBlog.lookup")(function*(query: TrackQuery) {
      const body = yield* request(
        "/lookup",
        { ...queryParams(query), wait: String(INGEST_WAIT_SECONDS) },
        describeQuery(query)
      )
      const wire = yield* decodeAt("/lookup", decodeWireTrack)(body)
      return yield* decodeAt("/lookup", decodeTrackFacts)(toTrackFactsInput(wire))
    })

    const fetchList = (endpoint: string) =>
      Effect.fn(`FreqBlog${endpoint}`)(function*(params: Record<string, string>, label: string) {
        const body = yield* request(endpoint, params, label)
        const wire = yield* decodeAt(endpoint, decodeWireTrackList)(body)
        return yield* Effect.forEach(
          wire.tracks,
          (track) => decodeAt(endpoint, decodeTrackFacts)(toTrackFactsInput(track))
        )
      })

    const fetchSimilar = fetchList("/similar")
    const fetchRecommendations = fetchList("/recommendations")

    return {
      lookup,
      similar: (options: { readonly trackId: string; readonly limit: number }) =>
        fetchSimilar(
          { track_id: options.trackId, limit: String(options.limit) },
          `similar to ${options.trackId}`
        ),
      recommendations: (options: {
        readonly seedTrackIds: ReadonlyArray<string>
        readonly limit: number
      }) =>
        fetchRecommendations(
          { seed_tracks: options.seedTrackIds.join(","), limit: String(options.limit) },
          `recommendations from ${options.seedTrackIds.join(", ")}`
        )
    }
  })
)
