/**
 * The windows the range picker offers, derived from what the hub keeps.
 *
 * The hub answers at most `history_days`, and offering more than that would draw a
 * chart shorter than the one that was picked -- which reads as lost data rather than
 * as a limit. A hub that predates the field, or one that has not answered yet, keeps
 * the week this theme has always offered.
 *
 * Pure and separate from the components so it can be checked without a browser;
 * `src/lib/ranges.test.ts` does that.
 */

/** What a hub that does not say keeps, in days. */
export const FALLBACK_DAYS = 7

/** The widest a hub may be set to; see `MAX_RETENTION_DAYS` on the hub side. */
export const MAX_DAYS = 365

/** The ladder of windows, in hours: an hour, six, a day, a week, a month, a quarter, a year. */
export const LADDER = [1, 6, 24, 168, 720, 2_160, 8_760] as const

const LABELS: Record<number, string> = {
  1: "1 小时",
  6: "6 小时",
  24: "24 小时",
  168: "7 天",
  720: "30 天",
  2_160: "90 天",
  8_760: "365 天",
}

/** What the hub says it keeps, in days: its `history_days`, or the fallback. */
export function historyDays(config: unknown): number {
  const raw =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>).history_days
      : undefined
  const days = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
  if (!Number.isFinite(days) || days < 1) return FALLBACK_DAYS
  return Math.min(Math.floor(days), MAX_DAYS)
}

/** The windows to offer: every rung up to what the hub keeps, and never past it. */
export function rangesFor(days: number): { hours: number; label: string }[] {
  const hours = historyDays({ history_days: days }) * 24
  return LADDER.filter((h) => h <= hours).map((h) => ({ hours: h, label: LABELS[h] }))
}
