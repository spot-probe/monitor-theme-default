import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, StickyNote } from "lucide-react"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type DotItemDotProps,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { AvailabilityCard } from "@/components/Availability"
import { ChartTooltip, Crosshair, Swatch } from "@/components/ChartTooltip"
import { Country, Status } from "@/components/NodeCard"
import { api, useHistoryDays, type Node } from "@/lib/api"
import { rateCrosshair } from "@/lib/chart"
import { rangesFor } from "@/lib/ranges"
import {
  axisBytes, axisTop, bytes, clockFor, despike, quarters, cpuName, cycle, FOREVER, money, osName, rate,
  rateAxis, RATE_FLOOR,
  stamp, tickClock, timeTicks,
} from "@/lib/format"
import { spanHint, type Availability } from "@/lib/uptime"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  /**
   * The highest rate the agent measured across one report interval inside this
   * bucket, never below the mean beside it. Absent from a hub predating the
   * column, which is why the peak is drawn only from rows that carry one -- and
   * why a bucket whose peak is absent falls back to its own mean rather than
   * claiming a peak of zero.
   */
  net_rx_max?: number
  net_tx_max?: number
  /** 均值到峰值的一段，画成线后面那条带。没有峰值数据时上下沿重合。 */
  rx_band: [number, number]
  tx_band: [number, number]
  /**
   * Absent until the hub is new enough to put it in a history row. Optional
   * rather than defaulted to zero, so a hub without it draws no swap line at all
   * instead of a line along the floor claiming the machine swaps nothing.
   */
  swap_used?: number
  /**
   * The bucket's mean 1-minute load average, `null` for a bucket with no load
   * samples. Absent on a hub older than the field, which is why the load curve is
   * drawn only when some row carries one -- the same rule as `swap_used`.
   */
  load1?: number | null
  /**
   * ⚠️ 这三个是**可空**的，不是可选的零 ✓：小时行是折桶折出来的，而这三列是后来才加的
   * （hub 23 → 24 那次迁移）⇒ 迁移之前折出来的那些小时行没有这些数，读出来是 `null`。
   * ⇒ 画的时候**让线断开** ✓，而不是把 `null` 当 0 连起来：那一段是"没有这个数据"，
   * 不是"零个连接"。与 `swap_used` / `load1` 同一条规矩。
   */
  tcp?: number | null
  udp?: number | null
  procs?: number | null
}
// `latency` is the bucket's median round trip, null when every probe in it timed
// out. `band` is the range its answers spanned, absent when they spanned nothing.
// `loss` is the percentage that timed out, absent when none did.
type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>
/**
 * Proportion of the whole window each probe lost, by id, absent for probes that
 * lost nothing. Sent because it cannot be derived here: every bucket's `loss` is
 * already a percentage of that bucket, so the sample counts it was divided by are
 * unavailable. Averaging them would weight a bucket holding one sample equally
 * with one holding twelve, and the window's first and last buckets are partial
 * regardless of what the probe does.
 */
type Loss = Record<string, number>


const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

// ⚠️ 资源图的系列用这个 ✓：两侧都是空档的那**一个**点，没有任何邻居可以连线 ✓
// ⇒ `dot: false` 会让它**完全不显示** ✗（一台掉线一段、只回来报了一个桶的机器 ✓
// 在图上会像"什么都没发生" ✓）。命中这种点时画一个 2px 的圆 ✓。
// ⚠️ 用 recharts 交进来的 `points`（这个系列自己的 y 值 ✓）判邻，不必闭包取数据 ✓。
const RESOURCE_SERIES = {
  ...SERIES,
  dot: ({ cx, cy, index, points, stroke }: DotItemDotProps) =>
    cy == null || points[index - 1]?.y != null || points[index + 1]?.y != null ? null : (
      <circle cx={cx} cy={cy} r={2} fill={stroke} />
    ),
}

// ⚠️ 速率图是**对数**轴 ✓，而它没有 0 ✗ ⇒ 低于地板的读数要**抬到地板上再画** ✓
//（不是改数据 ✓：提示框仍旧读 hub 给的原值 ✓，见速率面板里的 `pick` ✓）。
const lift = (v: number) => Math.max(v, RATE_FLOOR)

// Recharts eases its tooltip after the pointer over 400ms. Left on, the box lags
// behind the crosshair by most of a second on a fast drag, so the two read as two
// different readings of the same instant; the crosshair is what says where the
// pointer is, and it is exact.
const WRAPPER = { transition: "none" }

// ⚠️ 而**容器不滑** ≠ **提示框不滑** ✗ —— 上面那个只管外层容器的过渡 ✓，
// 下面这个管的是 recharts 自己的入场动画 ✓：从图表右侧移入时，提示框会先出现在
// 光标右侧、再用 **400ms** 滑回图内 ✓，滑动期间最多**超出页面 140px** ✓，
// 足以闪出一条横向滚动条 ✓✗ ⇒ 直接关掉 ✓（上游那两笔的实测数字 ✓）。
const TOOLTIP = { isAnimationActive: false }

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the four plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
const VALUE_AXIS = { ...AXIS, width: 68, interval: 0 }

// The CPU panel is the only one with a second axis, and that axis costs the plot
// width it stands on. The other three reserve the same width as a right margin, so
// all four plots keep one x range and a CPU spike stays in the same column as the
// network spike that caused it -- which is the whole reason the width is a single
//
// ⚠️ `interval: 0` 是**必须的** ✗：列出的刻度要**全部画出来** ✓，而 recharts 自己的碰撞
// 处理会把顶端标签内推 5px、顺手藏掉它下面那个刻度 ✓，网格线还另外再算一遍 ✓✗
//（CPU 轴会因此少一条 30% 的网格线 ✓；速率轴少掉 10 MB/s 那个标签和两条网格线 ✓）。
// number rather than one per panel.
const LOAD_AXIS = 36

