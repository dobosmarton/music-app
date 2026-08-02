import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Ref, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Isrc } from "../../domain/Identity.ts"
import { FreqBlog, FreqBlogLive } from "./Client.ts"
import lookupFixture from "./fixtures/lookup.json" with { type: "json" }
import recommendationsFixture from "./fixtures/recommendations.json" with { type: "json" }
import similarFixture from "./fixtures/similar.json" with { type: "json" }

/**
 * The fixtures are recorded from live responses against API v1.5.0, not hand-written.
 * A fixture we invent can only ever confirm that the adapter agrees with our guess.
 */

const query = { _tag: "ByName", artist: "Boards of Canada", title: "Roygbiv" } as const

const apiKeyLayer = ConfigProvider.layer(
  ConfigProvider.make((path) =>
    Effect.succeed(
      path.join(".") === "FREQBLOG_API_KEY"
        ? ConfigProvider.makeValue("test-key")
        : undefined
    )
  )
)

/**
 * A client that answers every request from `responses`, one per call, and records the
 * urls it was asked for. The count is what makes retry behaviour observable: the
 * difference between "retried and recovered" and "did not retry" is only visible as a
 * call count.
 */
const stubHttp = (
  responses: ReadonlyArray<Response>,
  seen?: Ref.Ref<ReadonlyArray<ReadonlyArray<readonly [string, string]>>>
) =>
  Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      return HttpClient.make((request) =>
        Effect.gen(function*() {
          const index = yield* Ref.getAndUpdate(calls, (n) => n + 1)
          if (seen !== undefined) {
            yield* Ref.update(seen, (params) => [...params, [...request.urlParams]])
          }
          const response = responses[Math.min(index, responses.length - 1)]!
          return HttpClientResponse.fromWeb(request, response.clone())
        })
      )
    })
  )

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })

/** 202 carries no body — the track is not ready yet, only promised. */
const accepted = () => new Response(null, { status: 202 })

const freqBlogWith = (
  responses: ReadonlyArray<Response>,
  seen?: Ref.Ref<ReadonlyArray<ReadonlyArray<readonly [string, string]>>>
) => FreqBlogLive.pipe(Layer.provide(Layer.mergeAll(stubHttp(responses, seen), apiKeyLayer)))

