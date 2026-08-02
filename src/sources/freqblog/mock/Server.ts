import { Config, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientResponse, UrlParams } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import type { SeedTrack } from "./Catalogue.ts"
import {
  catalogue,
  EMBEDDING_FIELDS,
  embeddingMaskOf,
  embeddingOf,
  findById,
  findByIsrc,
  findByMbid,
  findByName,
  genreRelation,
  lookupBody,
  stubBody
} from "./Catalogue.ts"

/**
 * A fake FreqBlog, implemented as an `HttpClient` rather than as a fake `FreqBlog`.
 *
 * The difference matters. Stubbing the service would bypass the very code most likely to
 * be wrong — the wire decoding, the status-to-error mapping, the retry policy — and a
 * mock that bypasses them cannot tell you the adapter still works. Speaking the wire
 * protocol instead means the real client sits on top unchanged, and the mock cannot
 * drift from the contract without a test noticing.
 *
 * It answers `/lookup`, `/similar`, `/recommendations` and `/track/{id}/embedding`:
 * everything the adapter calls.
 */

const paramOf = (request: HttpClientRequest.HttpClientRequest, name: string) =>
  Option.getOrUndefined(UrlParams.getFirst(request.urlParams, name))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })

/** 202 carries no body — the track is not ready, only promised. */
const accepted = () => new Response(null, { status: 202 })

const error = (status: number, detail: string) => json({ detail, error_code: null }, status)

