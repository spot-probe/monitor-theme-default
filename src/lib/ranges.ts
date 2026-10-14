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

/**
 * A window's label, in the unit the row is read in. The day rung says "1 天" rather
 * than "24 小时": from there on the ladder counts days, and one rung phrased in hours
 * beside the rest reads as a different kind of thing.
 */
function label(hours: number): string {
  if (hours < 24) return `${hours} 小时`
  if (hours === 8_760) return "1 年"
  return `${hours / 24} 天`
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

/**
 * The windows to offer: every round rung within what the hub keeps, plus the whole of
 * it.
 *
 * The whole of it is a rung of its own, or a hub keeping 92 days could not reach past
 * 90 at all -- the widest window it holds is the one an operator goes looking for. A
 * round rung the whole exceeds by less than a quarter is left out instead: a 31-day
 * hub beside a 30-day tab reads as a duplicate, and the whole already covers it.
 */
export function rangesFor(days: number): { hours: number; label: string }[] {
  const whole = historyDays({ history_days: days }) * 24
  return [...LADDER.filter((h) => h * 1.25 <= whole), whole].map((hours) => ({
    hours,
    label: label(hours),
  }))
}
