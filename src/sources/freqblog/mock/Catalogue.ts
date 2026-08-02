/**
 * A synthetic FreqBlog catalogue for local development and tests.
 *
 * Every artist and title here is invented. That is deliberate: these feature values are
 * made up, and if the names looked real someone would eventually mistake a mock number
 * for a measurement and fold it into an evaluation baseline. Real seeds for the eval
 * harness must come from the live API.
 *
 * The set is small but spread on purpose — 54 to 174 bpm, ten genres, both modes,
 * several same-artist pairs so `exclude_same_artist` has something to exclude, and one
 * deliberately unnormalised genre (`elektronisch`) because the live API returns those.
 */

/** The twelve semitones, as FreqBlog names them. */
const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

/** Camelot wheel position by pitch class, for major (`B`) and minor (`A`) keys. */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]

/**
 * The fixed field order of the 18-dimensional embedding.
 *
 * Matches the width of the `feature.embedding` column. The order is part of the
 * contract: position `n` means the same thing for every track.
 */
export const EMBEDDING_FIELDS = [
  "bpm",
  "energy",
  "valence",
  "danceability",
  "acousticness",
  "loudness_db",
  "mode",
  "key_int",
  "time_signature",
  "onset_rate",
  "dynamic_complexity",
  "average_loudness",
  "mood_happy",
  "mood_sad",
  "mood_aggressive",
  "mood_relaxed",
  "mood_party",
  "instrumentalness"
] as const

export interface SeedTrack {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly year: number
  readonly durationMs: number
  readonly bpm: number
  /** Pitch class, 0 = C. */
  readonly keyInt: number
  /** 1 = major, 0 = minor. */
  readonly mode: 0 | 1
  readonly energy: number
  readonly valence: number
  readonly danceability: number
  readonly acousticness: number
  readonly instrumentalness: number
  readonly loudnessDb: number
  readonly mood: string
  readonly genre: string
  /**
   * Tracks the mock reports as still being analysed, so the provisional path is
   * reachable without waiting on a real backfill.
   */
  readonly provisional?: boolean
}

