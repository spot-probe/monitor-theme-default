import { useEffect, useMemo, useState } from "react"
import { median } from "d3-array"
import { ArrowLeft } from "lucide-react"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { AvailabilityCard } from "@/components/Availability"
import { ChartTooltip, Crosshair, Swatch } from "@/components/ChartTooltip"
import { Country, Status } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, clockFor, quarters, cpuName, CYCLES, FOREVER, money, osName, rate, stamp, timeTicks,
} from "@/lib/format"
import type { Availability } from "@/lib/uptime"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
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

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

// Latency stops at a day. A week-wide bucket would still carry the spread and the
// loss figure, but a week of probe history is outside this page's purpose, and
// these are the windows in which every ping remains on the chart.
const RANGES_FOR = { resources: RANGES, latency: RANGES.filter((r) => r.hours <= 24) }

/**
 * How much of the past the availability timeline covers, in hours.
 *
 * A week, and fixed: the range selector above the charts picks what *they* draw,
 * and a timeline that resized with it would answer a different question each time
 * it moved. Seven days is also the most an anonymous caller may ask the hub for,
 * and what the hub retains by default.
 */
const AVAILABILITY_HOURS = 168

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

// Recharts eases its tooltip after the pointer over 400ms. Left on, the box lags
// behind the crosshair by most of a second on a fast drag, so the two read as two
// different readings of the same instant; the crosshair is what says where the
// pointer is, and it is exact.
const WRAPPER = { transition: "none" }

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the four plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
const Y_WIDTH = 68

// The CPU panel is the only one with a second axis, and that axis costs the plot
// width it stands on. The other three reserve the same width as a right margin, so
// all four plots keep one x range and a CPU spike stays in the same column as the
// network spike that caused it -- which is the whole reason `Y_WIDTH` is a single
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
 * Hampel filter (Hampel 1974; MATLAB ships it as `hampel`). A point more than
 * `sigmas` robust deviations from its window's median is replaced by that median,
 * while everything else passes through unchanged, which is what distinguishes it
 * from a rolling median or a moving average.
 *
 * 1.4826 rescales the median absolute deviation to a standard deviation for
 * normally distributed data; 3 sigma is the conventional cut.
 */
