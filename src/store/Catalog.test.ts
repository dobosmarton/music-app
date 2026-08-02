import { NodeServices } from "@effect/platform-node"
import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer, Ref, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { TrackFacts } from "../domain/Recording.ts"
import { FreqBlog } from "../sources/freqblog/Client.ts"
import { NotInCatalog } from "../sources/freqblog/Errors.ts"
import { resolveRecording } from "./Catalog.ts"
import { FeatureRepo, FeatureRepoLive } from "./FeatureRepo.ts"
import { RecordingRepoLive } from "./RecordingRepo.ts"
import { ResolutionLogLive } from "./ResolutionLog.ts"
import { TestDatabaseLive, truncateAll } from "./testing/TestDatabase.ts"

const query = { _tag: "ByName", artist: "Radiohead", title: "Weird Fishes / Arpeggi" } as const

// Decoded rather than constructed, so the branded fields are branded by the schema
// that defines them rather than asserted here.
const facts = Schema.decodeUnknownSync(TrackFacts)({
  title: "Weird Fishes / Arpeggi",
  artist: "Radiohead",
  isrc: "GBAYE0700938",
  durationMs: 318000,
  releaseYear: 2007,
  externalRef: { namespace: "freqblog", value: "1488408568" },
  quality: "final",
  features: {
    bpm: 155.2,
    keyCamelot: "9B",
    energy: 0.62,
    genres: ["alternative rock"],
    embedding: Array.from({ length: 18 }, (_, i) => i / 18)
  }
})

/**
 * Counts lookups so the read-through is observable. Whether the second resolution
 * touched the network is the whole point of this module, and only a call count can
 * show it.
 */
const countingFreqBlog = Layer.effect(FreqBlog)(
  Effect.gen(function*() {
    const lookups = yield* Ref.make(0)
    return {
      lookup: () => Effect.as(Ref.update(lookups, (n) => n + 1), facts),
      similar: () => Effect.succeed([]),
      recommendations: () => Effect.succeed([]),
      embedding: () => Effect.succeed({ fields: [], values: [] }),
      lookupCount: Ref.get(lookups)
    }
  })
)

const lookupCount = Effect.flatMap(
  FreqBlog,
  (service) =>
    "lookupCount" in service && Effect.isEffect(service.lookupCount)
      ? service.lookupCount
      : Effect.succeed(-1)
)

const StoreLive = Layer.mergeAll(RecordingRepoLive, FeatureRepoLive, ResolutionLogLive)

const TestLive = Layer.mergeAll(StoreLive, countingFreqBlog).pipe(
  Layer.provideMerge(TestDatabaseLive),
  Layer.provide(NodeServices.layer)
)

