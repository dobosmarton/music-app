import { Effect, Option } from "effect"
import type { TrackQuery } from "../domain/Identity.ts"
import { KnownRecording } from "../domain/Recording.ts"
import { FreqBlog } from "../sources/freqblog/Client.ts"
import { FeatureRepo } from "./FeatureRepo.ts"
import { RecordingRepo } from "./RecordingRepo.ts"
import { Attempt, ResolutionLog } from "./ResolutionLog.ts"

const FREQBLOG: "freqblog" = "freqblog"

/** Whether an answer came from our own store or cost a request. */
export type Origin = "store" | "upstream"

export interface Resolution {
  readonly known: KnownRecording
  readonly origin: Origin
}

/**
 * Resolve a track, preferring what we already know.
 *
 * This is the read-through: the store is consulted first, the upstream only on a miss,
 * and whatever the upstream returns is mirrored back with its provenance stamped so
 * the next request costs nothing. Every outcome is logged either way, because the
 * hit rate is the number that decides whether the monthly allowance lasts.
 *
 * The mirror is also the insurance policy — if the upstream disappears, what it has
 * already told us stays ours.
 */
export const resolveRecording = Effect.fn("Catalog.resolveRecording")(
  function*(query: TrackQuery) {
    const recordings = yield* RecordingRepo
    const features = yield* FeatureRepo
    const log = yield* ResolutionLog
    const freqblog = yield* FreqBlog

    const stored = yield* recordings.findByQuery(query)
    if (Option.isSome(stored)) {
      yield* log.record(
        new Attempt({ source: FREQBLOG, endpoint: "/lookup", cacheHit: true })
      )
      return {
        known: new KnownRecording({
          recording: stored.value,
          features: yield* features.findByRecording(stored.value.id)
        }),
        origin: "store"
      }
    }

    const facts = yield* freqblog.lookup(query)
    yield* log.record(
      new Attempt({ source: FREQBLOG, endpoint: "/lookup", cacheHit: false })
    )

    const recordingId = yield* recordings.upsert(facts)
    yield* features.upsert({ recordingId, source: FREQBLOG, values: facts.features })

    const recording = yield* recordings.findById(recordingId)
    if (Option.isNone(recording)) {
      return yield* Effect.die(
        `recording ${recordingId} vanished immediately after being written`
      )
    }

    return {
      known: new KnownRecording({
        recording: recording.value,
        features: yield* features.findByRecording(recordingId)
      }),
      origin: "upstream"
    }
  }
)
