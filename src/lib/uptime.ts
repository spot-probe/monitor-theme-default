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
 * than in the components that draw one, because the timeline's segments and its
 * legend must be the same colours or the page says two things at once. The hues
 * are the ones the rest of the page already uses for state -- the meters and the
 * packet-loss badges -- so a colour means one thing wherever it appears.
 *
 * `unknown` is the fourth state and not a shade of `down`: an hour the hub had no
 * rows for *because the node did not exist yet* is not an outage, and drawing it
 * red would invent downtime. It is the grey the page already uses for a node that
 * never connected.
 */
/**
 * The timeline's fills. `-fg` rather than the plain tokens: those are the page's
 * brightest colours (green-500/amber-500) and the strip is made of many small
 * blocks, so it read as the loudest thing on a page whose palette is otherwise
 * muted -- and amber outshone green, which put "partly broken" above "fine".
 * These two are the theme's own deeper steps, already used for text and checked
 * for contrast. `down` stays the destructive red and `unknown` the soft grey.
 */
export const TONE_CLASS = {
  ok: "bg-ok-fg",
  warn: "bg-warn-fg",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/25",
} as const

export type Tone = keyof typeof TONE_CLASS

/** What each state is called, in the legend and in a segment's own label. */
export const TONE_LABEL: Record<Tone, string> = {
  ok: "正常",
  warn: "部分异常",
  down: "离线",
  unknown: "无数据",
}

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
 * One segment of the timeline: a stretch the hub measured, or one of the period it
 * had nothing to measure.
 *
 * `m` is the minutes the segment was expected to cover -- its width in minutes,
 * except at the ends of the window where it is partial -- and `n` the minutes
 * actually reported. Both are minutes whatever the segment's width, which is what
 * lets the tooltip report the covered minutes **when some are missing**. A fully
 * covered segment says nothing about minutes: the bar already shows the gap, and
 * "180/180" on a green run is a repeat rather than a reading.
 *
 * `known` is false for the stretch before the node's history begins, whether
 * because the node was added later or because the hub no longer retains that far
 * back: either way there are no minutes to count, which is a different answer
 * from "every minute was missed" and has to be drawn as one.
 */
export type Segment = { ts: number; n: number; m: number; known: boolean }

/**
 * How wide one segment is, in hours, for a window of `hours`.
 *
 * The rule is a *segment count*, not a bucket size. An hour per segment is right
 * for a day and absurd for a month: a week drawn hourly is 168 strips, which on a
 * card a little over 300px wide is under two pixels each -- a texture, not a
 * chart. Sixty is the top of the band that still reads at a glance; the exact
 * minutes are in the tooltip whatever the width, so the segments only have to
 * stay countable, and coarsening them costs nothing that the hover does not give
 * back.
 *
 * The ladder is whole hours only, and each rung divides the next: 1, 2, 3, 6, 12,
 * 24. A window that is not a multiple of its rung simply ends with a partial
 * segment, which the hub's own `m` already describes.
 */
const STEPS = [1, 2, 3, 6, 12, 24] as const

/** The band the segment count is kept inside: see `stepHours`. */
const MOST = 60

/**
 * 日历格里的一格：**第几行（日期）× 一天里的第几个时段**。
 *
 * ⚠️ `row` 是**窗口里的第几天**，不是星期几 —— 见 [`calendarCells`] 的说明。
 */
export type Cell = { row: number; slot: number; ts: number; tone: Tone; n: number; m: number }

/**
 * 一天切几格：**半小时 ⇒ 48 格**。7 行（日期）× 48 列 = 336 格。
 *
 * ⚠️ 粒度的选择是被几何逼出来的，而且**不是越细越好** ✗：
 *   96 列（一刻钟）⇒ 每格只有约 12px，扣除间距几乎糊成一片 ✗；
 *   48 列（半小时）⇒ 每格约 20px、缝 4px ⇒ 与 GitHub 那种清爽感相当 ✓。
 * 数据本身支持到分钟级（hub 的分桶下限是 60 秒）。
 */
export const SLOT_HOURS = 0.5
export const SLOTS_PER_DAY = Math.round(24 / SLOT_HOURS)