const seeds: ReadonlyArray<SeedTrack> = [
  {
    id: "900000001",
    title: "Tidal Drift",
    artist: "Neon Cartography",
    album: "Slow Cartography",
    year: 2019,
    durationMs: 284000,
    bpm: 72,
    keyInt: 9,
    mode: 0,
    energy: 0.24,
    valence: 0.21,
    danceability: 0.32,
    acousticness: 0.71,
    instrumentalness: 0.94,
    loudnessDb: -19.4,
    mood: "calm",
    genre: "ambient"
  },
  {
    id: "900000002",
    title: "Copper Rain",
    artist: "Neon Cartography",
    album: "Slow Cartography",
    year: 2019,
    durationMs: 312000,
    bpm: 84,
    keyInt: 2,
    mode: 0,
    energy: 0.31,
    valence: 0.27,
    danceability: 0.38,
    acousticness: 0.64,
    instrumentalness: 0.91,
    loudnessDb: -17.8,
    mood: "melancholic",
    genre: "ambient"
  },
  {
    id: "900000003",
    title: "Signal Bloom",
    artist: "Neon Cartography",
    album: "Transit Fields",
    year: 2022,
    durationMs: 268000,
    bpm: 96,
    keyInt: 7,
    mode: 1,
    energy: 0.44,
    valence: 0.41,
    danceability: 0.51,
    acousticness: 0.48,
    instrumentalness: 0.88,
    loudnessDb: -14.2,
    mood: "neutral",
    genre: "electronic",
    provisional: true
  },
  {
    id: "900000004",
    title: "Undertow",
    artist: "Vela Sound",
    album: "Depth Marker",
    year: 2021,
    durationMs: 401000,
    bpm: 60,
    keyInt: 4,
    mode: 0,
    energy: 0.18,
    valence: 0.16,
    danceability: 0.24,
    acousticness: 0.82,
    instrumentalness: 0.96,
    loudnessDb: -22.1,
    mood: "calm",
    genre: "ambient"
  },
  {
    id: "900000005",
    title: "Ironbark",
    artist: "Marrowfield",
    album: "Heartwood",
    year: 2018,
    durationMs: 226000,
    bpm: 128,
    keyInt: 4,
    mode: 0,
    energy: 0.86,
    valence: 0.44,
    danceability: 0.52,
    acousticness: 0.08,
    instrumentalness: 0.04,
    loudnessDb: -6.1,
    mood: "energetic",
    genre: "rock"
  },
  {
    id: "900000006",
    title: "Slow Collapse",
    artist: "Marrowfield",
    album: "Heartwood",
    year: 2018,
    durationMs: 254000,
    bpm: 92,
    keyInt: 9,
    mode: 0,
    energy: 0.62,
    valence: 0.28,
    danceability: 0.41,
    acousticness: 0.19,
    instrumentalness: 0.07,
    loudnessDb: -8.4,
    mood: "tense",
    genre: "rock"
  },
  {
    id: "900000007",
    title: "Paper Anniversary",
    artist: "The Quiet Ledger",
    album: "Small Rooms",
    year: 2020,
    durationMs: 198000,
    bpm: 104,
    keyInt: 0,
    mode: 1,
    energy: 0.39,
    valence: 0.58,
    danceability: 0.49,
    acousticness: 0.77,
    instrumentalness: 0.02,
    loudnessDb: -11.9,
    mood: "happy",
    genre: "folk"
  },
  {
    id: "900000008",
    title: "Nightshift Boulevard",
    artist: "Halcyon Freight",
    album: "Terminal Hours",
    year: 2023,
    durationMs: 348000,
    bpm: 124,
    keyInt: 10,
    mode: 0,
    energy: 0.74,
    valence: 0.52,
    danceability: 0.86,
    acousticness: 0.04,
    instrumentalness: 0.72,
    loudnessDb: -7.2,
    mood: "party",
    genre: "house"
  },
  {
    id: "900000009",
    title: "Afterglow Terminal",
    artist: "Halcyon Freight",
    album: "Terminal Hours",
    year: 2023,
    durationMs: 366000,
    bpm: 126,
    keyInt: 5,
    mode: 0,
    energy: 0.71,
    valence: 0.47,
    danceability: 0.84,
    acousticness: 0.06,
    instrumentalness: 0.79,
    loudnessDb: -7.6,
    mood: "energetic",
    genre: "house"
  },
  {
    id: "900000010",
    title: "Concrete Sermon",
    artist: "Dust Parade",
    album: "Civic Weather",
    year: 2021,
    durationMs: 212000,
    bpm: 88,
    keyInt: 2,
    mode: 0,
    energy: 0.68,
    valence: 0.34,
    danceability: 0.79,
    acousticness: 0.12,
    instrumentalness: 0.01,
    loudnessDb: -6.8,
    mood: "tense",
    genre: "hip-hop"
  },
  {
    id: "900000011",
    title: "Lowlight",
    artist: "Dust Parade",
    album: "Civic Weather",
    year: 2021,
    durationMs: 189000,
    bpm: 92,
    keyInt: 7,
    mode: 0,
    energy: 0.57,
    valence: 0.29,
    danceability: 0.74,
    acousticness: 0.21,
    instrumentalness: 0.02,
    loudnessDb: -8.1,
    mood: "melancholic",
    genre: "hip-hop"
  },
  {
    id: "900000012",
    title: "Fractal Bloom",
    artist: "Ivory Circuit",
    album: "Lattice",
    year: 2022,
    durationMs: 298000,
    bpm: 174,
    keyInt: 11,
    mode: 0,
    energy: 0.93,
    valence: 0.48,
    danceability: 0.71,
    acousticness: 0.02,
    instrumentalness: 0.85,
    loudnessDb: -5.4,
    mood: "aggressive",
    genre: "drum-and-bass"
  },
  {
    id: "900000013",
    title: "Undertow Protocol",
    artist: "Ivory Circuit",
    album: "Lattice",
    year: 2022,
    durationMs: 286000,
    bpm: 172,
    keyInt: 6,
    mode: 0,
    energy: 0.89,
    valence: 0.36,
    danceability: 0.68,
    acousticness: 0.03,
    instrumentalness: 0.91,
    loudnessDb: -5.9,
    mood: "aggressive",
    genre: "drum-and-bass"
  },
  {
    id: "900000014",
    title: "Tangerine Static",
    artist: "Saffron Mile",
    album: "Bright Alarm",
    year: 2024,
    durationMs: 187000,
    bpm: 118,
    keyInt: 8,
    mode: 1,
    energy: 0.79,
    valence: 0.81,
    danceability: 0.77,
    acousticness: 0.14,
    instrumentalness: 0.01,
    loudnessDb: -5.2,
    mood: "happy",
    genre: "pop"
  },
  {
    id: "900000015",
    title: "Ceiling Fan Summer",
    artist: "Saffron Mile",
    album: "Bright Alarm",
    year: 2024,
    durationMs: 201000,
    bpm: 112,
    keyInt: 0,
    mode: 1,
    energy: 0.66,
    valence: 0.74,
    danceability: 0.72,
    acousticness: 0.28,
    instrumentalness: 0.02,
    loudnessDb: -6.4,
    mood: "happy",
    genre: "pop"
  },
  {
    id: "900000016",
    title: "Kettle Street Blues",
    artist: "Blue Meridian Trio",
    album: "After Hours Ledger",
    year: 2017,
    durationMs: 372000,
    bpm: 96,
    keyInt: 5,
    mode: 1,
    energy: 0.42,
    valence: 0.56,
    danceability: 0.58,
    acousticness: 0.68,
    instrumentalness: 0.83,
    loudnessDb: -13.1,
    mood: "neutral",
    genre: "jazz"
  },
  {
    id: "900000017",
    title: "Midnight Ledger",
    artist: "Blue Meridian Trio",
    album: "After Hours Ledger",
    year: 2017,
    durationMs: 419000,
    bpm: 76,
    keyInt: 10,
    mode: 0,
    energy: 0.29,
    valence: 0.33,
    danceability: 0.44,
    acousticness: 0.79,
    instrumentalness: 0.89,
    loudnessDb: -15.8,
    mood: "melancholic",
    genre: "jazz"
  },
  {
    id: "900000018",
    title: "Nocturne in Ash",
    artist: "Aurelia Vance",
    album: "Empty Rooms",
    year: 2016,
    durationMs: 336000,
    bpm: 62,
    keyInt: 3,
    mode: 0,
    energy: 0.16,
    valence: 0.19,
    danceability: 0.21,
    acousticness: 0.94,
    instrumentalness: 0.97,
    loudnessDb: -21.7,
    mood: "sad",
    genre: "classical"
  },
  {
    id: "900000019",
    title: "Study for Empty Rooms",
    artist: "Aurelia Vance",
    album: "Empty Rooms",
    year: 2016,
    durationMs: 291000,
    bpm: 54,
    keyInt: 8,
    mode: 1,
    energy: 0.13,
    valence: 0.31,
    danceability: 0.18,
    acousticness: 0.96,
    instrumentalness: 0.98,
    loudnessDb: -23.2,
    mood: "calm",
    genre: "classical"
  },
  {
    id: "900000020",
    title: "Rust Chorus",
    artist: "Tin Cathedral",
    album: "Long Decay",
    year: 2020,
    durationMs: 447000,
    bpm: 136,
    keyInt: 1,
    mode: 0,
    energy: 0.81,
    valence: 0.31,
    danceability: 0.46,
    acousticness: 0.11,
    instrumentalness: 0.76,
    loudnessDb: -7.9,
    mood: "tense",
    genre: "post-rock"
  },
  {
    id: "900000021",
    title: "Elektrischer Traum",
    artist: "Static Meridian",
    album: "Nachtbild",
    year: 2023,
    durationMs: 322000,
    bpm: 122,
    keyInt: 11,
    mode: 0,
    energy: 0.69,
    valence: 0.42,
    danceability: 0.81,
    acousticness: 0.07,
    instrumentalness: 0.74,
    loudnessDb: -8.3,
    mood: "neutral",
    // The live API does not normalise genre; this is the shape that quirk takes.
    genre: "elektronisch"
  },
  {
    id: "900000022",
    title: "Deep Field",
    artist: "Cobalt Yield",
    album: "Parallax",
    year: 2022,
    durationMs: 389000,
    bpm: 132,
    keyInt: 9,
    mode: 0,
    energy: 0.83,
    valence: 0.38,
    danceability: 0.82,
    acousticness: 0.03,
    instrumentalness: 0.88,
    loudnessDb: -6.7,
    mood: "energetic",
    genre: "techno"
  },
  {
    id: "900000023",
    title: "Parallax Drive",
    artist: "Cobalt Yield",
    album: "Parallax",
    year: 2022,
    durationMs: 412000,
    bpm: 138,
    keyInt: 2,
    mode: 0,
    energy: 0.88,
    valence: 0.35,
    danceability: 0.85,
    acousticness: 0.02,
    instrumentalness: 0.92,
    loudnessDb: -6.2,
    mood: "aggressive",
    genre: "techno"
  },
  {
    id: "900000024",
    title: "Harvest Light",
    artist: "Wren & Alder",
    album: "Field Notes",
    year: 2019,
    durationMs: 233000,
    bpm: 100,
    keyInt: 7,
    mode: 1,
    energy: 0.44,
    valence: 0.64,
    danceability: 0.53,
    acousticness: 0.84,
    instrumentalness: 0.06,
    loudnessDb: -12.3,
    mood: "happy",
    genre: "folk"
  }
]

