import { Config, Context, Effect, Layer, Redacted, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { UpstreamQuery } from "../../domain/Identity.ts"
import { TrackCandidate, TrackFacts } from "../../domain/Recording.ts"
import type { FeatureQuality } from "../../domain/Recording.ts"
import {
  ApiKeyNotConfigured,
  IngestQueued,
  InvalidApiKey,
  NotInCatalog,
  QuotaExceeded,
  Unavailable,
  UnexpectedResponse
} from "./Errors.ts"
import type { FreqBlogError } from "./Errors.ts"
import { WireEmbeddingResponse, WireRecommendationsResponse, WireSimilarResponse, WireTrackLookup } from "./Schemas.ts"
import type { WireScoredTrack, WireTrackStub } from "./Schemas.ts"

const BASE_URL = "https://api.freqblog.com"

/** Free-tier keys allow six concurrent requests; paid allow ten. */
const MAX_CONCURRENT_REQUESTS = 6

/**
 * How long `/lookup` may hold the connection while ingesting an unknown track.
 *
 * This stands in for a webhook receiver: a single-user CLI can afford to wait a few
 * seconds rather than run a public callback endpoint. The upstream caps this at 25.
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

/** Decode failures become an adapter error; `SchemaError` never escapes this module. */
const decodeAt = <A>(
  endpoint: string,
  decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>
) =>
(body: unknown) =>
  decode(body).pipe(
    Effect.catchTag("SchemaError", (error) => new UnexpectedResponse({ endpoint, detail: error.message }))
  )

/** How the upstream's genre re-ranking should be applied to a candidate list. */
export type CrossGenre = "auto" | "allow" | "strict"

export class FreqBlog extends Context.Service<FreqBlog, {
  /** Resolve one track. Fails with `NotInCatalog` when the catalogue does not have it. */
  readonly lookup: (query: UpstreamQuery) => Effect.Effect<TrackFacts, FreqBlogError>
  /**
   * Acoustically nearest neighbours of a catalogue track.
   *
   * Returns identity only — see `TrackCandidate`. Anything acoustic needs a `lookup` per
   * candidate.
   */
  readonly similar: (
    options: {
      readonly trackId: string
      readonly limit: number
      readonly excludeSameArtist?: boolean
      readonly crossGenre?: CrossGenre
    }
  ) => Effect.Effect<ReadonlyArray<TrackCandidate>, FreqBlogError>
  /** Recommendations from up to five seed tracks. Identity only, as `similar`. */
  readonly recommendations: (
    options: {
      readonly seedTrackIds: ReadonlyArray<string>
      readonly limit: number
      readonly excludeSeedArtists?: boolean
      readonly crossGenre?: CrossGenre
    }
  ) => Effect.Effect<ReadonlyArray<TrackCandidate>, FreqBlogError>
  /**
   * The upstream's own feature vector for a track, with a mask marking real positions.
   *
   * Positions whose mask entry is `false` are filler and must be dropped before any
   * distance is computed, or sparsely-analysed tracks look close to everything.
   */
  readonly embedding: (
    trackId: string
  ) => Effect.Effect<
    { readonly fields: ReadonlyArray<string>; readonly values: ReadonlyArray<number> },
    FreqBlogError
  >
}>()("FreqBlog") {}

const decodeLookup = Schema.decodeUnknownEffect(WireTrackLookup)
const decodeSimilar = Schema.decodeUnknownEffect(WireSimilarResponse)
const decodeRecommendations = Schema.decodeUnknownEffect(WireRecommendationsResponse)
const decodeEmbedding = Schema.decodeUnknownEffect(WireEmbeddingResponse)
const decodeTrackFacts = Schema.decodeUnknownEffect(TrackFacts)
const decodeTrackCandidate = Schema.decodeUnknownEffect(TrackCandidate)

/** `release_date` arrives as an ISO date; the domain keeps only the year. */
const yearOf = (releaseDate: string | null | undefined) => {
  if (releaseDate == null) return undefined
  const year = Number.parseInt(releaseDate.slice(0, 4), 10)
  return Number.isNaN(year) ? undefined : year
}

/**
 * Whether these numbers are settled.
 *
 * A first lookup of an uncatalogued track answers from a fast preview analysis and
 * queues the real one, so the values can change minutes later. Treating that as final
 * would quietly contaminate any baseline measured against it.
 */
const qualityOf = (wire: WireTrackLookup): FeatureQuality =>
  wire.backfill_status === "queued" || wire.feature_source?.endsWith("_preview") === true
    ? "provisional"
    : "final"

/** The identity fields `WireTrackLookup` and `WireTrackStub` have in common. */
interface WireIdentity {
  readonly track_name: string
  readonly artist_name: string
  readonly mbid?: string | null | undefined
  readonly isrc?: string | null | undefined
  readonly duration_ms?: number | null | undefined
  readonly release_date?: string | null | undefined
}

const identityInput = (wire: WireIdentity) => {
  const year = yearOf(wire.release_date)
  return {
    title: wire.track_name,
    artist: wire.artist_name,
    ...(wire.mbid == null ? {} : { mbid: wire.mbid }),
    ...(wire.isrc == null ? {} : { isrc: wire.isrc }),
    ...(wire.duration_ms == null ? {} : { durationMs: wire.duration_ms }),
    ...(year === undefined ? {} : { releaseYear: year })
  }
}

/**
 * Vendor shape to domain shape.
 *
 * Produces a plain object rather than constructing the class directly, so the domain
 * schema does the validating and applies its brands. That keeps the only path into
 * `TrackFacts` a validated one.
 */
const toTrackFactsInput = (wire: WireTrackLookup) => ({
  ...identityInput(wire),
  externalRef: { namespace: "freqblog", value: wire.itunes_track_id },
  quality: qualityOf(wire),
  features: {
    ...(wire.bpm == null ? {} : { bpm: wire.bpm }),
    ...(wire.bpm_confidence == null ? {} : { bpmConfidence: wire.bpm_confidence }),
    ...(wire.camelot == null ? {} : { keyCamelot: wire.camelot }),
    ...(wire.energy == null ? {} : { energy: wire.energy }),
    ...(wire.valence == null ? {} : { valence: wire.valence }),
    ...(wire.danceability == null ? {} : { danceability: wire.danceability }),
    ...(wire.acousticness == null ? {} : { acousticness: wire.acousticness }),
    ...(wire.loudness_db == null ? {} : { loudnessDb: wire.loudness_db }),
    ...(wire.mood == null ? {} : { mood: wire.mood }),
    // The wire carries a single genre string, unnormalised — `elektronisch` and
    // `electronic` both occur. The domain keeps a list; normalisation is a later concern.
    ...(wire.genre == null ? {} : { genres: [wire.genre] })
  }
})

const toTrackCandidateInput = (
  stub: WireTrackStub,
  score: number,
  genreRelation: string | null | undefined
) => ({
  ...identityInput(stub),
  externalRef: { namespace: "freqblog", value: stub.itunes_track_id },
  score,
  ...(genreRelation == null ? {} : { genreRelation }),
  ...(stub.genre == null ? {} : { genre: stub.genre })
})

/**
 * `/lookup` takes exactly one of `track`, `isrc`, `mbid` or `spotify_id`; `artist` only
 * narrows a `track`. Sending more than one is a 422.
 */
const queryParams = (query: UpstreamQuery): Record<string, string> => {
  switch (query._tag) {
    case "ByIsrc":
      return { isrc: query.isrc }
    case "ByMbid":
      return { mbid: query.mbid }
    case "ByName":
      return { track: query.title, artist: query.artist }
  }
}

const describeQuery = (query: UpstreamQuery): string => {
  switch (query._tag) {
    case "ByIsrc":
      return `isrc ${query.isrc}`
    case "ByMbid":
      return `mbid ${query.mbid}`
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
     * Statuses are interpreted here rather than through `filterStatusOk` so that 404 and
     * 202 stay distinguishable from a malfunction — one is a normal answer about the
     * catalogue, the other a promise of a later one.
     */
    const request = (endpoint: string, params: Record<string, string>, label: string) =>
      Effect.gen(function*() {
        const response = yield* client.get(endpoint, { urlParams: params }).pipe(
          Effect.catchTag("HttpClientError", (cause) => new Unavailable({ endpoint, cause }))
        )

        // A name that matched nothing: analysis has been queued and will land in 30s–2min.
        if (response.status === 202) {
          return yield* new IngestQueued({ query: label })
        }
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

    const lookup = Effect.fn("FreqBlog.lookup")(function*(query: UpstreamQuery) {
      const body = yield* request(
        "/lookup",
        { ...queryParams(query), wait: String(INGEST_WAIT_SECONDS) },
        describeQuery(query)
      )
      const wire = yield* decodeAt("/lookup", decodeLookup)(body)
      return yield* decodeAt("/lookup", decodeTrackFacts)(toTrackFactsInput(wire))
    })

    const toCandidates = (endpoint: string) => (scored: ReadonlyArray<WireScoredTrack>) =>
      Effect.forEach(
        scored,
        (result) =>
          decodeAt(endpoint, decodeTrackCandidate)(
            toTrackCandidateInput(result.track, result.score, result.genre_relation)
          )
      )

    const similar = Effect.fn("FreqBlog.similar")(function*(options: {
      readonly trackId: string
      readonly limit: number
      readonly excludeSameArtist?: boolean
      readonly crossGenre?: CrossGenre
    }) {
      const body = yield* request("/similar", {
        track_id: options.trackId,
        limit: String(options.limit),
        exclude_same_artist: String(options.excludeSameArtist ?? false),
        cross_genre: options.crossGenre ?? "auto"
      }, `similar to ${options.trackId}`)
      const wire = yield* decodeAt("/similar", decodeSimilar)(body)
      return yield* toCandidates("/similar")(wire.results)
    })

    const recommendations = Effect.fn("FreqBlog.recommendations")(function*(options: {
      readonly seedTrackIds: ReadonlyArray<string>
      readonly limit: number
      readonly excludeSeedArtists?: boolean
      readonly crossGenre?: CrossGenre
    }) {
      const label = `recommendations from ${options.seedTrackIds.join(", ")}`
      const body = yield* request("/recommendations", {
        seed_tracks: options.seedTrackIds.join(","),
        limit: String(options.limit),
        exclude_seed_artists: String(options.excludeSeedArtists ?? false),
        cross_genre: options.crossGenre ?? "auto"
      }, label)
      const wire = yield* decodeAt("/recommendations", decodeRecommendations)(body)
      return yield* toCandidates("/recommendations")(wire.tracks)
    })

    const embedding = Effect.fn("FreqBlog.embedding")(function*(trackId: string) {
      const body = yield* request(
        `/track/${encodeURIComponent(trackId)}/embedding`,
        {},
        `embedding for ${trackId}`
      )
      const wire = yield* decodeAt("/embedding", decodeEmbedding)(body)
      // Drop filler positions here so no caller can forget to.
      const kept = wire.embedding.flatMap((value, index) =>
        wire.embedding_mask[index] === true ? [{ field: wire.fields[index] ?? "", value }] : []
      )
      return {
        fields: kept.map((entry) => entry.field),
        values: kept.map((entry) => entry.value)
      }
    })

    return { lookup, similar, recommendations, embedding }
  })
)
