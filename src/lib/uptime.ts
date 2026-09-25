/**
 * Node availability: the share of each window an agent was reporting in, and the
 * bar and outage list the detail page draws from it.
 *
 * The hub measures this from the *absence* of metric rows -- it writes one row
 * per reported minute, so a minute with no row is a minute the node was silent --
 * and it sends the window it measured over alongside the figure. That window is
 * not always the nominal seven or thirty days: it is clamped to the node's own
 * life and to the history the hub still retains. Every label below is therefore
 * derived from `from`/`to` rather than written into the markup; a page that
 * printed "近 30 天" from the number alone would be claiming a span the hub may
 * not have. See `notes/uptime-and-incidents.md`.
 *
 * This is *node* availability -- whether the agent was talking to the hub -- and
 * not probe availability, which is whether a target answered and comes from
 * `ping_record.loss`. The page keeps the two apart.
 */
export type Uptime = {
  d7: number
  d30: number
  from7: number
  from30: number
  to: number
}

/** One hour of the bar: `n` minutes reported out of the `m` it was expected. */
export type Bucket = { ts: number; n: number; m: number }

/** One outage, in epoch seconds: when it started and how many minutes it ran. */
export type Incident = { start: number; minutes: number }

export type Availability = {
  from: number
  to: number
  buckets: Bucket[]
  incidents: Incident[]
}

/**
 * The fill behind each state. Kept beside the functions that pick a state rather
 * than in the two components that draw one, because the card's dot and the bar's
 * segments must be the same three colours or the page says two things at once.
 * The hues are the ones the rest of the page already uses for state -- the meters
 * and the packet-loss badges -- so a colour means one thing wherever it appears.
 */
export const TONE_CLASS = { ok: "bg-ok", warn: "bg-warn", down: "bg-destructive" } as const

/**
 * The span a window covers, in the unit the page says it in.
 *
 * Rounded rather than truncated because the hub reports minute-aligned ends: a
 * week of minutes is 10079 of them, which truncation would print as "近 6 天".
 */
export function windowLabel(from: number, to: number): string {
  const span = to - from
  if (span <= 0) return "刚刚加入"
  if (span >= 86_400) return `近 ${Math.round(span / 86_400)} 天`
  if (span >= 3_600) return `近 ${Math.round(span / 3_600)} 小时`
  return `近 ${Math.max(1, Math.round(span / 60))} 分钟`
}

/**
 * A fraction as the page prints it.
 *
 * Two decimals, because a week of minutes moves the second one, and exactly one
 * reads as "100%": a node that missed nothing should not print "100.00%".
 */
export function availabilityText(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—"
  const pct = Math.min(100, Math.max(0, fraction * 100))
  const text = pct.toFixed(2)
  return text === "100.00" ? "100%" : `${text}%`
}

/**
 * Which of the three states a bar segment is in, and the same answer the card's
 * dot takes. Green when every expected minute reported, amber when some were
 * missed, red when none were -- a partial first or last hour is green so long as
 * it is full, which is why `n` is compared against the bucket's own `m` and not
 * against 60.
 */
export function barTone(n: number, m: number): "ok" | "warn" | "down" {
  if (n <= 0 || m <= 0) return "down"
  return n >= m ? "ok" : "warn"
}

/**
 * The same three states for a whole-window fraction, for the card's line.
 *
 * The thresholds are a judgement and they live here with names rather than in
 * the markup: 99.5% is about where a week's uptime stops reading as "all of it",
 * 90% is where a node is plainly unreliable.
 */
export function fractionTone(fraction: number): "ok" | "warn" | "down" {
  if (fraction >= 0.995) return "ok"
  return fraction >= 0.9 ? "warn" : "down"
}

/**
 * "8月20日 14:02" -- the hour is what a reader places an outage by, and the year
 * is noise on a window at most a month wide.
 *
 * Built from the date's own parts rather than through `Intl`: the numeric
 * month/day pattern resolves to "8/20 14:02" under this Node's ICU and to
 * something else under another's, and a page whose date format depends on the
 * reader's ICU version is a page that changes shape for no reason.
 */
export function incidentStamp(start: number): string {
  const at = new Date(start * 1_000)
  const hh = String(at.getHours()).padStart(2, "0")
  const mm = String(at.getMinutes()).padStart(2, "0")
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hh}:${mm}`
}

/**
 * How long an outage ran. Two units at most, as `uptime` does: "1 天 2 小时 13
 * 分" is three units of width for no information.
 */
export function outageLength(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h < 24) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d} 天 ${rh} 小时` : `${d} 天`
}

/**
 * Whether an outage was still running when the window closed.
 *
 * The hub cannot know otherwise: an outage that ends at the window's last minute
 * and one that is still going are the same list entry, and calling it "至今" when
 * the node has since returned would be the wrong claim of the two.
 */
export function stillDown(incident: Incident, to: number): boolean {
  return incident.start + incident.minutes * 60 >= to
}

/**
 * Minutes the node was silent across the window, summed from the buckets rather
 * than from the outage list: both are the same number, and this way each minute
 * is counted once whatever the list did with it.
 */
export function missingMinutes(buckets: Bucket[]): number {
  return buckets.reduce((sum, b) => sum + Math.max(0, b.m - b.n), 0)
}