/** Genres the upstream treats as one family. Mirrors its `cross_genre` grouping. */
const GENRE_FAMILIES: ReadonlyArray<ReadonlyArray<string>> = [
  ["ambient", "classical"],
  ["electronic", "elektronisch", "house", "techno", "drum-and-bass"],
  ["rock", "post-rock"],
  ["hip-hop"],
  ["pop", "folk"],
  ["jazz"]
]

export const familyOf = (genre: string) => GENRE_FAMILIES.find((family) => family.includes(genre)) ?? [genre]

/** `same`, `adjacent` or `cross`, as the live API labels a candidate's genre. */
export const genreRelation = (seedGenre: string, candidateGenre: string) => {
  if (seedGenre === candidateGenre) return "same"
  return familyOf(seedGenre).includes(candidateGenre) ? "adjacent" : "cross"
}

const camelotOf = (track: SeedTrack) =>
  `${(track.mode === 1 ? CAMELOT_MAJOR : CAMELOT_MINOR)[track.keyInt]}${track.mode === 1 ? "B" : "A"}`

const keyNameOf = (track: SeedTrack) => `${KEY_NAMES[track.keyInt]}-${track.mode === 1 ? "Major" : "Minor"}`

/** Deterministic synthetic identifiers, so fixtures and logs stay stable across runs. */
const isrcOf = (track: SeedTrack) => `XXMCK${String(track.year).slice(2)}${track.id.slice(-5)}`

