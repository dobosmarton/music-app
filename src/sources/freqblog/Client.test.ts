import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { FreqBlog, FreqBlogLive } from "./Client.ts"
import lookupFixture from "./fixtures/lookup.json" with { type: "json" }

const query = { _tag: "ByName", artist: "Radiohead", title: "Weird Fishes / Arpeggi" } as const

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
 * A client that answers every request from `responses`, one per call, and counts how
 * many it received. The count is what makes retry behaviour observable: the difference
 * between "retried and recovered" and "did not retry" is only visible as a call count.
 */
const stubHttp = (responses: ReadonlyArray<Response>) =>
  Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      return HttpClient.make((request) =>
        Effect.gen(function*() {
          const index = yield* Ref.getAndUpdate(calls, (n) => n + 1)
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

const freqBlogWith = (responses: ReadonlyArray<Response>) =>
  FreqBlogLive.pipe(Layer.provide(Layer.mergeAll(stubHttp(responses), apiKeyLayer)))

describe("FreqBlog adapter", () => {
  it.effect("decodes a successful lookup into domain vocabulary", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.title, "Weird Fishes / Arpeggi")
      assert.strictEqual(facts.artist, "Radiohead")
      assert.strictEqual(facts.isrc, "GBAYE0700938")
      assert.strictEqual(facts.externalRef.namespace, "freqblog")
      assert.strictEqual(facts.externalRef.value, "1488408568")
      assert.strictEqual(facts.features.bpm, 155.2)
      assert.strictEqual(facts.features.keyCamelot, "9B")
      assert.strictEqual(facts.features.embedding?.length, 18)
    }).pipe(Effect.provide(freqBlogWith([json(lookupFixture)]))))

  it.effect("reports a 404 as NotInCatalog rather than a malfunction", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "NotInCatalog")
    }).pipe(Effect.provide(freqBlogWith([json({ error: "not found" }, 404)]))))

  it.effect("reports a rejected key distinctly from an outage", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "InvalidApiKey")
    }).pipe(Effect.provide(freqBlogWith([json({ error: "unauthorized" }, 401)]))))

  it.effect("reports an exhausted allowance as QuotaExceeded", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "QuotaExceeded")
    }).pipe(Effect.provide(freqBlogWith([json({ error: "quota" }, 429)]))))

  it.live("retries a 5xx and succeeds on a later attempt", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const facts = yield* freqblog.lookup(query)

      assert.strictEqual(facts.artist, "Radiohead")
    }).pipe(
      Effect.provide(freqBlogWith([
        json({ error: "boom" }, 503),
        json(lookupFixture)
      ]))
    ))

  it.effect("turns a malformed body into an adapter error, not a SchemaError", () =>
    Effect.gen(function*() {
      const freqblog = yield* FreqBlog
      const error = yield* Effect.flip(freqblog.lookup(query))

      assert.strictEqual(error._tag, "UnexpectedResponse")
    }).pipe(Effect.provide(freqBlogWith([json({ id: "1", title: "no artist field" })]))))
})
