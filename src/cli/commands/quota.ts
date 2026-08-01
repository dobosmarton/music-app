import { Console, DateTime, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { ResolutionLog } from "../../store/ResolutionLog.ts"
import { StoreLive } from "../AppLayer.ts"

/**
 * The free allowance resets monthly, so the month is the window that matters. A miss
 * is a spent request; a hit is one the store saved.
 */
const startOfMonth = Effect.map(DateTime.now, (now) =>
  DateTime.toDateUtc(DateTime.startOf(now, "month")))

export const quota = Command.make("quota", {}, () =>
  Effect.gen(function*() {
    const log = yield* ResolutionLog
    const since = yield* startOfMonth
    const summaries = yield* log.summarize(since)

    if (summaries.length === 0) {
      return yield* Console.log("No resolutions recorded this month.")
    }

    yield* Console.log(`Since ${since.toISOString().slice(0, 10)}:`)
    yield* Effect.forEach(summaries, (summary) => {
      const total = summary.hits + summary.misses
      const saved = total === 0 ? 0 : Math.round((summary.hits / total) * 100)
      return Console.log(
        `  ${summary.source}: ${summary.misses} requests spent, ${summary.hits} served from the store (${saved}% saved)`
      )
    })
  })).pipe(
    Command.provide(StoreLive),
    Command.withDescription("Show how much of the monthly request allowance has been used.")
  )