// One hue per probe. Upstream shipped this in greyscale, where the dash pattern
// had to carry what lightness could not -- and where, by its own note below, a
// dotted line and a dashed one both collapsed into texture at the day range.
// This fork restored the colour palette those tokens were always pointing at, so
// hue separates the series now and the dash is pure noise on top of it. The
// consequence is a solid line, which is what reads at a glance on a panel meant
// to be read at a glance.
//
// The old note, kept because the problem it describes is worth not
// rediscovering: a muted colour palette was built and measured upstream but not
// adopted, because greyscale was the house style.
// Blue, then violet, then cyan: the three probes most fleets run should be the
// three easiest to tell apart. Green, amber and red are absent on purpose -- those
// three mean state on this page, so a probe drawn in amber reads as a warning.
// ⚠️ 每个探测一个颜色：此前第 3 个与第 1 个、第 4 个与第 2 个**同色**，而图例正是靠色块
// 区分的（虚线也因此被去掉）⇒ 3 个探测时读者分不清哪条线是哪个探测。
const PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-4)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

// One unit per panel, so the panels that measure different things share one
// tooltip and one crosshair rather than five formatters written out twice.
const pct = (v: number) => `${v.toFixed(1)}%`
// A tenth of a millisecond is where a probe's median stops being noise; the whole
// number the formatter used to print dropped it, and forty of them in a row read
// as a flat line of integers.
const ms = (v: number) => `${Math.round(v * 10) / 10} ms`
// Two decimals below ten: a load average is read as "0.06", and a fixed width is
// what keeps the header and the tooltip from jumping as it moves.
const load = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(1))
// The same reading on an axis tick, where "0.25" is a label and "0.25.00" is not.
const loadTick = (v: number) => (v === 0 ? "0" : v < 1 ? `${Math.round(v * 100) / 100}` : `${Math.round(v * 10) / 10}`)

/**
 * One chart, on its own surface. The panels used to lie flat on the page ground,
 * which left four plots competing with the metadata above them for the same
 * attention; a card gives each one an edge to sit inside, and the title moves into
 * that card's header instead of floating over the plot.
 *
 * `value` is what the panel is reading at its right edge: the last bucket the
 * chart drew, in the panel's own unit. It is the one figure a reader wants
 * without hovering -- the shape of the line says where the machine has been, and
 * this says where it is -- and it is read from the chart's own data rather than
 * from the live report, so the number and the line's right end always agree.
 */
function Panel({ title, value, children }: { title: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="gap-0 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        {value}
      </div>
      <div className="h-40 w-full text-muted-foreground">{children}</div>
    </Card>
  )
}

/**
 * The reading in a panel's header, with the instant it was measured at as a
 * `title`: the figure is the chart's own last bucket rather than a live value, and
 * a reader comparing it against a clock should be able to find out which second it
 * belongs to without the header carrying a second line of text.
 */
function Reading({ at, children }: { at?: number; children: React.ReactNode }) {
  return (
    <span className="tnum text-xs font-medium" title={at ? stamp(at) : undefined}>
      {children}
    </span>
  )
}

/** One series in a header: its own hue, its arrow and its figure. */
function HeaderSeries({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Swatch color={color} />
      <span className="text-muted-foreground">{name}</span>
      {value}
    </span>
  )
}

/**
 * The wash under an area line. One hue at two opacities rather than a flat fill: a
 * constant 15% reads as a block of colour, while a gradient lets the line carry the
 * shape and the fill only suggest the mass beneath it.
 *
 * The stop colour is written out rather than left to currentColor: inside a
 * gradient, currentColor resolves against the gradient element itself, not against
 * the shape that references it.
 */
function Wash({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.24} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  )
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours.
 *
 * The window the filter judges against has to be a duration, not a count: the hub
 * buckets a window to the `points` asked for below, so the same day arrives as
 * one-minute buckets on a desktop and two-minute ones on a phone, and a fixed
 * count would clip a five-minute stall on the first while keeping it on the
 * second. The smallest gap is the bucket interval; a longer one is the node being
 * offline. Odd, so the window has a middle, and bounded so a sparse probe still
 * has neighbours and a dense one does not pay for a wide sort.
 */
function despikeWindow(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i].ts - points[i - 1].ts)
  return Math.min(15, Math.max(3, Math.round(420 / step) | 1))
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