/** 网格的行数：最近 7 个自然日（含今天）。 */
export const ROWS = 7

/** 取最坏时比轻重。⚠️ `unknown` 与 `warn` 同权 —— 它表示"没有数据"，不是"更糟"。 */
const SEVERITY: Record<Tone, number> = { ok: 0, warn: 1, unknown: 1, down: 2 }

/** 某时刻所在**本地自然日**的零点（秒）。 */
function midnightOf(secs: number): number {
  const d = new Date(secs * 1_000)
  d.setHours(0, 0, 0, 0)
  return d.getTime() / 1_000
}

/**
 * 把逐桶的可用率摆成 7 行 × 48 列的日历格，**行是日期、从上到下时间递增** ✓。
 *
 * ⚠️ 行**不是星期** ✗ —— 这一点踩过坑：窗口是"最近 7 个自然日"，它跨**两个**周一至
 * 周日，用星期当行就必然出现"六、日两行拿到的是一周前的日期"（六=10月10日、
 * 日=10月11日，而其它的都是 10月12–16日），看起来像时间跳回去了 ✓✗。
 * 改成日期之后，每行与每一天一一对应，"更旧"就不可能发生 ✓。
 * 代价是失去"星期"这个维度（看不出"每个周一都不稳"），换来的是日期完全准确。
 *
 * ⚠️ 桶宽**从数据里量**，不写死 ✓：hub 给半小时桶时一格一桶；老版本 hub 只给
 * 一小时桶时，那个桶会铺到它覆盖的两格上（都标同一状态）⇒ 不会出现"半格空着" ✓。
 *
 * 没有桶的格子是 `unknown` —— 与时间轴那条"没上报不等于离线"同一套规矩。
 * 每一格的 `ts` 都是**本地零点 + 时段**，所以空格的提示也能说清是哪天哪一段 ✓。
 */
export function calendarCells(data: Availability): Cell[] {
  const cells: Cell[] = []
  const today = midnightOf(data.to)
  const first = today - (ROWS - 1) * 86_400
  for (let row = 0; row < ROWS; row++)
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++)
      cells.push({ row, slot, ts: first + row * 86_400 + slot * SLOT_HOURS * 3_600, tone: "unknown", n: 0, m: 0 })
  const width = SLOT_HOURS * 3_600
  // 只保留这 7 个自然日之内的桶（请求的 168 小时会多出前一天的尾巴）。
  const start = first
  const end = first + ROWS * 86_400
  const bucketSecs =
    data.buckets.length > 1 ? Math.max(60, data.buckets[1].ts - data.buckets[0].ts) : 3_600
  const seen = new Set<Cell>()
  for (const b of data.buckets) {
    for (let ts = b.ts; ts < b.ts + bucketSecs; ts += width) {
      if (ts < start || ts >= end) continue
      const day = midnightOf(ts)
      const row = Math.round((day - first) / 86_400)
      if (row < 0 || row >= ROWS) continue
      const d = new Date(ts * 1_000)
      const minutes = d.getHours() * 60 + d.getMinutes()
      const cell = cells[row * SLOTS_PER_DAY + Math.floor(minutes / (SLOT_HOURS * 60))]
      if (!cell) continue
      const tone = segmentTone({ ts, n: b.n, m: b.m, known: true })
      if (!seen.has(cell)) {
        seen.add(cell)
        cell.ts = ts
        cell.tone = tone
      } else if (SEVERITY[tone] > SEVERITY[cell.tone]) {
        cell.tone = tone
      }
      cell.n += b.n
      cell.m += b.m
    }
  }
  return cells
}

export function stepHours(hours: number): number {
  return STEPS.find((s) => hours / s <= MOST) ?? STEPS[STEPS.length - 1]
}

/**
 * Which of the four states a segment is in.
 *
 * A partial first or last hour is green so long as it is full, which is why `n`
 * is compared against the segment's own `m` and not against 60.
 */
export function segmentTone(s: Segment): Tone {
  if (!s.known) return "unknown"
  if (s.m <= 0 || s.n <= 0) return "down"
  return s.n >= s.m ? "ok" : "warn"
}

