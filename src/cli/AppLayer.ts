import { NodeHttpClient } from "@effect/platform-node"
import { Layer } from "effect"
import { FreqBlogLive } from "../sources/freqblog/Client.ts"
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

const SourcesLive = FreqBlogLive.pipe(Layer.provide(NodeHttpClient.layerUndici))

/** The store plus the upstream. Needed only by commands that may have to fetch. */
export const CatalogLive = Layer.mergeAll(StoreLive, SourcesLive)
