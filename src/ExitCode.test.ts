import { assert, describe, it } from "@effect/vitest"
import { Runtime } from "effect"
import { NEEDS_ATTENTION, NO_TRACK, RETRY_SHORTLY } from "./ExitCode.ts"
import {
  ApiKeyNotConfigured,
  IngestQueued,
  InvalidApiKey,
  NotInCatalog,
  QuotaExceeded,
  Unavailable,
  UnexpectedResponse
} from "./sources/freqblog/Errors.ts"
import { NotResolvableUpstream } from "./store/Catalog.ts"

/**
 * The CLI prints a plain message for exactly those failures the runtime is told not to
 * report, and nothing else prints them. So an error that opts out of reporting without
 * anyone printing it fails silently — which is how a missing API key once managed to
 * exit non-zero with no output at all.
 *
 * These tests pin both halves of that contract.
 */

const answers = [
  { error: new NotInCatalog({ query: "x" }), code: NO_TRACK },
  { error: new NotResolvableUpstream({ namespace: "freqblog", value: "1" }), code: NO_TRACK },
  { error: new IngestQueued({ query: "x" }), code: RETRY_SHORTLY },
  { error: new ApiKeyNotConfigured({}), code: NEEDS_ATTENTION },
  { error: new InvalidApiKey({}), code: NEEDS_ATTENTION },
  { error: new QuotaExceeded({}), code: NEEDS_ATTENTION }
]

const malfunctions = [
  new Unavailable({ endpoint: "/lookup", cause: "socket closed" }),
  new UnexpectedResponse({ endpoint: "/lookup", detail: "missing artist_name" })
]

describe("answers rather than malfunctions", () => {
  for (const { code, error } of answers) {
    it(`${error._tag} suppresses the runtime's stack trace`, () => {
      assert.strictEqual(Runtime.getErrorReported(error), false)
    })

    it(`${error._tag} exits ${code}`, () => {
      assert.strictEqual(Runtime.getErrorExitCode(error), code)
    })

    it(`${error._tag} carries a message worth printing`, () => {
      // The CLI prints this and nothing else, so an empty one is a silent failure.
      assert.isAbove(error.message.length, 0)
    })
  }
})

describe("genuine malfunctions", () => {
  for (const error of malfunctions) {
    it(`${error._tag} keeps its stack trace`, () => {
      // A transport fault or an undecodable response is a case where the trace earns
      // its space, so these deliberately do not opt out.
      assert.strictEqual(Runtime.getErrorReported(error), true)
    })

    it(`${error._tag} exits 1`, () => {
      assert.strictEqual(Runtime.getErrorExitCode(error), 1)
    })
  }
})
