/**
 * The loop's dimensions and timings.
 *
 * Every number that decides *when* or *how big* lives here rather than in the
 * engine, because the engine is a reader of tables: the glide is a lookup, the
 * blur is a lookup, the stroke flight is a keyframe list. Tuning the animation
 * means editing this file and `strokes.ts`, not the drawing code.
 */

/** Ticks in one seamless cycle. The last two are deliberately blank paper. */
export const TICKS = 51;

/**
 * The tick rate, and the only knob that changes the loop's duration.
 *
 * 51 ticks at 22fps is 2.3 seconds — slow enough to read the sentence and
 * watch the burst, short enough that nobody waits for it. Lowering this
 * stretches the whole choreography uniformly, which is what "slower" should
 * mean; the arrival, tint, shake and burst ticks are positions in the cycle,
 * not wall-clock times, so none of them need touching.
 *
 * Two things downstream are ordered against it and must stay that way: the
 * component's hard stop is derived from this, and the CSS failsafe in
 * `globals.css` sits above both. Cutting the rate much further without raising
 * that failsafe would have CSS pull the overlay while the burst is still in
 * flight.
 */
export const FPS = 22;

export const PAPER = "#fdfdfd";

export const INK = "#1b1b1b";

/**
 * The dark-mode counterpart.
 *
 * The landing page follows the system theme, and a full-viewport white flash on
 * a dark page is the single most jarring thing a preloader can do. The strokes
 * keep their hues either way — they sit near L=0.7, which reads on both — so
 * only the paper and the ink swap.
 */
export const PAPER_DARK = "#0e0e0e";
export const INK_DARK = "#ededed";

export interface Theme {
  inks: string[];
  body: string;
  burst: string;
}

export interface SentenceSpec {
  words: string[];

  burst: number;
  theme: Theme;
}

/**
 * What the loop says, and the colours it says it in.
 *
 * One sentence per visit. Each is five words with the burst on a short middle
 * one — the burst word is rasterised and sliced per letter, so an eight-letter
 * word is twice the ribbons for the same eight ticks, and the composition is
 * built around the explosion happening near the centre of the line.
 *
 * The palettes are the landing page's own tile swatches (`word-tiles.tsx`), so
 * the preloader hands off to a hero it already matches rather than arriving
 * from a different design. `burst` is shown at full strength on paper, so the
 * pale swatches are never used for it; `body` is mixed 45% into the ink and
 * can be anything.
 */
export const SENTENCES: SentenceSpec[] = [
  /* The site's own thesis. It fades straight into the hero that says the same
     five words in tiles — the preloader finishes the sentence the page opens
     with. `identity` is the one long burst word here, and it earns it. */
  {
    words: ["ens", "is", "the", "identity", "layer"],
    burst: 3,
    theme: {
      inks: ["#18b6ff", "#7c4dff", "#22e58b", "#ffe14d"],
      body: "#7c4dff",
      burst: "#18b6ff",
    },
  },

  /* The ENS claim: a name is evidence about an agent, checked at runtime in
     both directions, not a label anyone can assert. */
  {
    words: ["the", "name", "proves", "the", "agent"],
    burst: 2,
    theme: {
      inks: ["#ff7a1a", "#ffe14d", "#ff2e20", "#ff4fa3"],
      body: "#ff2e20",
      burst: "#ff7a1a",
    },
  },

  /* The permission model: one record key, granted at the resource, not the
     name. The resolver reverts on everything else. */
  {
    words: ["grant", "one", "record", "not", "everything"],
    burst: 2,
    theme: {
      inks: ["#7c4dff", "#18b6ff", "#ff4fa3", "#22e58b"],
      body: "#7c4dff",
      burst: "#ff4fa3",
    },
  },

  /* Privy: the agent's signer is capped by a policy it cannot change, and the
     denial is the proof rather than the error. */
  {
    words: ["one", "wallet", "capped", "by", "policy"],
    burst: 2,
    theme: {
      inks: ["#22e58b", "#18b6ff", "#7c4dff", "#f0c2f7"],
      body: "#18b6ff",
      burst: "#22e58b",
    },
  },

  /* The Graph, and the rule the whole store obeys: every externally-derived
     value is read now and carries the time it was read. */
  {
    words: ["read", "it", "live", "not", "cached"],
    burst: 2,
    theme: {
      inks: ["#ff4fa3", "#ff7a1a", "#7c4dff", "#18b6ff"],
      body: "#ff4fa3",
      burst: "#ff7a1a",
    },
  },
];

export const BODY_TINT = 0.45;

export const ARRIVAL_STEP = 2;

export const FONT_FRAC = 0.122;

export const BASELINE_FRAC = 0.541;

export const GAP_EM = 0.17;

