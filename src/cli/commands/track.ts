import { Console, Effect } from "effect"
import { Argument, Command } from "effect/unstable/cli"
import type { Features } from "../../domain/Recording.ts"
import { resolveRecording } from "../../store/Catalog.ts"
import { CatalogLive } from "../AppLayer.ts"

const describeFeatures = (features: ReadonlyArray<Features>) =>
  features.map((f) => {
    const parts = [
      f.bpm === undefined ? undefined : `${f.bpm.toFixed(1)} bpm`,
      f.keyCamelot,
      f.energy === undefined ? undefined : `energy ${f.energy.toFixed(2)}`,
      f.mood,
      f.genres === undefined ? undefined : f.genres.join(", "),
      f.embedding === undefined ? undefined : `${f.embedding.length}-dim embedding`
    ].filter((part) => part !== undefined)
    return `  ${f.source}: ${parts.join(" · ")}`
  })

export const trackLookup = Command.make("track:lookup", {
  artist: Argument.string("artist"),
  title: Argument.string("title")
}, ({ artist, title }) =>
  Effect.gen(function*() {
    const resolved = yield* resolveRecording({ _tag: "ByName", artist, title })
    const { recording } = resolved.known

    yield* Console.log(`${recording.artist} — ${recording.title}`)
    yield* Console.log(
      resolved.origin === "store"
        ? "Served from the store; no request was made."
        : "Fetched from FreqBlog and mirrored into the store."
    )
    if (recording.isrc !== undefined) {
      yield* Console.log(`  isrc ${recording.isrc}`)
    }
    yield* Effect.forEach(describeFeatures(resolved.known.features), Console.log)
  })).pipe(
    Command.provide(CatalogLive),
    Command.withDescription("Resolve a track, from the store if we already know it.")
  )