/** Cosine over the measured positions only, exactly as the mask instructs callers to. */
const similarity = (left: SeedTrack, right: SeedTrack) => {
  const mask = embeddingMaskOf(left)
  const a = embeddingOf(left).filter((_, index) => mask[index] === true)
  const b = embeddingOf(right).filter((_, index) => mask[index] === true)

  let dot = 0
  let normA = 0
  let normB = 0
  for (const [index, valueA] of a.entries()) {
    const valueB = b[index] ?? 0
    dot += valueA * valueB
    normA += valueA * valueA
    normB += valueB * valueB
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dot / magnitude
}

/** How strongly `auto` prefers a candidate from the seed's own genre family. */
const affinity = (relation: string) => relation === "same" ? 2 : relation === "adjacent" ? 1 : 0

interface RankOptions {
  readonly excludeArtists: ReadonlyArray<string>
  readonly crossGenre: string
  readonly limit: number
}

/**
 * Rank the catalogue against a seed, honouring the same knobs the live endpoint takes.
 *
 * `strict` keeps only the seed's genre family; `auto` re-orders so a coincidentally
 * close cross-genre track does not outrank a same-family one; `allow` leaves the raw
 * acoustic ordering alone.
 */
const rank = (seeds: ReadonlyArray<SeedTrack>, options: RankOptions) => {
  const seedIds = new Set(seeds.map((seed) => seed.id))
  const primary = seeds[0]
  if (primary === undefined) return []

  const scored = catalogue
    .filter((track) => !seedIds.has(track.id))
    .filter((track) => !options.excludeArtists.includes(track.artist))
    .map((track) => {
      const score = seeds.reduce((total, seed) => total + similarity(seed, track), 0) / seeds.length
      return { track, score, relation: genreRelation(primary.genre, track.genre) }
    })
    .filter((entry) => options.crossGenre !== "strict" || entry.relation !== "cross")

  const ordered = options.crossGenre === "auto"
    ? scored.toSorted((left, right) => affinity(right.relation) - affinity(left.relation) || right.score - left.score)
    : scored.toSorted((left, right) => right.score - left.score)

  return ordered.slice(0, options.limit)
}

const limitOf = (request: HttpClientRequest.HttpClientRequest, fallback: number) => {
  const raw = paramOf(request, "limit")
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const isTrue = (value: string | undefined) => value === "true"

const handleLookup = (request: HttpClientRequest.HttpClientRequest) => {
  const isrc = paramOf(request, "isrc")
  const mbid = paramOf(request, "mbid")
  const title = paramOf(request, "track") ?? paramOf(request, "title")
  const artist = paramOf(request, "artist")

  if (isrc !== undefined) {
    const found = findByIsrc(isrc)
    // An id-shaped miss is terminal: there is no name to drive an ingest.
    return found === undefined ? error(404, `no track for isrc ${isrc}`) : json(lookupBody(found))
  }
  if (mbid !== undefined) {
    const found = findByMbid(mbid)
    return found === undefined ? error(404, `no track for mbid ${mbid}`) : json(lookupBody(found))
  }
  if (title !== undefined) {
    const found = findByName(title, artist)
    // A name miss queues an ingest instead of failing.
    return found === undefined ? accepted() : json(lookupBody(found))
  }
  return error(422, "supply exactly one of track, isrc, mbid or spotify_id")
}

const handleSimilar = (request: HttpClientRequest.HttpClientRequest) => {
  const trackId = paramOf(request, "track_id") ?? paramOf(request, "seed_track_id") ??
    paramOf(request, "itunes_track_id")
  if (trackId === undefined) return error(400, "a seed is required")

  const seed = findById(trackId)
  if (seed === undefined) return error(404, `no catalogue track ${trackId}`)

  const results = rank([seed], {
    excludeArtists: isTrue(paramOf(request, "exclude_same_artist")) ? [seed.artist] : [],
    crossGenre: paramOf(request, "cross_genre") ?? "auto",
    limit: limitOf(request, 10)
  })

  return json({
    seed: stubBody(seed),
    count: results.length,
    results: results.map((entry) => ({
      track: stubBody(entry.track),
      genre_relation: entry.relation,
      score: Number(entry.score.toFixed(6))
    }))
  })
}

const handleRecommendations = (request: HttpClientRequest.HttpClientRequest) => {
  const raw = paramOf(request, "seed_tracks")
  const title = paramOf(request, "track")

  const requested: ReadonlyArray<string> = raw === undefined
    ? []
    : raw.split(",").map((id) => id.trim()).filter((id) => id !== "")
  const byName = title === undefined ? undefined : findByName(title, paramOf(request, "artist"))

  const resolved: ReadonlyArray<SeedTrack> = requested
    .map((id) => findById(id))
    .filter((track): track is SeedTrack => track !== undefined)

  const seeds: ReadonlyArray<SeedTrack> = requested.length > 0
    ? resolved
    : byName === undefined
    ? []
    : [byName]

  if (seeds.length === 0) {
    return error(404, "no seed resolved")
  }

  const results = rank(seeds, {
    excludeArtists: isTrue(paramOf(request, "exclude_seed_artists"))
      ? seeds.map((seed) => seed.artist)
      : [],
    crossGenre: paramOf(request, "cross_genre") ?? "auto",
    limit: limitOf(request, 20)
  })

  return json({
    // Ids that resolved to nothing are echoed back unfound rather than dropped.
    seeds: requested.length > 0
      ? requested.map((id) => ({ id, found: findById(id) !== undefined }))
      : seeds.map((seed) => ({ id: seed.id, found: true })),
    seed_query: byName === undefined ? null : stubBody(byName),
    count: results.length,
    tracks: results.map((entry) => ({
      track: stubBody(entry.track),
      genre_relation: entry.relation,
      score: Number(entry.score.toFixed(6))
    }))
  })
}

const handleEmbedding = (trackId: string) => {
  const track = findById(trackId)
  if (track === undefined) return error(404, `no catalogue track ${trackId}`)
  return json({
    itunes_track_id: track.id,
    track_name: track.title,
    artist_name: track.artist,
    dim: EMBEDDING_FIELDS.length,
    fields: [...EMBEDDING_FIELDS],
    embedding: embeddingOf(track),
    embedding_mask: embeddingMaskOf(track)
  })
}

const route = (request: HttpClientRequest.HttpClientRequest) => {
  const path = new URL(request.url).pathname

  if (path === "/lookup") return handleLookup(request)
  if (path === "/similar") return handleSimilar(request)
  if (path === "/recommendations") return handleRecommendations(request)

  const embeddingPath = /^\/track\/([^/]+)\/embedding$/.exec(path)
  if (embeddingPath?.[1] !== undefined) return handleEmbedding(decodeURIComponent(embeddingPath[1]))

  return error(404, `mock has no route for ${path}`)
}

/**
 * An optional request ceiling, so the 429 path can be exercised without waiting a month.
 *
 * Unset means unlimited. Quota is the binding constraint on the real key, and code that
 * has never once seen a `QuotaExceeded` is code that has never been tested against the
 * thing most likely to stop it.
 */
const quotaLimit = Config.schema(Schema.Int, "FREQBLOG_MOCK_QUOTA").pipe(Config.option)

export const FreqBlogMockHttp = Layer.effect(HttpClient.HttpClient)(
  Effect.gen(function*() {
    const limit = yield* quotaLimit
    const spent = yield* Ref.make(0)

    yield* Effect.logInfo(
      `FreqBlog mock serving ${catalogue.length} seeded tracks` +
        (limit._tag === "Some" ? ` with a ${limit.value}-request quota` : "")
    )

    return HttpClient.make((request) =>
      Effect.gen(function*() {
        const used = yield* Ref.updateAndGet(spent, (n) => n + 1)
        if (limit._tag === "Some" && used > limit.value) {
          return HttpClientResponse.fromWeb(request, error(429, "mock quota exceeded"))
        }
        return HttpClientResponse.fromWeb(request, route(request))
      })
    )
  })
)
