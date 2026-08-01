import { PgClient } from "@effect/sql-pg"
import { Config, Data, Effect, Layer, Redacted } from "effect"

/**
 * `DATABASE_URL` is the only configuration this layer reads, so an absent value is
 * the only way its config can fail. Saying that plainly beats the generic schema
 * error, which reports the value as redacted and reads like corruption.
 */
export class DatabaseNotConfigured extends Data.TaggedError("DatabaseNotConfigured") {
  override get message() {
    return "DATABASE_URL is not set. Copy env.example to .env and fill it in, or export it for this shell."
  }
}

const APPLICATION_NAME = "music-app"

/**
 * Read as a plain string and redacted immediately afterwards rather than read with
 * `Config.redacted`. Both keep the value out of logs and spans, but reading it as a
 * string means the failure can only ever be "absent", so nothing sensitive can reach
 * the error message.
 */
const databaseUrl = Effect.gen(function*() {
  return yield* Config.string("DATABASE_URL")
}).pipe(Effect.catchTag("ConfigError", () => new DatabaseNotConfigured()))

export const DatabaseLive = Layer.unwrap(
  Effect.map(databaseUrl, (url) =>
    PgClient.layer({
      url: Redacted.make(url),
      applicationName: APPLICATION_NAME
    }))
)
