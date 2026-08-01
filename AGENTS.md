# Working in this repository

## Vendored source is read-only reference

`.repos/effect` is the Effect source, cloned locally so it can be read when an API needs
verifying. It is **gitignored** — three thousand files of someone else's source do not
belong in this repository's history. `pnpm install` fetches it via the `prepare` script,
or run `./scripts/prepare-effect.sh` directly.

- Read it to check signatures, behaviour and canonical patterns.
- **Never import from it.** Runtime code imports from `effect` and `@effect/*` in
  `node_modules`, always.
- Do not edit anything under `.repos/`. Update it with `git -C .repos/effect pull`.

## Effect conventions

- `effect` and every `@effect/*` package track the `beta` tag and must stay
  version-aligned. The lockfile pins the resolved build.
- Business logic that returns an `Effect` is written with `Effect.fn`, not bare
  `Effect.gen`, so it carries a span.
- No `any`, no `as` casts, no unsafe assertions. Values crossing a boundary are decoded
  with `Schema`.
- SQL goes through `SqlClient`; migrations go through `Migrator`. No raw driver calls in
  business code, no hand-rolled transactions.

## Structural rules for this project

These exist because the product depends on them, not as style preferences:

- **Every stored fact carries a `source`.** It is what lets an upstream be swapped
  without re-deriving the store.
- **Vendor identifiers live in `external_id`**, never on `recording`.
- **Upstream response shapes never escape `src/store`.** They are decoded into domain
  types at the boundary.
- **`instrumentalness` is not stored.** The upstream flags it unreliable; vocal
  detection comes from `lyric_signal` instead.
- **Nothing Spotify-derived may be persisted.** Resolve, use, discard.