describe("FreqBlog adapter", () => {
  it.effect("decodes a successful lookup into domain vocabulary", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.title, "Roygbiv")
      assert.strictEqual(facts.artist, "Boards of Canada")
      assert.strictEqual(facts.mbid, "874060fd-9cd9-4019-ae66-bfb3548fe1da")
      assert.strictEqual(facts.externalRef.namespace, "freqblog")
      assert.strictEqual(facts.externalRef.value, "281116081")
      assert.strictEqual(facts.features.bpm, 83.02)
      assert.strictEqual(facts.features.keyCamelot, "10A")
      assert.strictEqual(facts.features.loudnessDb, -18.67)
      assert.deepStrictEqual(facts.features.genres, ["electronic"])
    }).pipe(Effect.provide(freqBlogWith([json(lookupFixture)]))))

  it.effect("keeps only the year from an ISO release date", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.releaseYear, 2004)
    }).pipe(Effect.provide(freqBlogWith([json(lookupFixture)]))))

  it.effect("marks preview features as provisional", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      // The recorded response is `essentia_preview` with a queued backfill — these
      // numbers can still change, and a baseline must not be built on them unknowingly.
      assert.strictEqual(facts.quality, "provisional")
    }).pipe(Effect.provide(freqBlogWith([json(lookupFixture)]))))

  it.effect("marks a settled analysis as final", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.quality, "final")
    }).pipe(
      Effect.provide(freqBlogWith([
        json({ ...lookupFixture, feature_source: "essentia", backfill_status: "complete" })
      ]))
    ))

  it.effect("sends exactly one identifying parameter", () =>
    Effect.gen(function*() {
      const seen = yield* Ref.make<ReadonlyArray<ReadonlyArray<readonly [string, string]>>>([])
      yield* Effect.provide(
        Effect.gen(function*() {
          const freqblog = yield* FreqBlog
          yield* freqblog.lookup({
            _tag: "ByIsrc",
            isrc: Schema.decodeUnknownSync(Isrc)("GBAYE0700938")
          })
        }),
        freqBlogWith([json(lookupFixture)], seen)
      )

      const sent = (yield* Ref.get(seen))[0] ?? []
      const keys = sent.map(([key]) => key).toSorted()
      // Supplying more than one of track/isrc/mbid/spotify_id is a 422.
      assert.deepStrictEqual(keys, ["isrc", "wait"])
      assert.deepStrictEqual(sent.find(([key]) => key === "isrc")?.[1], "GBAYE0700938")
    }))

  it.effect("reports a queued ingest distinctly from a miss", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      // 202 means "ask again in a minute"; 404 means never. Collapsing them would
      // either strand a track that was about to arrive or retry one that never will.
      assert.strictEqual(error._tag, "IngestQueued")
    }).pipe(Effect.provide(freqBlogWith([accepted()]))))

  it.effect("reports a 404 as NotInCatalog rather than a malfunction", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "NotInCatalog")
    }).pipe(Effect.provide(freqBlogWith([json({ detail: "not found" }, 404)]))))

  it.effect("reports a rejected key distinctly from an outage", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "InvalidApiKey")
    }).pipe(Effect.provide(freqBlogWith([json({ detail: "unauthorized" }, 401)]))))

  it.effect("reports an exhausted allowance as QuotaExceeded", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "QuotaExceeded")
    }).pipe(Effect.provide(freqBlogWith([json({ detail: "quota" }, 429)]))))

  it.live("retries a 5xx and succeeds on a later attempt", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.artist, "Boards of Canada")
    }).pipe(
      Effect.provide(freqBlogWith([
        json({ detail: "boom" }, 503),
        json(lookupFixture)
      ]))
    ))

  it.effect("turns a malformed body into an adapter error, not a SchemaError", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "UnexpectedResponse")
    }).pipe(Effect.provide(freqBlogWith([json({ itunes_track_id: "1", track_name: "no artist" })]))))

  it.effect("returns similar tracks as candidates carrying no acoustic data", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.similar({ trackId: "281116081", limit: 3 })

      assert.strictEqual(candidates.length, 3)
      const [first] = candidates
      assert.strictEqual(first?.title, "Running Blind")
      assert.strictEqual(first?.artist, "Noisia")
      assert.strictEqual(first?.externalRef.value, "1128831476")
      assert.strictEqual(first?.genreRelation, "same")
      assert.ok((first?.score ?? 0) > 0.9)
      // The upstream does not normalise genre — this candidate comes back German.
      assert.strictEqual(first?.genre, "elektronisch")
    }).pipe(Effect.provide(freqBlogWith([json(similarFixture)]))))

  it.effect("returns recommendations in the same candidate shape", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const candidates = yield* freqblog.recommendations({
        seedTrackIds: ["281116081"],
        limit: 3
      })

      assert.strictEqual(candidates.length, 3)
      assert.strictEqual(candidates[0]?.externalRef.value, "1128831476")
    }).pipe(Effect.provide(freqBlogWith([json(recommendationsFixture)]))))

  it.effect("drops embedding positions the upstream marked as filler", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const vector = yield* freqblog.embedding("281116081")

      // Filler positions are defaults, not measurements; leaving them in would make
      // sparsely-analysed tracks look close to everything.
      assert.deepStrictEqual(vector.values, [0.5, 0.7])
      assert.deepStrictEqual(vector.fields, ["bpm", "energy"])
    }).pipe(
      Effect.provide(freqBlogWith([
        json({
          itunes_track_id: "281116081",
          dim: 3,
          fields: ["bpm", "energy", "valence"],
          embedding: [0.5, 0.7, 0.0],
          embedding_mask: [true, true, false]
        })
      ]))
    ))
})