const mbidOf = (track: SeedTrack) => {
  const digits = track.id.slice(-8)
  return `${digits}-0000-4000-8000-${digits}0000`
}

/**
 * Moods as a five-axis vector, derived from valence and energy the way the upstream
 * describes deriving its own. Not a real classifier — a plausible one.
 */
const moodVector = (track: SeedTrack) => ({
  happy: Number((track.valence * (0.5 + track.energy / 2)).toFixed(4)),
  sad: Number(((1 - track.valence) * (1 - track.energy / 2)).toFixed(4)),
  aggressive: Number((track.energy * (1 - track.valence)).toFixed(4)),
  relaxed: Number(((1 - track.energy) * (0.4 + track.valence / 2)).toFixed(4)),
  party: Number((track.danceability * track.energy).toFixed(4))
})

/** The 18 values, in `EMBEDDING_FIELDS` order, each scaled to roughly [0, 1]. */
export const embeddingOf = (track: SeedTrack): ReadonlyArray<number> => {
  const moods = moodVector(track)
  return [
    track.bpm / 200,
    track.energy,
    track.valence,
    track.danceability,
    track.acousticness,
    (track.loudnessDb + 60) / 60,
    track.mode,
    track.keyInt / 11,
    1,
    track.bpm / 400,
    (1 - track.energy) * 5 / 10,
    (track.loudnessDb + 60) / 60,
    moods.happy,
    moods.sad,
    moods.aggressive,
    moods.relaxed,
    moods.party,
    track.instrumentalness
  ].map((value) => Number(value.toFixed(6)))
}

