/**
 * What a failed run reports to whoever invoked it.
 *
 * Several of this application's failures are answers rather than malfunctions — the
 * catalogue genuinely does not have a track, or the allowance is genuinely spent. Those
 * carry `Runtime.errorReported = false`, so the runtime prints no stack trace over a
 * normal outcome, and one of these codes, so a caller can still tell what happened
 * without parsing prose.
 *
 * Errors that carry none of these keep the default `1`, which is the honest answer for
 * "something is actually wrong": a transport fault or a response we could not decode.
 */

/** Asked and answered: the track is not available. */
export const NO_TRACK = 2

/** Not available yet. The same request should succeed shortly. */
export const RETRY_SHORTLY = 3

/** The key or the monthly allowance needs attention before anything will work. */
export const NEEDS_ATTENTION = 4
