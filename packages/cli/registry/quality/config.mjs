/**
 * OWNED FILE — repo-harness scaffolds this once; edit freely. Tune the thresholds
 * to your repo. The analyzer engine (index.mjs/analyze.mjs) is managed by
 * repo-harness and updated via `npx repo-harness update`.
 */

/**
 * Code-health analyzer configuration — every threshold and penalty lives here so
 * the score is transparent and tunable. Each penalty maps to a named, fixable
 * finding (see analyze.mjs). Replaces the opaque escomplex Maintainability Index
 * (which is per-method-averaged, normalized, and ships a coefficient bug) with a
 * "start at 100, subtract for concrete violations" model.
 */

/**
 * Tiered thresholds: the first entry whose `over` is exceeded (largest-first)
 * decides the penalty. `points` is subtracted from the file's score.
 */
export const config = {
  /** Cyclomatic complexity per function (decision points + 1). */
  cyclomatic: [
    { over: 40, points: 10, severity: 'extreme' },
    { over: 20, points: 6, severity: 'high' },
    { over: 10, points: 3, severity: 'elevated' },
  ],
  /** Function length in physical (non-blank) lines. */
  functionLoc: [
    { over: 200, points: 8, severity: 'extreme' },
    { over: 100, points: 4, severity: 'high' },
    { over: 50, points: 2, severity: 'elevated' },
  ],
  /** Max control-flow nesting depth inside a function. */
  nesting: [
    { over: 6, points: 6, severity: 'extreme' },
    { over: 5, points: 4, severity: 'high' },
    { over: 4, points: 2, severity: 'elevated' },
  ],
  /** Parameter count per function. */
  params: [
    { over: 6, points: 3, severity: 'high' },
    { over: 4, points: 1, severity: 'elevated' },
  ],
  /** File length in physical (non-blank) lines. */
  fileLoc: [
    { over: 800, points: 12, severity: 'extreme' },
    { over: 500, points: 6, severity: 'high' },
    { over: 300, points: 3, severity: 'elevated' },
  ],
  /** Duplication: `points` per `perLines` duplicated lines in the file, capped. */
  duplication: { perLines: 20, points: 1, cap: 10 },

  /** Score bands for the report label (mirrors the old 65/85 convention). */
  bands: { good: 85, moderate: 65 },

  /** Files to analyze / skip (matched against the src-relative POSIX path). */
  include: /\.(ts|tsx)$/,
  exclude: /(\.test\.|\.spec\.|\.d\.ts$)/,
};