/**
 * Which embedding positions count as measured.
 *
 * `time_signature` is constant across the whole seed set, so it carries no information
 * and is masked out — the same reason the live API masks filler positions.
 */
export const embeddingMaskOf = (_track: SeedTrack): ReadonlyArray<boolean> =>
  EMBEDDING_FIELDS.map((field) => field !== "time_signature")

/** The full `/lookup` wire body for a seed track. */
export const lookupBody = (track: SeedTrack) => ({
  track_name: track.title,
  artist_name: track.artist,
  album_name: track.album,
  itunes_track_id: track.id,
  isrc: isrcOf(track),
  mbid: mbidOf(track),
  is_remix: false,
  remixer: null,
  mix_name: null,
  remix_of_isrc: null,
  release_date: `${track.year}-06-15`,
  duration_ms: track.durationMs,
  explicit: false,
  bpm: track.bpm,
  bpm_alt: null,
  bpm_confidence: 0.92,
  key: keyNameOf(track),
  key_confidence: 0.81,
  mode: track.mode,
  key_int: track.keyInt,
  camelot: camelotOf(track),
  open_key: null,
  energy: track.energy,
  loudness_db: track.loudnessDb,
  danceability: track.danceability,
  valence: track.valence,
  speechiness: 0.05,
  instrumentalness: track.instrumentalness,
  liveness: 0.12,
  acousticness: track.acousticness,
  time_signature: 4,
  mood: track.mood,
  mood_vector: moodVector(track),
  onset_rate: Number((track.bpm / 20).toFixed(4)),
  dynamic_complexity: Number(((1 - track.energy) * 6).toFixed(4)),
  tuning_frequency: 440,
  average_loudness: Number(((track.loudnessDb + 60) / 60).toFixed(4)),
  genre: track.genre,
  extended: { gender: null, timbre: null, tonal_atonal: null },
  feature_source: track.provisional === true ? "essentia_preview" : "essentia",
  backfill_status: track.provisional === true ? "queued" : "complete",
  backfill_notification_id: track.provisional === true ? `backfill_${track.id}_1` : null,
  bpm_snapped: Math.round(track.bpm)
})

/** The identity-only `TrackStub` the ranked endpoints return. */
export const stubBody = (track: SeedTrack) => ({
  itunes_track_id: track.id,
  track_name: track.title,
  artist_name: track.artist,
  album_name: track.album,
  popularity: 40 + (track.bpm % 50),
  mbid: mbidOf(track),
  isrc: isrcOf(track),
  genre: track.genre,
  release_date: `${track.year}-06-15`,
  duration_ms: track.durationMs,
  explicit: false
})

export const catalogue = seeds

const normalise = (value: string) => value.trim().toLowerCase()

export const findById = (id: string) => catalogue.find((track) => track.id === id)

export const findByIsrc = (isrc: string) => catalogue.find((track) => normalise(isrcOf(track)) === normalise(isrc))

export const findByMbid = (mbid: string) => catalogue.find((track) => normalise(mbidOf(track)) === normalise(mbid))

/**
 * Name matching is loose on purpose: the live catalogue resolves near-misses, and a mock
 * that only accepted exact strings would make callers look correct when they are not.
 */
export const findByName = (title: string, artist?: string) => {
  const wantedTitle = normalise(title)
  const wantedArtist = artist === undefined ? undefined : normalise(artist)
  return catalogue.find((track) => {
    if (normalise(track.title) !== wantedTitle) return false
    return wantedArtist === undefined || normalise(track.artist) === wantedArtist
  })
}