describe("Catalog read-through", () => {
  layer(TestLive)((it) => {
    it.effect("fetches on a miss and serves the same track from the store afterwards", () =>
      Effect.gen(function*() {
        yield* truncateAll

        const first = yield* resolveRecording(query)
        assert.strictEqual(first.origin, "upstream")
        assert.strictEqual(first.known.recording.title, "Weird Fishes / Arpeggi")

        const second = yield* resolveRecording(query)
        assert.strictEqual(second.origin, "store")
        assert.strictEqual(second.known.recording.id, first.known.recording.id)

        assert.strictEqual(yield* lookupCount, 1)
      }))

    it.effect("mirrors features with their provenance", () =>
      Effect.gen(function*() {
        yield* truncateAll
        const resolved = yield* resolveRecording(query)

        assert.strictEqual(resolved.known.features.length, 1)
        const stored = resolved.known.features[0]!
        assert.strictEqual(stored.source, "freqblog")
        assert.strictEqual(stored.bpm, 155.2)
        assert.strictEqual(stored.keyCamelot, "9B")
        assert.deepStrictEqual(stored.genres, ["alternative rock"])
        assert.strictEqual(stored.embedding?.length, 18)
      }))

    it.effect("keeps the vendor id out of the recording table", () =>
      Effect.gen(function*() {
        yield* truncateAll
        yield* resolveRecording(query)

        const sql = yield* SqlClient.SqlClient
        const refs = yield* sql<{ namespace: string; value: string }>`
          SELECT namespace, value FROM external_id
        `
        assert.deepStrictEqual(refs, [{ namespace: "freqblog", value: "1488408568" }])
      }))

    it.effect("logs a miss then a hit, so the hit rate is computable", () =>
      Effect.gen(function*() {
        yield* truncateAll
        yield* resolveRecording(query)
        yield* resolveRecording(query)

        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ cache_hit: boolean }>`
          SELECT cache_hit FROM upstream_call ORDER BY id
        `
        assert.deepStrictEqual(rows.map((row) => row.cache_hit), [false, true])
      }))

    it.effect("resolving twice does not create a second recording", () =>
      Effect.gen(function*() {
        yield* truncateAll
        yield* resolveRecording(query)
        yield* resolveRecording({ _tag: "ByExternalRef", ref: facts.externalRef })

        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ count: string }>`SELECT count(*) AS count FROM recording`
        assert.strictEqual(rows[0]?.count, "1")
      }))

    it.effect("records the quality the upstream reported", () =>
      Effect.gen(function*() {
        yield* truncateAll
        const resolved = yield* resolveRecording(query)

        assert.strictEqual(resolved.known.features[0]?.quality, "final")
      }))

    it.effect("refuses to spend a request on a vendor id the upstream cannot take", () =>
      Effect.gen(function*() {
        yield* truncateAll

        // `/lookup` has no parameter for an itunes_track_id, so a ref that missed the
        // store is a dead end. Calling anyway would burn quota to earn a 422.
        const before = yield* lookupCount
        const error = yield* Effect.flip(
          resolveRecording({
            _tag: "ByExternalRef",
            ref: { namespace: "freqblog", value: "999999" }
          })
        )
        assert.strictEqual(error._tag, "NotResolvableUpstream")
        assert.strictEqual(yield* lookupCount, before)
      }))
  })
})

describe("Catalog when the feature write fails", () => {
  const brokenFeatures = Layer.succeed(FeatureRepo, {
    findByRecording: () => Effect.succeed([]),
    upsert: () => Effect.die("feature write failed")
  })

  const BrokenLive = Layer.mergeAll(
    RecordingRepoLive,
    brokenFeatures,
    ResolutionLogLive,
    countingFreqBlog
  ).pipe(Layer.provideMerge(TestDatabaseLive), Layer.provide(NodeServices.layer))

  layer(BrokenLive)((it) => {
    it.effect("leaves no recording behind, so the next attempt still fetches", () =>
      Effect.gen(function*() {
        yield* truncateAll

        // A half-written track is worse than an absent one: the read-through counts
        // any stored recording as a hit, so the gap would be served as the answer.
        yield* Effect.exit(resolveRecording(query))

        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ count: string }>`SELECT count(*) AS count FROM recording`
        assert.strictEqual(rows[0]?.count, "0")
      }))
  })
})

describe("Catalog when the upstream has nothing", () => {
  const MissingLive = Layer.mergeAll(
    StoreLive,
    Layer.succeed(FreqBlog, {
      lookup: () => Effect.fail(new NotInCatalog({ query: "unknown" })),
      similar: () => Effect.succeed([]),
      recommendations: () => Effect.succeed([]),
      embedding: () => Effect.succeed({ fields: [], values: [] })
    })
  ).pipe(Layer.provideMerge(TestDatabaseLive), Layer.provide(NodeServices.layer))

  layer(MissingLive)((it) => {
    it.effect("surfaces NotInCatalog rather than inventing a recording", () =>
      Effect.gen(function*() {
        yield* truncateAll
        const error = yield* Effect.flip(resolveRecording(query))
        assert.strictEqual(error._tag, "NotInCatalog")

        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ count: string }>`SELECT count(*) AS count FROM recording`
        assert.strictEqual(rows[0]?.count, "0")
      }))
  })
})
