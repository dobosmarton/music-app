import { assert, layer } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { Isrc } from "../../../domain/Identity.ts"
import { FreqBlog, FreqBlogLive } from "../Client.ts"
import { catalogue } from "./Catalogue.ts"
import { FreqBlogMockHttp } from "./Server.ts"

/**
 * These run the real adapter against the mock transport.
 *
 * That is the whole point of the mock being an `HttpClient`: a passing test here says
 * the decoding, the status mapping and the seeded data all still agree. A stubbed
 * service would have proved only that the stub matches itself.
 */

const withKey = (values: Record<string, string>) =>
  ConfigProvider.layer(
    ConfigProvider.make((path) => {
      const value = values[path.join(".")]
      return Effect.succeed(value === undefined ? undefined : ConfigProvider.makeValue(value))
    })
  )

/**
 * Bound as constants rather than built per test.
 *
 * Layers are memoized by reference, so a factory called once per test would hand out a
 * distinct layer each time and quietly defeat that. The quota-limited variant is a
 * separate constant because it is a different configuration, not a different instance.
 */
const MockLive = FreqBlogLive.pipe(
  Layer.provide(FreqBlogMockHttp),
  Layer.provide(withKey({ FREQBLOG_API_KEY: "mock-key" }))
)

const MockWithQuotaOfOne = FreqBlogLive.pipe(
  Layer.provide(FreqBlogMockHttp),
  Layer.provide(withKey({ FREQBLOG_API_KEY: "mock-key", FREQBLOG_MOCK_QUOTA: "1" }))
)

layer(MockLive)("FreqBlog mock", (it) => {
  it.effect("resolves a seeded track by name through the real decoder", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup({
        _tag: "ByName",
        artist: "Neon Cartography",
        title: "Tidal Drift"
      })

      assert.strictEqual(facts.title, "Tidal Drift")
      assert.strictEqual(facts.externalRef.value, "900000001")
      assert.strictEqual(facts.features.bpm, 72)
      assert.strictEqual(facts.features.keyCamelot, "8A")
      assert.strictEqual(facts.releaseYear, 2019)
      assert.strictEqual(facts.quality, "final")
    }))

  it.effect("matches a name regardless of case and padding", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup({
        _tag: "ByName",
        artist: "  neon cartography ",
        title: "TIDAL DRIFT"
      })

      assert.strictEqual(facts.externalRef.value, "900000001")
    }))

  it.effect("reports a seeded preview track as provisional", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup({
        _tag: "ByName",
        artist: "Neon Cartography",
        title: "Signal Bloom"
      })

      assert.strictEqual(facts.quality, "provisional")
    }))

  it.effect("queues an ingest for an unknown name, as the live API does", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(
        freqblog.lookup({ _tag: "ByName", artist: "Nobody", title: "No Such Song" })
      )

      assert.strictEqual(error._tag, "IngestQueued")
    }))

  it.effect("fails an unknown identifier outright, with no ingest to queue", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(
        freqblog.lookup({
          _tag: "ByIsrc",
          isrc: Schema.decodeUnknownSync(Isrc)("XXMCK9900000")
        })
      )

      assert.strictEqual(error._tag, "NotInCatalog")
    }))

  it.effect("round-trips the synthetic isrc and mbid it advertises", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const byName = yield* freqblog.lookup({
        _tag: "ByName",
        artist: "Cobalt Yield",
        title: "Deep Field"
      })

      const { isrc, mbid } = byName
      if (isrc === undefined || mbid === undefined) {
        return assert.fail("the mock should advertise both an isrc and an mbid")
      }

      const byIsrc = yield* freqblog.lookup({ _tag: "ByIsrc", isrc })
      const byMbid = yield* freqblog.lookup({ _tag: "ByMbid", mbid })

      assert.strictEqual(byIsrc.externalRef.value, byName.externalRef.value)
      assert.strictEqual(byMbid.externalRef.value, byName.externalRef.value)
    }))

  it.effect("returns similar tracks as candidates with no acoustic data", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.similar({ trackId: "900000001", limit: 5 })

      assert.strictEqual(candidates.length, 5)
      // The seed itself is never a candidate.
      assert.ok(candidates.every((candidate) => candidate.externalRef.value !== "900000001"))
      // Scores arrive ranked, and the domain type simply has nowhere to put a BPM.
      assert.ok((candidates[0]?.score ?? 0) >= (candidates[1]?.score ?? 0))
      assert.ok(candidates.every((candidate) => candidate.genreRelation !== undefined))
    }))

  it.effect("ranks an acoustically close track above a distant one", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      // Seeded from a 60 bpm ambient piece: the other ambient tracks should beat
      // a 174 bpm drum-and-bass one, or the mock is not modelling similarity at all.
      const candidates = yield* freqblog.similar({
        trackId: "900000004",
        limit: 24,
        crossGenre: "allow"
      })

      const rankOf = (id: string) => candidates.findIndex((c) => c.externalRef.value === id)
      assert.ok(rankOf("900000001") < rankOf("900000012"), "ambient should outrank drum-and-bass")
    }))

  it.effect("honours exclude_same_artist", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.similar({
        trackId: "900000001",
        limit: 24,
        excludeSameArtist: true
      })

      assert.ok(candidates.every((candidate) => candidate.artist !== "Neon Cartography"))
    }))

  it.effect("keeps strict cross_genre inside the seed's family", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.similar({
        trackId: "900000010",
        limit: 24,
        crossGenre: "strict"
      })

      assert.ok(candidates.length > 0)
      assert.ok(candidates.every((candidate) => candidate.genre === "hip-hop"))
    }))

  it.effect("blends multiple recommendation seeds and echoes unfound ids", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.recommendations({
        seedTrackIds: ["900000022", "900000023", "404404404"],
        limit: 4
      })

      assert.strictEqual(candidates.length, 4)
      // Both seeds are excluded from their own results.
      assert.ok(
        candidates.every((candidate) =>
          candidate.externalRef.value !== "900000022" &&
          candidate.externalRef.value !== "900000023"
        )
      )
    }))

  it.effect("serves a masked embedding narrower than the declared width", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const vector = yield* freqblog.embedding("900000001")

      // time_signature is constant across the seed set, so it is masked out.
      assert.strictEqual(vector.values.length, 17)
      assert.strictEqual(vector.fields.length, 17)
      assert.ok(!vector.fields.includes("time_signature"))
    }))

  it.effect("every seeded track resolves and decodes", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      // A seed that cannot survive the real decoder is a trap, not a fixture.
      yield* Effect.forEach(catalogue, (track) =>
        freqblog.lookup({ _tag: "ByName", artist: track.artist, title: track.title }), {
        concurrency: 4
      })
    }))
})

layer(MockWithQuotaOfOne)("FreqBlog mock under a quota ceiling", (it) => {
  it.effect("reports the second request as QuotaExceeded", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const query = { _tag: "ByName", artist: "Vela Sound", title: "Undertow" } as const

      yield* freqblog.lookup(query)
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "QuotaExceeded")
    }))
})