function despike(points: PingPoint[], window = 7, sigmas = 3): PingPoint[] {
  const half = window >> 1
  // ponytail: recomputes the window per point. A few thousand samples is
  // negligible; substitute a rolling structure if a chart ever needs 100k.
  return points.map((p, i) => {
    // A timeout is a gap rather than a high reading: neither smoothed, nor counted
    // towards what its neighbours are compared against.
    if (p.latency === null) return p
    const near = points
      .slice(Math.max(0, i - half), i + half + 1)
      .map((x) => x.latency)
      .filter((v) => v !== null)
    const mid = median(near) ?? p.latency
    const mad = median(near.map((v) => Math.abs(v - mid))) ?? 0
    const outlier = mad > 0 && Math.abs(p.latency - mid) > sigmas * 1.4826 * mad
    return outlier ? { ...p, latency: mid } : p
  })
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

export function NodeDetail({ node, onBack }: { node: Node; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
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
  // Where the brush has been dragged, so the axis reticks for the visible span
  // rather than retaining the whole window's ticks.
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  // Where the chart begins on screen, so its height can occupy the remainder.
  const [chartTop, setChartTop] = useState(0)
  // The availability timeline, fetched apart from the charts below: it covers a
  // fixed week rather than the range picked above it, since the range selector is
  // for the charts and a timeline that changed width with it would be a different
  // question. A week is also all an anonymous caller may ask for, and it matches
  // the hub's default retention. `null` while it is in flight, or if the hub is
  // older than the feature, and no card is drawn for either.
  const [avail, setAvail] = useState<Availability | null>(null)

  useEffect(() => {
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect
    setAvail(null)
    api<{ availability: Availability | null }>(
      `/nodes/${node.id}/metrics?hours=${AVAILABILITY_HOURS}&series=availability`,
    )
      .then((next) => { if (active) setAvail(next.availability ?? null) })
      // No error of its own: the bar is an addition to this screen, and the charts
      // below report a failed read in the page's own words. A refused or missing
      // bar therefore leaves the page otherwise intact.
      .catch(() => { if (active) setAvail(null) })
    return () => { active = false }
  }, [node.id])

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
  const metricRows = useMemo(
    () => (data?.metrics ?? []).map((m) => ({ ...m, ts: m.ts * 1_000 })),
    [data],
  )

  // Axis tops for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    return {
      // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
      // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
      cpu: axisTop(max((m) => m.cpu), 4, 10, 100),
      // Base 1024, so the steps are round in the unit `axisBytes` prints.
      rate: axisTop(max((m) => Math.max(m.net_rx, m.net_tx)), 1024, 1024),
      // A load average has no capacity to be a fraction of, so it climbs a ladder
      // too -- but its floor is a quarter rather than the CPU's 4%: these are
      // counts, not percentages, and 0.25 is where a quiet single-core box sits.
      // Absolute load rather than load per core, as the panel's own reading.
      load: axisTop(max((m) => m.load1 ?? 0), 0.25, 10),
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

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed on the full list, so a line keeps its shade when others are hidden.
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

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
      const smoothed = despike(s.points)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i].latency
        row[`l${s.id}`] = p.loss ?? 0
        // Raw, never despiked: the band exists to show what the line omits, and
        // smoothing it would omit the same points.
        row[`b${s.id}`] = p.band ?? null
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  // A real time axis rather than the category axis recharts defaults to: on a
  // category axis ticks are selected by index, so a period the agent was offline
  // for collapses to nothing.
  const timeAxis = (rows: { ts: number }[], from = 0, to = rows.length - 1) => ({
    dataKey: "ts",
    type: "number" as const,
    domain: ["dataMin", "dataMax"] as const,
    // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
    // are dropped by `minTickGap`.
    ticks: rows.length ? timeTicks(rows[from].ts, rows[to].ts) : undefined,
    tickFormatter: clockFor(hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  })

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
              ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}`
              : "免费",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].join(" · ")}
        />
        </dl>
      </Card>

      {avail && <AvailabilityCard data={avail} hours={AVAILABILITY_HOURS} />}

      {node.remark && (
        <Card className="gap-0 border-dashed bg-muted/40 p-4">
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
        <Segmented
          label="时间范围"
          value={hours}
          onChange={(next) => setRanges((all) => ({ ...all, [tab]: next }))}
          items={RANGES_FOR[tab].map((r) => ({ value: r.hours, label: r.label }))}
        />
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
        <Skeleton className="h-40 w-full" />
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
            ref={(el) => {
              if (el) setChartTop(el.getBoundingClientRect().top + scrollY)
            }}
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
                      wrapperStyle={WRAPPER}
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
                          dataKey={`b${s.id}`}
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
              <ComposedChart data={metricRows} margin={{ right: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis
                  yAxisId="cpu"
                  domain={[0, tops.cpu]}
                  ticks={quarters(tops.cpu)}
                  unit="%"
                  width={Y_WIDTH}
                  {...AXIS}
                />
                {hasLoad && (
                  <YAxis
                    yAxisId="load"
                    orientation="right"
                    domain={[0, tops.load]}
                    ticks={quarters(tops.load)}
                    tickFormatter={loadTick}
                    width={LOAD_AXIS}
                    {...AXIS}
                  />
                )}
                <Tooltip
                  wrapperStyle={WRAPPER}
                  // The load row is the one series on this page measured in
                  // something other than the panel's own unit.
                  content={<ChartTooltip format={pct} formats={{ load1: load }} />}
                  // The horizontal line follows the CPU, which is what the panel is
                  // named for, and the chip carries the percentage with it.
                  cursor={<Crosshair domainTop={tops.cpu} format={pct} />}
                />
                <Wash id="cpu-wash" color="var(--color-chart-1)" />
                <Area yAxisId="cpu" dataKey="cpu" name="CPU" stroke="var(--color-chart-1)" fill="url(#cpu-wash)" {...SERIES} />
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
              <ComposedChart data={metricRows} margin={{ right: hasLoad ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, memTop]} ticks={quarters(memTop)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER}
                  content={<ChartTooltip format={bytes} />}
                  cursor={<Crosshair domainTop={memTop} format={bytes} />}
                />
                <Wash id="mem-wash" color="var(--color-chart-1)" />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-1)" fill="url(#mem-wash)" {...SERIES} />
                {hasSwap && (
                  <Line dataKey="swap_used" name="Swap" stroke="var(--color-chart-4)" {...SERIES} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          {/* A rate has no total to be a fraction of, so this one climbs the
              ladder like CPU rather than pinning to a capacity. */}
          <Panel
            title="网络速率"
            value={
              last && (
                <Reading at={last.ts}>
                  {/* The two hues carry the direction as well as naming it: this
                      panel draws two lines and had no key at all, so the only way
                      to tell download from upload was to remember which line the
                      tooltip had labelled. */}
                  <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <HeaderSeries color="var(--color-chart-1)" name="↓" value={rate(last.net_rx)} />
                    <HeaderSeries color="var(--color-chart-4)" name="↑" value={rate(last.net_tx)} />
                  </span>
                </Reading>
              )
            }
          >
            <ResponsiveContainer>
              <LineChart data={metricRows} margin={{ right: hasLoad ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, tops.rate]} ticks={quarters(tops.rate)} tickFormatter={axisBytes} unit="/s" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER}
                  content={<ChartTooltip format={rate} />}
                  cursor={<Crosshair domainTop={tops.rate} format={rate} />}
                />
                {/* Two lines, so two hues -- and the same pair the summary's
                    sparkline uses for the same two directions. */}
                <Line dataKey="net_rx" name="下行" stroke="var(--color-chart-1)" {...SERIES} />
                <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-4)" {...SERIES} />
              </LineChart>
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
              <AreaChart data={metricRows} margin={{ right: hasLoad ? LOAD_AXIS : 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, node.disk_total]} ticks={quarters(node.disk_total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  wrapperStyle={WRAPPER}
                  content={<ChartTooltip format={bytes} />}
                  cursor={<Crosshair domainTop={node.disk_total} format={bytes} />}
                />
                <Wash id="disk-wash" color="var(--color-chart-1)" />
                <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-1)" fill="url(#disk-wash)" {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  )
}