/**
 * The page's own typeface.
 *
 * Read through the CSS variable and resolved to a concrete family name before
 * the engine starts, because `measureText` needs a family it can actually load
 * — a canvas font string containing `var(...)` is invalid and silently falls
 * back, which shifts every slot in the layout.
 */
export const FONT_CSS = "var(--font-geist-sans)";
export const FONT_WEIGHT = 600;

/** The widest the line may run, as a fraction of the stage. */
export const LINE_FIT = 0.88;

export const ARRIVE_SCALE_FIRST = 2.0;
export const ARRIVE_SCALE_REST = 1.35;

export const SCALE_RETAIN = 0.62;

export const THUMP_EXCESS = 0.09;
export const THUMP_STRETCH = 1.045;
export const THUMP_SQUASH = 0.94;

export const SLIDE_EM = 1.0;

export const BLUR_MOST = [3, 1.6, 0.7, 0];
export const BLUR_LAST = [9, 7, 5, 3.2, 1.8, 0.8, 0];

/**
 * The line's glide, measured rather than modelled.
 *
 * Index is ticks since the second word arrived, value is the remaining offset
 * as a fraction of the opening one. A follower cannot produce this curve: it
 * misses the fast middle, and it cannot overshoot at all — the negative values
 * around index 8-12 are the line travelling ~10% past its final position and
 * easing back, which is the whole character of the movement.
 */
export const RECENTER = [
  0.91, 0.69, 0.36, 0.16, 0.052, -0.011, -0.052, -0.08, -0.092, -0.098,
  -0.103, -0.098, -0.092, -0.086, -0.075, -0.063, -0.052, -0.04, -0.029,
  -0.017, -0.011, -0.006, 0,
];

export const GLIDE_RATE = 1.35;

export const TINT_TICK = 18;
export const TINT_LEN = 6;

export const SHAKE_TICK = 24;
export const SHAKE_END = 37;

export const SHAKE_ROT = 13;
export const SHAKE_DY = 6;
export const SHAKE_DX = 2.5;

export const SHAKE_OMEGA = 1.15;

export const LETTER_DRIFT: [number, number, number][] = [
  [-1.5, 4, -9],
  [-0.5, 1.5, 6],
  [0.5, 4.5, -5],
  [2, 2.5, 11],
];

export const INHALE_TICKS = 3;
export const INHALE_LIFT = 4.5;
export const INHALE_SCALE = 0.055;

export const BURST_TICK = 38;
export const REF_BURST = 44;
export const STROKE_OFFSET = REF_BURST - BURST_TICK;

export const SEG_BANDS = 8;

export const SEG_MAX_PER_LETTER = 16;

export const SEG_MIN_RUN_EM = 0.05;

export const MORPH_LEN = 2.8;
export const MORPH_STAGGER = 0.9;

export const DART_SPIKE_MIN = 0.15;
export const DART_BELLY = 0.7;
export const DART_WOBBLE = 0.12;
export const FINALE_SPIKE = 0.8;

export const SEG_EXIT = 2;

export const SEG_GAP_MUL = 1.4;

export const SLOT_PROG_JIT = 0.06;

export const TRAIL_DT = 0.8;

export const TRAIL_ALPHA = 0.12;

export const RING_TICKS = 3;
export const RING_R0 = 14;
export const RING_V = 42;
export const RING_ALPHA = 0.35;
export const RING_WIDTH = 2.2;

export const ZOOM_MAX = 0.35;
export const ZOOM_EXP = 1.8;

export const THROW_PX = 17;
export const THROW_EXP = 2.5;
export const THROW_BALLISTIC = 1.9;
export const THROW_BALLISTIC_AT = BURST_TICK + 7;

export const WORD_FADE_START = BURST_TICK + 6.5;
export const WORD_FADE_END = BURST_TICK + 8;

export const STREAK_LEN = 90;
export const STREAK_ALPHA = 0.35;
export const STREAK_WIDTH = 1.6;

export const FLECK_COUNT = 14;
export const FLECK_SPD_MIN = 2.5;
export const FLECK_SPD_MAX = 5.5;
export const FLECK_R_MIN = 1.4;
export const FLECK_R_MAX = 3.2;
export const FLECK_DELAY_MAX = 1.5;
export const FLECK_FADE_START = BURST_TICK + 3;
export const FLECK_FADE_LEN = 3;

export const KICK_BASE: [number, number][] = [
  [2.2, -1.4],
  [-1.5, 0.9],
];
export const KICK_JIT = 1.2;
export const KICK_ZOOM = 1.012;

export const STILL_TICK = BURST_TICK + 3;

export const REF_W = 700;
export const REF_H = 392;

export const ORIGIN_X = 358;
export const ORIGIN_Y = 205;

export const SEED = 0x10cd;
