import { Runtime, Schema } from "effect"
import { NEEDS_ATTENTION, NO_TRACK, RETRY_SHORTLY } from "../../ExitCode.ts"

/**
 * Failures of the FreqBlog upstream, as typed outcomes.
 *
 * The split matters operationally, not just for tidiness: only `Unavailable` is worth
 * retrying. Retrying a 404 or a bad key spends quota to reproduce a certain failure,
 * and quota is the scarce resource in this system.
 *
 * Most of these are answers rather than malfunctions, and say so by opting out of the
 * runtime's error reporting — see `ExitCode.ts`. A stack trace is kept only where it
 * would help: `Unavailable` and `UnexpectedResponse` mean something is actually wrong.
 */

/** The catalogue does not have this track. A normal outcome, not a malfunction. */
export class NotInCatalog extends Schema.TaggedErrorClass<NotInCatalog>()("NotInCatalog", {
  query: Schema.String
}) {
  override readonly [Runtime.errorReported] = false
  override readonly [Runtime.errorExitCode] = NO_TRACK
  override get message() {
    return `Not in the FreqBlog catalogue: ${this.query}`
  }
}

/**
 * The track was not in the catalogue, so an analysis was queued for it (HTTP 202).
 *
 * A distinct outcome from `NotInCatalog`: this one becomes available if you ask again in
 * thirty seconds to two minutes, so a caller can choose to wait where a 404 means never.
 * The body carries no track, which is why this cannot be folded into the success channel.
 */
export class IngestQueued extends Schema.TaggedErrorClass<IngestQueued>()("IngestQueued", {
  query: Schema.String
}) {
  override readonly [Runtime.errorReported] = false
  override readonly [Runtime.errorExitCode] = RETRY_SHORTLY
  override get message() {
    return `FreqBlog queued an analysis for ${this.query}; retry shortly.`
  }
}

/** Transport failure or a 5xx. The only retryable case. */
export class Unavailable extends Schema.TaggedErrorClass<Unavailable>()("Unavailable", {
  endpoint: Schema.String,
  status: Schema.optional(Schema.Int),
  cause: Schema.Defect()
}) {
  override get message() {
    const status = this.status === undefined ? "" : ` (status ${this.status})`
    return `FreqBlog unavailable at ${this.endpoint}${status}`
  }
}

/**
 * No key was configured at all.
 *
 * Distinct from `InvalidApiKey`, which means a key was sent and refused. Saying which
 * of the two happened is the difference between "go get a key" and "your key is wrong".
 */
export class ApiKeyNotConfigured extends Schema.TaggedErrorClass<ApiKeyNotConfigured>()("ApiKeyNotConfigured", {}) {
  override readonly [Runtime.errorReported] = false
  override readonly [Runtime.errorExitCode] = NEEDS_ATTENTION
  override get message() {
    return "FREQBLOG_API_KEY is not set. Request a free key at https://freqblog.com and put it in .env."
  }
}

/** Rejected credentials. Retrying cannot help. */
export class InvalidApiKey extends Schema.TaggedErrorClass<InvalidApiKey>()("InvalidApiKey", {}) {
  override readonly [Runtime.errorReported] = false
  override readonly [Runtime.errorExitCode] = NEEDS_ATTENTION
  override get message() {
    return "FreqBlog rejected the API key. Check FREQBLOG_API_KEY."
  }
}

/** The monthly request allowance is spent. Retrying cannot help. */
export class QuotaExceeded extends Schema.TaggedErrorClass<QuotaExceeded>()("QuotaExceeded", {}) {
  override readonly [Runtime.errorReported] = false
  override readonly [Runtime.errorExitCode] = NEEDS_ATTENTION
  override get message() {
    return "FreqBlog quota exceeded for this billing period."
  }
}

/**
 * The response arrived but did not match what we expect.
 *
 * `SchemaError` is normalised into this at the boundary so decoding details do not
 * leak upward as a transport concern.
 */
export class UnexpectedResponse extends Schema.TaggedErrorClass<UnexpectedResponse>()(
  "UnexpectedResponse",
  {
    endpoint: Schema.String,
    detail: Schema.String
  }
) {
  override get message() {
    return `FreqBlog returned an unexpected shape from ${this.endpoint}: ${this.detail}`
  }
}

export type FreqBlogError =
  | NotInCatalog
  | IngestQueued
  | Unavailable
  | InvalidApiKey
  | QuotaExceeded
  | UnexpectedResponse