export function NodeDetail({ node, showPeak, onBack }: {
  node: Node
  /** 站长在主题设置里可以关掉峰值；关掉后图与 hub 没有这个字段时完全一样。 */
  showPeak: boolean
  onBack: () => void
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  // What this hub keeps, which is what the picker may offer and how far the
  // availability timeline reaches. A rung above it would draw a shorter chart than
  // the one that was picked, which reads as lost data rather than as a limit.
  const days = useHistoryDays()
  const rangeOptions = rangesFor(days)
  // ⚠️ 延迟页此前**只给到一天** ✗：那是我当初的判断（"一周的探测历史不是这一页的用途"）。
  // 但 hub 会保留 7 天逐分钟、更久的是每小时中位数，而资源页早就能选到保留期 —— 同一页
  // 两个页签给的上限不一致，读者只会以为"延迟只有一天的历史"。
  // 现在两个页签共用同一份档位（都从 `history_days` 推出来）：能看多远由 hub 决定。
  const offers = () => rangeOptions
  // Each tab keeps its own range: a 7-day trend and a 1-hour trace answer
  // different questions.
  const [ranges, setRanges] = useState({ resources: 6, latency: 6 })
  const hours = ranges[tab]
  const [smooth, setSmooth] = useState(false)
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  const [data, setData] = useState<{ metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss } | null>(null)
  // Retained rather than folded into an empty result: a refused request and an
  // empty window are different answers, and the hub has reason to refuse this one
  // -- it caps how many history windows it builds concurrently, since each holds
  // the connection the agents report through. Rendered as an empty window, a 503
  // would misdirect the reader.
  const [failed, setFailed] = useState("")
  // ⚠️ 标签写的是**请求**的窗口，而 hub 可能只给得出一部分（节点才活了三天、或者保留期
  // 在那之后被调小）—— 图上的 x 轴是按数据首尾画的 ⇒ 不说一句的话，chip 写着「90 天」
  // 而图只有 3 天，读起来就是"数据丢了"。差得多才提示，边缘裁剪不吵人。
  const span = useMemo(
    () => (data ? spanHint(tab === "latency" ? data.ping : data.metrics, hours) : ""),
    [data, tab, hours],
  )
  // Where the brush has been dragged, so the axis reticks for the visible span
  // rather than retaining the whole window's ticks.
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  // Where the chart begins on screen, so its height can occupy the remainder.
  const [chartTop, setChartTop] = useState(0)
  // ⚠️⚠️ 这个 ref **必须是稳定引用** ✗✗ —— 原来是内联箭头 ✓ ⇒ React 每次渲染都会
  // detach/attach ⇒ **每次都调它** ✓，而它 setState ⇒ 又一次渲染 ⇒ 又量一遍 ✓✗
  //（那句"this callback runs on every render"的注释自己就写明了 ✓）。
  // ⚠️ 而这条循环不是无害的 ✗：图高 = `100svh − chartTop` ✓ ⇒ 图高影响页面高度 ✓
  // ⇒ 滚动条出现/消失 ⇒ **视口宽度变** ⇒ 上面的卡片换行 ⇒ chartTop 又变 ✓✗
  // ⇒ 页面会在两种高度之间来回摆 ✓（这就是"像换了一页"的来源之一 ✓）。
  // ⇒ 稳定引用 + 只在挂载时量一次 ✓（配合 index.css 里的 `scrollbar-gutter: stable`
  //   把"滚动条改变宽度"这条反馈也断掉 ✓）。
  const measureChartTop = useCallback((el: HTMLDivElement | null) => {
    if (el) setChartTop(el.getBoundingClientRect().top + scrollY)
  }, [])
  // The availability timeline, fetched apart from the charts below: it covers a
  // fixed week rather than the range picked above it, since the range selector is
  // for the charts and a timeline that changed width with it would be a different
  // question. A week is also all an anonymous caller may ask for, and it matches
  // the hub's default retention. `null` while it is in flight, or if the hub is
  // older than the feature, and no card is drawn for either.
  const [avail, setAvail] = useState<Availability | null>(null)
  // ⚠️ 失败也要说出来 ✗✗ —— 此前 `.catch(() => setAvail(null))` 让一次瞬时 503 把整张
  // "在线状态日历"静默抹掉（连"加载失败"都没有），而那正是与图表请求同时打、最容易撞上
  // hub 那个 4 个并发闸门的时候。
  const [availFailed, setAvailFailed] = useState(false)
  const [availTry, setAvailTry] = useState(0)

  useEffect(() => {
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect
    setAvail(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setAvailFailed(false)
    api<{ availability: Availability | null }>(
      `/nodes/${node.id}/metrics?hours=168&series=availability&slot=1800`,
    )
      .then((next) => { if (active) setAvail(next.availability ?? null) })
      // 读失败就**说出来并给一次重试**：静默消失会让读者以为这台机器没有可用率数据。
      .catch(() => { if (active) setAvailFailed(true) })
    return () => { active = false }
    // ⚠️ **不要**把 `historyHours` 放进依赖 ✗✗：URL 里的窗口是固定的一周（这张卡就是
    // 7 × 48 的日历），而 `/api/me` 回来后 `history_days` 会从回退值变成真实值 ⇒ 依赖变了
    // 就得把**同一个 URL 再发一次**。实测：每开一个节点页会因此多发一次可用率 + 一次 /me，
    // 而历史查询只有 4 个并发位。
  }, [node.id, availTry])

  useEffect(() => {
    let active = true
    // The charts must not continue drawing the old range while the new one is in
    // flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setZoom(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    // What this screen can resolve, in device pixels, which is the unit the line
    // is drawn in: a 1280-wide retina panel has 2560 of them for a day of minutes.
    // Read here rather than from a ref, since the hub only thins further, an
    // approximate figure suffices, and the viewport is known before layout. A
    // rotation keeps whatever it fetched with.
    //
    // The tab determines which half is requested; the other accounted for a third
    // to two thirds of every response and was never drawn.
    const points = Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))
    const series = tab === "latency" ? "ping" : "metrics"
    api<{ metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss }>(
      `/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`,
    )
      .then((next) => { if (active) setData(next) })
      .catch((e: Error) => {
        // `|| "..."` as in App.tsx: HTTP/2 dropped statusText, so a bodiless
        // failure from a proxy arrives as the empty string and renders as no
        // error.
        if (active) { setFailed(e.message || "网络错误"); setData({ metrics: [], ping: [], probes: {} }) }
      })
    return () => { active = false }
  }, [node.id, hours, tab])

  const m = node.metrics
  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the two below: the node prop changes every few
  // seconds as live metrics arrive, and rebuilding the chart's data array on those
  // renders would reset the brush.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          // Timeouts are retained: dropping them would draw a probe losing half
          // its packets as an unbroken line, and one that never answered not at
          // all.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          // Taken from the hub rather than summed from the buckets above, each of
          // which is already a percentage of its own bucket, so averaging them
          // would report one lost round in thirteen as 50%. Left unrounded, since
          // `Math.round` would render 0.28% and 0.00% as the same badge, and the
          // absence of a badge denotes no loss.
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  // The hub answers in seconds; the time axis requires milliseconds.
  // 每一行还带一条「均值到峰值」的带：图的线是均值（它才积分为累计流量），而一次
  // 15 秒测速摊到一分钟只剩四分之一。站长关掉峰值、或 hub 没有这一列时，带的上下沿
  // 重合、高度为零，于是轴顶与画面都回到原样，不需要另一条分支。
  const metricRows = useMemo(
    () =>
      (data?.metrics ?? []).map((m) => ({
        ...m,
        ts: m.ts * 1_000,
        rx: lift(m.net_rx),
        tx: lift(m.net_tx),
        rx_band: [lift(m.net_rx), showPeak ? lift(m.net_rx_max ?? m.net_rx) : lift(m.net_rx)],
        tx_band: [lift(m.net_tx), showPeak ? lift(m.net_tx_max ?? m.net_tx) : lift(m.net_tx)],
      })),
    [data, showPeak],
  )

  // 这一段里的最高速率，只有 hub 送来了 `net_*_max` 才算得出来 —— 拿「均值里的最大
  // 值」当峰值是错的，所以宁可不说。
  const peak = useMemo(() => {
    const rows = data?.metrics ?? []
    if (!showPeak || !rows.some((m) => m.net_rx_max !== undefined)) return null
    const hi = (pick: (m: Point) => number | undefined) => rows.reduce((top, m) => Math.max(top, pick(m) ?? 0), 0)
    return { rx: hi((m) => m.net_rx_max), tx: hi((m) => m.net_tx_max) }
  }, [data, showPeak])

  // Axis tops for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  // ⚠️ 四条值轴用 `VALUE_AXIS`（`interval: 0`）之后，**顶端那格标签是压在轴顶上的** ✗
  // ⇒ 没有上边距就会被容器裁掉半行 ✓✗（截图里「10 MB/s」「40 GB」都缺了上半 ✓）。
  // 8px 是它需要的最小值 ✓：11px 的字居中在轴顶，上半约 5.5px ＋ 一点余量 ✓。
  const axes = useMemo(() => {
    const max = (pick: (m: (typeof metricRows)[number]) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
    // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
    const cpu = axisTop(max((m) => m.cpu), 4, 100)
    // A load average has no capacity to be a fraction of, so it climbs a ladder
    // too -- but its floor is a quarter rather than the CPU's 4%: these are
    // counts, not percentages, and 0.25 is where a quiet single-core box sits.
    // Absolute load rather than load per core, as the panel's own reading.
    const load = axisTop(max((m) => m.load1 ?? 0), 0.25)
    return {
      cpu: { domain: [0, cpu] as [number, number], ticks: quarters(cpu) },
      load: { domain: [0, load] as [number, number], ticks: quarters(load) },
      // ⚠️ 速率**不走**刻度阶梯 ✓：它跨好几个数量级 ⇒ 交给对数轴 ✓，
      // 底取"画出来的最慢速率"、顶取"最高的峰值" ✓ ⇒ 那条带不会跑出面板 ✓。
      rate: rateAxis(
        metricRows.reduce((lo, m) => Math.min(lo, m.rx, m.tx), Infinity),
        max((m) => Math.max(m.rx_band[1], m.tx_band[1])),
      ),
    }
  }, [metricRows])

  // The last bucket the chart drew, which is what each panel's header reads.
  const last = metricRows[metricRows.length - 1]
  // Swap is drawn on the memory panel's axis, so a host whose swap file is larger
  // than its RAM would otherwise have its swap line drawn above the plot, across
  // the panel's title. The axis takes whichever is bigger; the title stops naming
  // a capacity at that point, since it is no longer the whole story.
  //
  // The capacity decides whether there is a swap line at all, not the history: a
  // machine with swap turned off reports a row of zeroes for every bucket, and a
  // zero that means "there is none" is not a measurement to draw a line along the
  // floor from. A hub older than the field sends no `swap_used`, which is the
  // other half of the same answer.
  const hasSwap = useMemo(
    () => node.swap_total > 0 && metricRows.some((m) => typeof m.swap_used === "number"),
    [node.swap_total, metricRows],
  )
  const memTop = hasSwap ? Math.max(node.mem_total, node.swap_total) : node.mem_total
  // Same rule as swap, for the same reason: a hub older than the field sends no
  // `load1`, and an empty right axis over a line along the floor would be a claim
  // about a machine the hub never measured.
  const hasLoad = metricRows.some((m) => typeof m.load1 === "number")
  // 连接数与进程数：与 `hasSwap` / `hasLoad` 同一套判法 —— 一条都没有就不画那条线，
  // 而不是画一条贴着地板的线说"零个连接"。
  const hasTcp = metricRows.some((m) => typeof m.tcp === "number")
  const hasUdp = metricRows.some((m) => typeof m.udp === "number")
  const hasProcs = metricRows.some((m) => typeof m.procs === "number")
  // 左轴管连接数（TCP 与 UDP 量级接近，同轴可比），右轴管进程数（几百 vs 几十，
  // 同轴会把连接线压成贴地的一条）。两个顶都从窗口自己的最大值取，取不到就给 1。
  const connTop = Math.max(1, ...metricRows.map((m) => Math.max(m.tcp ?? 0, m.udp ?? 0)))
  const procsTop = Math.max(1, ...metricRows.map((m) => m.procs ?? 0))

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed on the full list, so a line keeps its shade when others are hidden.
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]
  // ⚠️ 颜色**不是唯一的区分手段** ✗✗：五条线用五个色相，但对色觉障碍的读者它们可能一样。
  // 线型是第二编码 —— 实线 / 长虚 / 点线 / 点划 / 短虚，与颜色一一对应（同一个序号）。
  // 这不是退回"靠虚线区分"：颜色仍然在，只是不再独自承担这件事。
  const DASHES = ["none", "6 3", "2 3", "8 3 2 3", "4 4"]
  const dash = (id: number) => DASHES[pingSeries.findIndex((p) => p.id === id) % DASHES.length]

  // The hub stamps every sample with its bucket rather than the second the probe
  // finished, so probes reporting at the bucket's rate share rows instead of each
  // contributing its own: a day of four probes is 717 rows rather than 2,868. A
  // slower probe leaves gaps in its own column, which is what `connectNulls`
  // addresses.
  //
  // Every probe and both versions of every sample are held here whether or not
  // they are on screen: recharts resets the brush when the data array changes
  // identity, and re-reads a controlled selection only when the index props
  // change, which they do not. Hiding a probe or enabling despiking therefore
  // selects a `dataKey` rather than rebuilding the array.
  const pingRows = useMemo(() => {
    const rows = new Map<
      number,
      { ts: number } & Record<string, number | [number, number] | null>
    >()
    for (const s of pingSeries) {
      const window = despikeWindow(s.points)
      const smoothed = despike(s.points.map((p) => p.latency), window)
      // The band spans the same outliers as the line, and with one probe on screen
      // it is what the axis is fitted to, so it is clipped alongside it rather
      // than left to pull the axis back open. The latency fills the buckets that
      // carry no band, keeping each filter's window dense.
      const lo = despike(s.points.map((p) => p.band?.[0] ?? p.latency), window)
      const hi = despike(s.points.map((p) => p.band?.[1] ?? p.latency), window)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i]
        row[`l${s.id}`] = p.loss ?? 0
        // A bucket with a single answer carries no band and spans only that
        // answer. Left null, `connectNulls` would bridge the hours between the few
        // buckets that have one: 2 to 10 of 1,440 in a day, the widest gap 803
        // minutes, drawn as one large wedge.
        row[`b${s.id}`] = p.band ?? (p.latency === null ? null : [p.latency, p.latency])
        // Taken as the span of three filtered series rather than a pair: the two
        // edges are filtered independently, so a bucket that answered slightly
        // faster than usual can trip the low edge alone and come back above the
        // high one -- [180, 178] against a line of 176, drawn backwards with the
        // line outside it.
        const [low, high] = [lo[i], hi[i]]
        row[`c${s.id}`] =
          low === null || high === null
            ? null
            : [Math.min(low, high, smoothed[i] ?? low), Math.max(low, high, smoothed[i] ?? high)]
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  // A real time axis rather than the category axis recharts defaults to: on a
  // category axis ticks are selected by index, so a period the agent was offline
  // for collapses to nothing.
  const timeAxis = (rows: { ts: number }[], from = 0, to = rows.length - 1) => {
    // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
    // are dropped by `minTickGap`.
    const ticks = rows.length ? timeTicks(rows[from].ts, rows[to].ts) : []
    return {
      dataKey: "ts",
      type: "number" as const,
      domain: ["dataMin", "dataMax"] as const,
      ticks,
      // Handed the ticks rather than the window: a year drawn on the first of each
      // month writes the date alone, while the same window brushed down to a day
      // gets its times back -- the window did not change, the ticks did.
      tickFormatter: tickClock(ticks, hours),
      minTickGap: hours > 24 ? 72 : 40,
      ...AXIS,
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {/* The same ghost, icon-sized control the header uses for its own icon
            buttons. -ml-2 pulls the glyph back onto the content edge: the button
            carries 8px of padding of its own, which would otherwise sit the arrow
            inside the column the cards below line up on. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="返回节点列表"
          title="返回节点列表"
          className="-ml-2 shrink-0"
        >
          <ArrowLeft />
        </Button>
        <h2 className="truncate text-lg font-medium">{node.name}</h2>
        <Country node={node} />
        <Status node={node} />
        {node.agent_version && (
          <Badge variant="outline" className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      {/* One flat row of facts: what is left after the traffic figures moved
          out is one machine's spec sheet, and a box around a single topic is
          just a box. Three across at lg, two at md, one on a phone -- a kernel
          version or a CPU model needs about 270px to stay whole. */}
      <Card className="gap-0 p-4">
        <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
        <Fact
          label="CPU"
          value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
        />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact
          label="架构"
          value={[node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="续费"
          value={[
            node.price > 0
              ? `${money(node.price, node.currency)} / ${cycle(node.billing_cycle)}`
              : "免费",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].join(" · ")}
        />
        </dl>
      </Card>

      {avail ? (
        <AvailabilityCard data={avail} />
      ) : availFailed ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
          <span>在线状态日历读取失败。</span>
          <Button size="sm" variant="outline" onClick={() => setAvailTry((n) => n + 1)}>
            重试
          </Button>
        </div>
      ) : null}

      {/* The operator's own note, which only a signed-in browser is sent at all
          (`node_view` attaches `remark` with the other panel-only fields), so this
          block is never part of the public page. It used to be the bare text in a
          dashed box: a reader who did not remember writing it -- and only the
          author ever sees it -- met an unexplained line, which reads as a rendering
          bug rather than as their own note. The label is the whole fix; the dashed
          surface stays, because the note is not measured data. */}
      {node.remark?.trim() && (
        <Card className="gap-0 border-dashed bg-muted/40 p-4">
          <h4 className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <StickyNote className="size-3" aria-hidden />
            备注
          </h4>
          <p className="text-sm whitespace-pre-wrap">{node.remark}</p>
        </Card>
      )}

      {/* Two controls on one line, each in its own container. They used to be two
          stacked rows of identical blue pills, which said nothing about one picking
          a view and the other a time range. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="数据视图"
          value={tab}
          onChange={setTab}
          items={TABS.map((t) => ({ value: t.key, label: t.label }))}
        />
        {/* ⚠️ `narrow` 只给这一排 ✓：保留期一年时它有 7 段 ✓，窄屏上要能排成一行 ✓。 */}
        <Segmented
          narrow
          label="时间范围"
          value={hours}
          onChange={(next) => setRanges((all) => ({ ...all, [tab]: next }))}
          items={offers().map((r) => ({ value: r.hours, label: r.label }))}
        />
        {span && <span className="text-xs text-muted-foreground">{span}</span>}
        {tab === "latency" && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={smooth}
              onChange={(e) => setSmooth(e.target.checked)}
              className="accent-foreground"
            />
            削峰
          </label>
        )}
      </div>

      {!data ? (
        // ⚠️⚠️ **占位必须占同样的高度** ✗✗ —— 原来是一个 160px 的 Skeleton ✓，
        // 而资源页加载完是**四张** panel（每张 ≈220px ＋ 间距 ✓）⇒ 数据一到页面
        // **一次长高约 780px** ✗ ⇒ 浏览器为了"保持可见内容不动"会按锚点**调整滚动位置**
        //（scroll anchoring ✓）⇒ 你被挪到别的位置 ⇒ 观感就是"切档位像换了一页" ✓✓。
        // ⇒ 照各自加载完的样子摆位 ✓：资源页四张 ✓、延迟页那**一个**高度 ✓。
        tab === "latency" ? (
          <div
            className="min-h-72"
            style={
              chartTop
                ? { height: `calc(100svh - ${Math.round(chartTop)}px - 1rem)` }
                : undefined
            }
          >
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        )
      ) : failed ? (
        <p className="py-8 text-center text-sm text-destructive" role="alert">读取历史数据失败：{failed}</p>
      ) : tab === "latency" ? (
        pingSeries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
        ) : (
          // An explicit pixel height on the column, so the chart can be `flex-1`
          // within it while the legend takes what it needs: four probes are one row
          // of chips on a desktop and two on a phone, so any fixed reservation is
          // wrong on one of them.
          <div
            // `+ scrollY`, because getBoundingClientRect is measured from the
            // viewport and this callback runs on every render; a live node
            // re-renders every two seconds, so a scrolled page would re-derive the
            // height from a top that has moved.
            ref={measureChartTop}
            style={
              chartTop
                ? { height: `calc(100svh - ${Math.round(chartTop)}px - 1rem)` }
                : undefined
            }
            className="min-h-72">
            {/* The card fills the column whose height was just measured. The outer
                element keeps the ref and the height: measuring the card instead
                would put its own padding and border below the fold. */}
            <Card className="flex h-full flex-col gap-3 p-4">
              <h4 className="text-xs font-medium text-muted-foreground">网络延迟</h4>
            {/* `min-h-0` is what makes `flex-1` a real number rather than the
                content's own height: ResponsiveContainer reads its parent, and
                a flex child not told it may shrink reports whatever the SVG
                last was. The column above has a height in pixels, so this
                resolves at layout instead of coming back 0. */}
            <div className="min-h-0 w-full flex-1 text-muted-foreground">
              {shownProbes.length === 0 ? (
                <p className="py-8 text-center text-sm">没有选中任何探测</p>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={pingRows}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      {...timeAxis(
                        pingRows,
                        Math.min(zoom?.[0] ?? 0, pingRows.length - 1),
                        Math.min(zoom?.[1] ?? pingRows.length - 1, pingRows.length - 1),
                      )}
                    />
                    {/* Not anchored at zero: these lines live in a narrow band
                        far from it, and zero flattens every wobble. */}
                    <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
                    <Tooltip
                      wrapperStyle={WRAPPER} {...TOOLTIP}
                      // recharts drops every entry with no value before the content
                      // sees it, and hides the tooltip outright once nothing is
                      // left -- so a bucket that all three probes timed out in
                      // answers a hover with an empty box. Off, so the timeout is
                      // named where it happened rather than only in the legend's
                      // window-wide percentage.
                      filterNull={false}
                      content={
                        // The line is drawn from what answered, so a bucket that
                        // lost most of its packets would otherwise read as a
                        // normal one: the loss figure is carried alongside the
                        // latency. `dataKey` is `t7`/`s7` and the loss sits at `l7`.
                        <ChartTooltip
                          format={ms}
                          nullText="超时"
                          hint={(item) => {
                            const loss = Number(item.payload?.[`l${String(item.dataKey).slice(1)}`] ?? 0)
                            return loss > 0 ? `丢 ${loss}%` : undefined
                          }}
                        />
                      }
                      // No fixed axis top to divide by, so the vertical line only.
                      cursor={<Crosshair format={ms} />}
                    />
                    {/* Behind the line, the range that bucket's answers
                        spanned -- Smokeping's "smoke". At the day window a
                        bucket moves 63 ms at the 90th percentile against the
                        25 ms the trend moves, so a line alone draws the smaller
                        of the two.

                        Only with one probe on screen: rendered for four, the
                        bands overlap into a fog and their extremes drag the
                        axis from 165-385 out to 140-420. */}
                    {shownProbes.length === 1 &&
                      shownProbes.map((s) => (
                        <Area
                          key={`band${s.id}`}
                          dataKey={`${smooth ? "c" : "b"}${s.id}`}
                          stroke="none"
                          fill={style(s.id)}
                          fillOpacity={0.16}
                          isAnimationActive={false}
                          tooltipType="none"
                          legendType="none"
                          connectNulls
                        />
                      ))}
                    {shownProbes.map((s) => (
                      <Line
                        key={s.id}
                        dataKey={`${smooth ? "s" : "t"}${s.id}`}
                        name={s.name}
                        stroke={style(s.id)}
                        strokeDasharray={dash(s.id)}
                        {...SERIES}
                        connectNulls
                      />
                    ))}
                    {/* Drag either handle to zoom into a stretch of the trend. */}
                    <Brush
                      dataKey="ts"
                      height={22}
                      travellerWidth={8}
                      tickFormatter={clockFor(hours)}
                      className="fill-muted"
                      stroke="var(--color-muted-foreground)"
                      onChange={(r) => setZoom([r.startIndex ?? 0, r.endIndex ?? pingRows.length - 1])}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Under the chart: what it covers is picked at the top, what is
                drawn in it is picked here. Recharts paints the brush into the
                same SVG as the axis, so this is as close beneath as HTML
                sits. */}
            {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {pingSeries.map((s) => {
                const shown = !hiddenProbes.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                      shown ? "" : "opacity-40"
                    }`}
                  >
                    {/* The swatch carries the same hue as the line. */}
                    <svg width="14" height="6" className="shrink-0" aria-hidden>
                      <line
                        x1="0"
                        y1="3"
                        x2="14"
                        y2="3"
                        stroke={style(s.id)}
                        strokeWidth="2"
                      />
                    </svg>
                    {s.name}
                    {/* The line is only what answered, so a probe dropping
                        half its packets draws like a healthy one. */}
                    {s.loss > 0 && (
                      <span className="tabular-nums opacity-60">
                        丢 {s.loss < 1 ? "<1" : Math.round(s.loss)}%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            )}
            </Card>
          </div>
        )
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="space-y-5">
          <Panel
            title={hasLoad ? "CPU 与负载" : "CPU"}
            value={
              last && (
                <Reading at={last.ts}>
                  {/* With a load line the header is also the key, as on the memory
                      and rate panels. Without one -- a hub that sends no `load1`
                      -- it goes back to the bare percentage, since a single series
                      named after the panel's own title says nothing. */}
                  {hasLoad && last.load1 !== undefined && last.load1 !== null ? (
                    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <HeaderSeries color="var(--color-chart-1)" name="CPU" value={pct(last.cpu)} />
                      <HeaderSeries color="var(--color-chart-4)" name="负载" value={load(last.load1)} />
                    </span>
                  ) : (
                    pct(last.cpu)
                  )}
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              {/* Composed rather than an area chart: the load average is a second
                  series against a second axis, since a count and a percentage
                  cannot share one scale. No right margin here: the axis below
                  stands in that space, and the panels without one reserve it as a
                  margin so the four plots keep the same x range. */}
              <ComposedChart data={metricRows} margin={{ top: 8, right: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis
                  yAxisId="cpu"
                  {...axes.cpu}
                  unit="%"
                  {...VALUE_AXIS}
                  {...AXIS}
                />
                {hasLoad && (
                  <YAxis
                    yAxisId="load"
                    orientation="right"
                    {...axes.load}
                    tickFormatter={loadTick}
                    width={LOAD_AXIS}
                    {...AXIS}
                  />
                )}
                <Tooltip
                  wrapperStyle={WRAPPER} {...TOOLTIP}
                  // The load row is the one series on this page measured in
                  // something other than the panel's own unit.
                  content={<ChartTooltip format={pct} formats={{ load1: load }} />}
                  // The horizontal line follows the CPU, which is what the panel is
                  // named for, and the chip carries the percentage with it.
                  cursor={<Crosshair domainTop={axes.cpu.domain[1]} format={pct} />}
                />
                <Wash id="cpu-wash" color="var(--color-chart-1)" />
                <Area yAxisId="cpu" dataKey="cpu" name="CPU" stroke="var(--color-chart-1)" fill="url(#cpu-wash)" {...RESOURCE_SERIES} />
                {hasLoad && (
                  // Bridged across a bucket the hub had no load for: before this
                  // field existed every row is null, and a line broken at every
                  // restart would be a shape the machine never had.
                  <Line yAxisId="load" dataKey="load1" name="负载" stroke="var(--color-chart-4)" {...SERIES} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          {/* The axis top is the machine's memory, so the line's height is the
              fraction in use whatever range is picked. Tracking the window's
              own maximum, which is what an area chart does by default, puts
              127 MB of a 457 MB box at the top of the panel. The size is in the
              title because the axis top is claiming it -- and once swap is drawn
              on the same axis that claim no longer covers both lines, so the
              title names the pair and the header carries both capacities. */}
          <Panel
            title={hasSwap ? "内存与 Swap" : `内存 · ${bytes(node.mem_total)}`}
            value={
              last && (
                <Reading at={last.ts}>
                  <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <HeaderSeries
                      color="var(--color-chart-1)"
                      name="内存"
                      value={`${bytes(last.mem_used)} / ${bytes(node.mem_total)}`}
                    />
                    {hasSwap && last.swap_used !== undefined && (
                      <HeaderSeries
                        color="var(--color-chart-4)"
                        name="Swap"
                        value={`${bytes(last.swap_used)} / ${bytes(node.swap_total)}`}
                      />
                    )}
                  </span>
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              {/* Composed rather than an area chart, since swap is a second line
                  on the same axis. A hub without the field sends none of it and
                  only the area is drawn. */}
              <ComposedChart data={metricRows} margin={{ top: 8, right: hasLoad || hasProcs ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, memTop]} ticks={quarters(memTop)} tickFormatter={axisBytes} {...VALUE_AXIS} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER} {...TOOLTIP}
                  content={<ChartTooltip format={bytes} />}
                  cursor={<Crosshair domainTop={memTop} format={bytes} />}
                />
                <Wash id="mem-wash" color="var(--color-chart-1)" />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-1)" fill="url(#mem-wash)" {...RESOURCE_SERIES} />
                {hasSwap && (
                  <Line dataKey="swap_used" name="Swap" stroke="var(--color-chart-4)" {...SERIES} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          {/* A rate has no total to be a fraction of, so this one climbs the
              ladder like CPU rather than pinning to a capacity. */}
          <Panel
            title={peak ? `网络速率 · 整段峰值 ↓ ${rate(peak.rx)} · ↑ ${rate(peak.tx)}` : "网络速率"}
            value={
              last && (
                <Reading at={last.ts}>
                  {/* The two hues carry the direction as well as naming it: this
                      panel draws two lines and had no key at all, so the only way
                      to tell download from upload was to remember which line the
                      tooltip had labelled. */}
                  <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    {/* 这两个数是**最后一个采样点**（`last`）的值，不是峰值，也不是"此刻的瞬时值"。
                        所以名字里点明"末点" —— 同一次读到的还有副标题的"整段峰值"与
                        tooltip 的"本段峰值"，三个口径必须各自说清。 */}
                    <HeaderSeries color="var(--color-chart-1)" name="末点 ↓" value={rate(last.net_rx)} />
                    <HeaderSeries color="var(--color-chart-4)" name="末点 ↑" value={rate(last.net_tx)} />
                  </span>
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              <ComposedChart data={metricRows} margin={{ top: 8, right: hasLoad || hasProcs ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis scale="log" {...axes.rate} tickFormatter={axisBytes} unit="/s" {...VALUE_AXIS} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER} {...TOOLTIP}
                  content={
                    // 均值和峰值并排，因为这条线画的正是均值；行里没有峰值字段
                    // （老 hub）时只报均值，与这些设置都不存在时一样。
                    <ChartTooltip
                      format={rate}
                      pick={(item) => item.payload?.[`net_${String(item.dataKey)}`] as number | undefined}
                      hint={(item) => {
                        // ⚠️ 两条线的 dataKey 是 `rx` / `tx`，**不是** `net_rx` —— 旧写法
                        // 恒假，于是下行那行的「本段峰值」一直是上行峰值。
                        const max = item.payload?.[`net_${String(item.dataKey)}_max`]
                        return peak && typeof max === "number" ? `本段峰值 ${rate(max)}` : undefined
                      }}
                    />
                  }
                  cursor={
                    <Crosshair
                      domainTop={axes.rate.domain[1]}
                      domainBottom={axes.rate.domain[0]}
                      format={rate}
                      pickValue={rateCrosshair}
                    />
                  }
                />
                {/* 均值到峰值那条带。一分钟的突发在一天的轴上不到一像素宽，只填色
                    看不见，所以上沿描一道虚线；虚线而不是淡边，是因为两条速率靠色
                    阶区分，淡边会取到另一条线的颜色。 */}
                {peak && (
                  <>
                    <Area
                      dataKey="rx_band"
                      stroke="var(--color-chart-1)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      fill="var(--color-chart-1)"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                      tooltipType="none"
                      legendType="none"
                    />
                    <Area
                      dataKey="tx_band"
                      stroke="var(--color-chart-4)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      fill="var(--color-chart-4)"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                      tooltipType="none"
                      legendType="none"
                    />
                  </>
                )}
                {/* Two lines, so two hues -- and the same pair the summary's
                    sparkline uses for the same two directions. */}
                <Line dataKey="rx" name="下行" stroke="var(--color-chart-1)" {...RESOURCE_SERIES} />
                <Line dataKey="tx" name="上行" stroke="var(--color-chart-4)" {...RESOURCE_SERIES} />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          {/* The disk it is filling, for the same reason as memory: a node
              using 2.7% of its disk draws along the top of the panel when the
              axis tracks the window's own maximum. */}
          <Panel
            title={`硬盘 · ${bytes(node.disk_total)}`}
            value={
              last && (
                <Reading at={last.ts}>
                  <HeaderSeries
                    color="var(--color-chart-1)"
                    name="已用"
                    value={`${bytes(last.disk_used)} / ${bytes(node.disk_total)}`}
                  />
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              <AreaChart data={metricRows} margin={{ top: 8, right: hasLoad || hasProcs ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, node.disk_total]} ticks={quarters(node.disk_total)} tickFormatter={axisBytes} {...VALUE_AXIS} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER} {...TOOLTIP}
                  content={<ChartTooltip format={bytes} />}
                  cursor={<Crosshair domainTop={node.disk_total} format={bytes} />}
                />
                <Wash id="disk-wash" color="var(--color-chart-1)" />
                <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-1)" fill="url(#disk-wash)" {...RESOURCE_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* ⭐ **连接与进程** ✓✓ —— hub 23 → 24 那次迁移之后，历史行也带这三列了
              （此前只有实时帧里有）。TCP 与 UDP 同轴（都是连接数，量级接近），
              进程数走右轴：它通常几百，而连接数几十，同轴会把连接线压成贴地的一条 ——
              与 CPU 那张给 load 开右轴同一个理由。
              ⚠️ 老的小时行是 `null`（迁移前折出来的），所以线会**断开**而不是连成 0 ✓。 */}
          <Panel
            title="连接与进程"
            value={
              last && (
                <Reading at={last.ts}>
                  <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <HeaderSeries
                      color="var(--color-chart-1)"
                      name="TCP"
                      value={last.tcp == null ? "—" : `${last.tcp}`}
                    />
                    <HeaderSeries
                      color="var(--color-chart-4)"
                      name="UDP"
                      value={last.udp == null ? "—" : `${last.udp}`}
                    />
                    <HeaderSeries
                      color="var(--color-chart-2)"
                      name="进程"
                      value={last.procs == null ? "—" : `${last.procs}`}
                    />
                  </span>
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              {/* ⚠️ `right: 0` 是**对的** ✓：这张自己画了右轴，recharts 会替它让出那一段宽度；
                  再写 `LOAD_AXIS` 就等于预留两次 ⇒ 右边多出一条白带（实测过 ✗）。
                  上面四张写 `LOAD_AXIS` 是另一回事：它们**没有**右轴，那 36px 是替
                  「有右轴的那张」对齐用的（见 CPU 那张 margin 的注释）。 */}
              <ComposedChart data={metricRows} margin={{ top: 8, right: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                {/* ⚠️ `allowDecimals={false}`：连接数是整数，默认的刻度会给 11.25 这种。 */}
                <YAxis
                  yAxisId="conn"
                  domain={[0, connTop]}
                  allowDecimals={false}
                  {...VALUE_AXIS}
                  {...AXIS}
                />
                {hasProcs && (
                  <YAxis
                    yAxisId="procs"
                    orientation="right"
                    domain={[0, procsTop]}
                    allowDecimals={false}
                    width={LOAD_AXIS}
                    {...AXIS}
                  />
                )}
                <Tooltip
                  wrapperStyle={WRAPPER} {...TOOLTIP}
                  content={<ChartTooltip format={(n: number) => `${n}`} />}
                  cursor={<Crosshair domainTop={connTop} format={(n: number) => `${n}`} />}
                />
                {hasTcp && (
                  <>
                    {/* ⚠️ 与上面四张同一个写法 ✓：**主序列走面积 + 渐变阴影**（`Wash`），
                        其余序列走线 ✓。少了这层阴影，这一张在视觉上就"缺一块" ✗。 */}
                    <Wash id="conn-wash" color="var(--color-chart-1)" />
                    <Area
                      yAxisId="conn"
                      dataKey="tcp"
                      name="TCP"
                      stroke="var(--color-chart-1)"
                      fill="url(#conn-wash)"
                      {...SERIES}
                    />
                  </>
                )}
                {hasUdp && (
                  <Line yAxisId="conn" dataKey="udp" name="UDP" stroke="var(--color-chart-4)" {...SERIES} />
                )}
                {hasProcs && (
                  <Line yAxisId="procs" dataKey="procs" name="进程" stroke="var(--color-chart-2)" {...SERIES} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  )
}
