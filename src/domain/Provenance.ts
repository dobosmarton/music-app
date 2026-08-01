import { Schema } from "effect"

/**
 * Where a stored fact came from.
 *
 * Every derived row carries one of these. It is the entire insurance premium against
 * an upstream disappearing or turning out to be wrong: with provenance you can drop a
 * source's rows and refill them; without it you would have to rebuild the store.
 *
 * `self` means we computed it — reserved for the day we analyse audio ourselves.
 */
export const Source = Schema.Literals(["freqblog", "musixmatch", "lrclib", "self"])
export type Source = typeof Source.Type
