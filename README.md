# music-app

A vibe-driven music recommendation engine. You describe the feeling you want — not a
genre or a seed artist — and it assembles a set that holds that feeling, explains why
each track is there, and orders them so the set flows.

Version zero is a CLI. The MCP surface, Spotify resolution and playback, hosting, async
ingestion and audio embeddings are all deliberately out of scope until the engine has
been shown to beat its own baseline.

## Current state

Milestones 1 and 2 are done. The store, the domain model and the FreqBlog adapter work
against the live API; the next piece of work is the evaluation harness, which has not
been started.

What runs today:

- A read-through catalogue: ask for a track, get it from Postgres if we already know it,
  otherwise fetch it from FreqBlog once and mirror it with its provenance.
- A typed FreqBlog adapter verified against API v1.5.0, with fixtures recorded from real
  responses.
- A seeded in-process mock, so development costs nothing against the monthly allowance.
- 59 tests across the adapter, the mock and the store.

There is no recommendation engine yet. That is milestone 4, and it is deliberately
blocked behind milestone 3.

## Setup

Requires Node ≥ 22.6, pnpm, and Docker.

```bash
pnpm install                 # also clones the Effect source into .repos/effect
cp env.example .env          # then fill in FREQBLOG_API_KEY, or set FREQBLOG_MODE=mock
docker compose up -d         # Postgres 18 + pgvector, published on 5433
pnpm cli db:migrate
```

Port **5433**, not 5432 — the container avoids colliding with a Homebrew Postgres.

Verify it works:

```bash
pnpm test                    # 59 tests; creates and migrates its own music_test database
pnpm typecheck
pnpm lint
```

`pnpm test` needs Docker but not an API key, and never touches the network.

## Commands

```bash
pnpm cli db:migrate                              # apply pending migrations
pnpm cli db:status                               # show the applied schema version
pnpm cli track:lookup "<artist>" "<title>"       # resolve a track, store-first
pnpm cli quota                                   # how much of the allowance is spent
```

### Working without the API

`FREQBLOG_MODE=mock` swaps the HTTP transport for a seeded catalogue of 24 synthetic
tracks. No key, no network, no quota:

```bash
FREQBLOG_MODE=mock pnpm cli track:lookup "Ivory Circuit" "Fractal Bloom"
```

It is a fake _server_, not a fake adapter — the real client, its decoding, its error
mapping and its retry policy all run unchanged on top of it. A stub that replaced the
adapter would bypass the code most likely to be wrong.

Every name in the mock catalogue is invented, so a mock number can never be mistaken for
a measurement. Real evaluation seeds must come from the live API.

`FREQBLOG_MOCK_QUOTA=<n>` makes the mock return 429 after `n` requests, so the
quota-exhaustion path can be exercised on demand.

### Exit codes

Failures that are answers rather than malfunctions print a plain message and no stack
trace. Only a genuine fault gets a trace, because that is the only time one helps.

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | resolved                                                            |
| 1    | something is actually wrong — transport fault, undecodable response |
| 2    | no track available                                                  |
| 3    | no track _yet_ — retry shortly                                      |
| 4    | the key or the allowance needs attention                            |

## Layout

```
src/
  domain/          identity, provenance and the recording model — no vendor vocabulary
  sources/freqblog/ the adapter; the only place that knows FreqBlog's field names
    mock/          seeded catalogue and fake server behind FREQBLOG_MODE
  store/           repositories, the read-through catalogue, migrations
  cli/             commands and layer wiring
```

Repository conventions — Effect usage, formatting, and the structural rules the product
depends on — live in [AGENTS.md](AGENTS.md).

## What FreqBlog actually gives us

These shaped the design and are easy to get wrong:

- **`/similar` and `/recommendations` return identity only.** No BPM, key or energy. Any
  acoustic constraint costs one `/lookup` per candidate, which makes candidate hydration
  the dominant quota cost rather than a free step.
- **A vendor id is not a lookup key.** `/lookup` accepts a name, ISRC, MBID or Spotify id
  — never the `itunes_track_id` that `/similar` hands back. Candidates are re-identified
  by name or ISRC.
- **First lookups return preview features.** An uncatalogued track answers from a fast
  preview analysis with a real one queued, so the numbers can change. Stored as
  `feature.quality`; provisional values must never be folded into a baseline unnoticed.
- **Genres are not normalised.** One response returned both `electronic` and
  `elektronisch`.
- **Quota is the binding constraint.** The free tier is 1,000 requests/month. `/bulk`
  batches 50 per call but is charged per item — it saves round trips, not quota.

Vocal-versus-instrumental detection comes from [LRCLIB](https://lrclib.net), which is
free and returns an explicit `instrumental` flag. FreqBlog's own lyrics endpoint serves
the same LRCLIB data but costs a request, and its `instrumentalness` field is flagged
unreliable by its own operator.

## Milestones

| # | Milestone                                                        | Status       |
| - | ---------------------------------------------------------------- | ------------ |
| 1 | Scaffold — Effect v4, Postgres + pgvector, migrations            | done         |
| 2 | Store and FreqBlog adapter                                       | done         |
| 3 | **Evaluation harness, and a baseline with no engine at all**     | next         |
| 4 | Engine — VibeSpec, fan-out, rank fusion, constraints, sequencing | blocked on 3 |
| 5 | Re-score engine against baseline — the go/no-go gate for v0      | blocked on 4 |

The ordering is the point. The harness comes **before** the engine so that the engine can
be measured against a number that already exists, rather than one invented to flatter it.
Milestone 3 produces 30–50 seeds with written expectations, blind scoring, and a baseline
score for raw upstream recommendations with no engine involved. Milestone 5 re-scores the
engine on the same seeds and decides whether it earned its complexity.

After v0, in order: the MCP surface (`McpServer.layerStdio` → `layerHttp` is a layer
swap), Spotify resolution and playback, then hosting.

## Open questions

- **FreqBlog has not been asked for permission to mirror their responses.** The store, the
  quota economics and the offline-forever guarantee all assume we may. This is the one
  that decides whether the current design survives.
- **`pnpm cli quota` conflates mock and live traffic.** `ResolutionLog` stamps
  `source: "freqblog"` regardless of mode, so the harness will inflate the number meant to
  protect the real allowance. Worth fixing before milestone 3 starts spending seeds.