/** What one segment says, in the words the tooltip and a screen reader share. */
export function segmentText(s: Segment): string {
  if (!s.known) return `${TONE_LABEL.unknown} · 该时段没有上报记录`
  // 满覆盖时**不再报分钟数**：轴上一片绿已经说明"这段时间有数据"，把 180/180 再写一遍
  // 只是重复。缺了才说 —— 那时"150/180 分钟"才是新信息。
  return s.n === s.m
    ? `${TONE_LABEL[segmentTone(s)]}`
    : `${TONE_LABEL[segmentTone(s)]} · 上报 ${s.n}/${s.m} 分钟`
}

/**
 * The bar's segments: the stretch the hub measured, preceded by the stretch of the
 * period it did not, so the bar always covers the span its title claims.
 *
 * The hub answers in hours whatever the window, so this groups those hours into
 * `stepHours(hours)`-wide segments. Both the grouping and the padding are cut on
 * the same absolute grid -- whole hours, and each rung a multiple of the one below
 * it -- so a segment never straddles a boundary and the two halves line up.
 *
 * The padding stops at the first measured segment rather than at `data.from`,
 * because that segment may begin before `from` (it covers the part of its width
 * the node was alive for) and two segments over one stretch would be a lie about
 * the width.
 *
 * `hours` is what the page asked the hub for; the hub clamps its answer to the
 * node's life and to what it retains, and this is what puts the clamped part back
 * so a node added a day ago does not look like it has been up for a week.
 */
export function segmentsFor(data: Availability, hours: number, step = stepHours(hours)): Segment[] {
  const width = step * 3_600
  const measured: Segment[] = []
  for (const b of data.buckets) {
    const ts = Math.floor(b.ts / width) * width
    const last = measured[measured.length - 1]
    // `m` accumulates too: a partial hour at either end of the window carries
    // fewer than 60 minutes, and the segment's denominator has to be the sum.
    if (last && last.ts === ts) {
      last.n += b.n
      last.m += b.m
    } else {
      measured.push({ ts, n: b.n, m: b.m, known: true })
    }
  }
  const start = Math.floor((data.to - hours * 3_600) / width) * width
  const first = measured[0]?.ts ?? data.to
  const padding: Segment[] = []
  for (let ts = start; ts < first; ts += width) padding.push({ ts, n: 0, m: step * 60, known: false })
  return [...padding, ...measured]
}

/**
 * "8月20日 14:02" -- the hour is what a reader places an outage, or an hour of the
 * timeline, by. The year is noise on a window at most a month wide.
 *
 * Built from the date's own parts rather than through `Intl`: the numeric
 * month/day pattern resolves to "8/20 14:02" under this Node's ICU and to
 * something else under another's, and a page whose date format depends on the
 * reader's ICU version is a page that changes shape for no reason.
 */
export function minuteLabel(minute: number): string {
  const at = new Date(minute * 1_000)
  const hh = String(at.getHours()).padStart(2, "0")
  const mm = String(at.getMinutes()).padStart(2, "0")
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hh}:${mm}`
}

/**
 * The stretch one segment covers, for its tooltip: "9月22日 03:00" for an hour,
 * "9月22日 00:00 – 03:00" for three, "9月22日 – 9月23日" for a day.
 *
 * A day is written as two dates rather than "00:00 – 00:00", which reads as no
 * time at all; everything shorter keeps the clock, because the hour it starts at
 * is how a reader places it against the charts underneath.
 */
export function segmentSpan(ts: number, hours: number): string {
  if (hours <= 1) return minuteLabel(ts)
  const end = new Date((ts + hours * 3_600) * 1_000)
  const hh = String(end.getHours()).padStart(2, "0")
  const mm = String(end.getMinutes()).padStart(2, "0")
  if (hours >= 24) {
    // The instant the segment ends at, which for a day is the next day: a day
    // written as "9月22日 – 9月23日" covers the 22nd, not two names for one date.
    const end = new Date((ts + hours * 3_600) * 1_000)
    return `${minuteLabel(ts).split(" ")[0]} – ${end.getMonth() + 1}月${end.getDate()}日`
  }
  return `${minuteLabel(ts)} – ${hh}:${mm}`
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
