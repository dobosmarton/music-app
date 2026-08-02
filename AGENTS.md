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

## Formatting and linting

`pnpm format` (dprint) and `pnpm lint` (oxlint type-aware, then a dprint check). The dprint
config is Effect's own, so our code and the vendored source we read are formatted alike.

oxlint rather than ESLint for a specific reason: we are pinned to TypeScript 7, and
typescript-eslint does not support it — running it would mean installing TypeScript 6
alongside, purely for the linter. oxlint's type-aware engine targets TS 7 directly.

Three rules are switched off in `.oxlintrc.json`, all because they fight Effect's idioms
rather than because they found something we did not want to fix:

- `no-underscore-dangle` — `_tag` is Effect's tagged-union convention, used everywhere.
- `no-shadow` — `layer(...)((it) => ...)` deliberately shadows `it`; that is the documented
  `@effect/vitest` pattern.
- `consistent-return` — our exhaustive `switch` over a tagged union returns in every case;
  TypeScript proves that, and the rule cannot see it.

`.repos`, `.agents` and `.claude` are excluded from both tools. They hold vendored,
third-party content — the skill files are pinned by hash in `skills-lock.json`, so
reformatting them would break that.

## Running against the mock

`FREQBLOG_MODE=mock` swaps the HTTP transport for a seeded in-process catalogue of 24
synthetic tracks — no key, no quota, no network. Use it for local development and for
anything that would otherwise spend the 1,000-request monthly allowance.

It is deliberately an `HttpClient` layer, not a fake `FreqBlog` service. A stubbed
service would bypass the decoding, the status-to-error mapping and the retry policy —
exactly the code most likely to be wrong — so the real adapter runs unchanged on top of
a fake server instead, and the mock cannot drift from the wire contract without
`mock/Server.test.ts` failing.

Every name in `mock/Catalogue.ts` is invented, so a mock number can never be mistaken for
a measurement. Real evaluation seeds must come from the live API.

`FREQBLOG_MOCK_QUOTA=<n>` makes the mock return 429 after `n` requests, so the
`QuotaExceeded` path can be exercised without waiting for a real allowance to run out.

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
- **A candidate is not a track.** FreqBlog's `/similar` and `/recommendations` return
  identity only — no BPM, key or energy. They decode to `TrackCandidate`, never
  `TrackFacts`, so nothing downstream can assume features it was never given.
- **A vendor id is not a lookup key.** `/lookup` accepts a name, ISRC, MBID or Spotify
  id; there is no parameter for the `itunes_track_id` that `/similar` hands back, and
  `/v1/audio-features/{identifier}` takes only Spotify ids and ISRCs. Hydration goes by
  ISRC or by name. `UpstreamQuery` excludes `ByExternalRef` for this reason.
- **Features carry a `quality`.** A first lookup of an uncatalogued track answers from
  `essentia_preview` with a backfill queued, and those numbers change. `provisional`
  values must never be silently folded into an evaluation baseline.
