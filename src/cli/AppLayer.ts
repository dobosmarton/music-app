import { NodeHttpClient } from "@effect/platform-node"
import { Config, Effect, Layer, Schema } from "effect"
import { FreqBlogLive } from "../sources/freqblog/Client.ts"
import { FreqBlogMockHttp } from "../sources/freqblog/mock/Server.ts"
import { DatabaseLive } from "../store/Database.ts"
import { FeatureRepoLive } from "../store/FeatureRepo.ts"
import { RecordingRepoLive } from "../store/RecordingRepo.ts"
import { ResolutionLogLive } from "../store/ResolutionLog.ts"

/**
 * Each subsystem is wired locally, then the whole graph is assembled once here.
 *
 * Composing subsystems in place — rather than nesting `provide` calls at the point of
 * assembly — keeps shared dependencies visible and lets either half be swapped in a
 * test without unpicking the other.
 */
/**
 * The store alone. Enough for anything that only reads what we already know, which
 * means those commands do not need a FreqBlog key to run.
 */
export const StoreLive = Layer.mergeAll(
  RecordingRepoLive,
  FeatureRepoLive,
  ResolutionLogLive
).pipe(Layer.provideMerge(DatabaseLive))

/**
 * Which FreqBlog to talk to.
 *
 * `mock` swaps the transport, not the adapter: the real client — decoding, error
 * mapping, retry, concurrency limit — runs unchanged on top of a fake server. A mode
 * that replaced the adapter itself would let the two drift apart, and the mock would
 * stop being evidence of anything.
 */
const FreqBlogMode = Schema.Literals(["live", "mock"])

const freqBlogMode = Config.schema(FreqBlogMode, "FREQBLOG_MODE").pipe(
  Config.withDefault("live" as const)
)

const SourcesLive = Layer.unwrap(
  Effect.map(freqBlogMode, (mode) =>
    FreqBlogLive.pipe(
      Layer.provide(mode === "mock" ? FreqBlogMockHttp : NodeHttpClient.layerUndici)
    ))
)

/** The store plus the upstream. Needed only by commands that may have to fetch. */
export const CatalogLive = Layer.mergeAll(StoreLive, SourcesLive)
