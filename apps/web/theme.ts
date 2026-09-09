/**
 * The Nymspace console theme.
 *
 * Derived from `theme.template.ts`, which stays in the tree as the annotated
 * reference for every `defineTheme` field. The template's header describes a
 * `scripts/check-theme-template.test.mjs` drift test — that test lives in the
 * Astryx repository, not this one, so nothing here enforces that the template
 * stays current with the installed version. `pnpm exec astryx theme template
 * --overwrite` is the manual refresh.
 *
 * What this theme is for: the console renders dense, externally-derived data —
 * addresses, transaction hashes, chain ids, read timestamps — in the visual
 * register of `mdx-graphs.kshv.me`. Mono, tabular figures, square corners,
 * hairline rules. Every trait a theme can carry is carried here rather than in
 * a screen, so no screen can choose a radius.
 *
 * See `openspec/changes/adopt-console-design-register/design.md`.
 */
import {defineTheme} from '@astryxdesign/core/theme';

export const nymspaceTheme = defineTheme({
  name: 'nymspace',

  /**
   * No `accent` seed: the default accent stays, and only the neutrals are
   * re-toned. Inventing a brand hue is a decision nobody has made.
   *
   * `contrast: 'high'` is the one deliberate change. Astryx documents it as
   * widening the text/surface tone gap "for dense data UI", which is what a
   * console of addresses and hashes is. Standard contrast is tuned for prose.
   */
  color: {neutralStyle: 'cool', contrast: 'high'},

  typography: {
    /**
     * 14/1.2 rather than the template's 16, matching the reference register's
     * 14/21. The ratio is unchanged; only the base moves, and every semantic
     * size token recomputes from it.
     */
    scale: {base: 14, ratio: 1.2},

    /**
     * `next/font/google` already loads both families in `app/layout.tsx` and
     * exposes them as CSS variables on <html>. Naming the family through those
     * variables is why this theme does not need its own <link> or @font-face:
     * Astryx never loads a font file, it only sets `--font-family-*`, so
     * pointing at an already-loaded variable is the only way to name a webfont
     * here without loading it twice.
     *
     * next/font writes its own fallback metrics into the variable, so the
     * `fallbacks` below are the second line of defence, not the first.
     */
    body: {
      family: 'var(--font-geist-sans)',
      fallbacks: '-apple-system, system-ui, sans-serif',
    },
    code: {
      family: 'var(--font-geist-mono)',
      fallbacks: '"SF Mono", ui-monospace, monospace',
    },
  },

  /**
   * `multiplier: 0` squares every radius step. The reference frame is drawn
   * with straight dashed rules and right-angle corner marks; a rounded control
   * inside a square frame reads as two systems on one page.
   */
  radius: {base: 4, multiplier: 0},

  /**
   * Theme-family-local roles for the frame chrome, per design.md Q3.
   *
   * These alias existing semantic tokens rather than carrying hex, so they
   * follow light and dark for free and stay inside the contrast guarantee the
   * generated ramp already provides. `--color-data-*` is deliberately not
   * touched: that is the categorical charting slot, and the console has no
   * series to put in it.
   */
  localTokens: {
    '--astryx-theme-nymspace-color-frame': 'var(--color-border)',
    '--astryx-theme-nymspace-color-muted': 'var(--color-text-secondary)',
    '--astryx-theme-nymspace-color-faint': 'var(--color-text-disabled)',
  },

  /**
   * Two traits of the register have no token: tabular figures and the
   * reference's +0.02em tracking. They belong to the components that render
   * data, not to any one screen, so they are set here.
   *
   * `font-variant-numeric: tabular-nums` is what makes a column of addresses
   * and timestamps align vertically. Without it a proportional `1` is narrower
   * than a `0` and every row sits at a slightly different offset, which is the
   * specific illegibility this register exists to fix.
   */
  components: {
    'table-cell': {
      base: {
        fontFamily: 'var(--font-family-code)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
      },
    },
    'table-header-cell': {
      base: {
        fontFamily: 'var(--font-family-code)',
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      },
    },
  },
});
