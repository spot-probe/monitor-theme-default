import { useRef, useState } from "react"
import { Info } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  availabilityText, missingMinutes, minuteLabel, outageLength, segmentText, segmentsFor, segmentTone,
  stillDown, TONE_CLASS, TONE_LABEL, windowLabel,
  type Availability, type Incident, type Segment, type Tone,
} from "@/lib/uptime"

/**
 * How many outages are listed before the rest are counted instead. A node that
 * flapped through a week can carry dozens, and the bar above already shows where
 * they were; the list is here to name the ones that matter, not to enumerate them.
 */
const LISTED = 6

/** The legend's order: the states a reader looks for, least-informed last. */
const LEGEND: Tone[] = ["ok", "warn", "down", "unknown"]

/** The tooltip's width, so its position can be clamped to the card. */
const TOOLTIP = "14rem"

/**
 * One outage, as the note asks for it: "8月20日 14:02 起离线 12 分钟".
 *
 * An outage that runs to the end of the window may be over or may be happening,
 * and the hub cannot tell the two apart -- so it says "至今", which is true
 * either way rather than a claim of recovery the data does not support.
 */
function Outage({ incident, to }: { incident: Incident; to: number }) {
  const open = stillDown(incident, to)
  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 translate-y-px rounded-full", open ? TONE_CLASS.down : TONE_CLASS.warn)}
      />
      <span className="tnum shrink-0">{minuteLabel(incident.start)}</span>
      <span className="text-muted-foreground">
        {open ? `起离线至今（已 ${outageLength(incident.minutes)}）` : `起离线 ${outageLength(incident.minutes)}`}
      </span>
    </li>
  )
}

/** What one segment says, over the bar. The same words reach a screen reader. */
function Hover({ segment, left }: { segment: Segment; left: string }) {
  return (
    <div
      role="tooltip"
      style={{ left }}
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 w-56 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-pop"
    >
      <div className="tnum font-medium">{minuteLabel(segment.ts)}</div>
      <div className="text-muted-foreground">{segmentText(segment)}</div>
    </div>
  )
}

/**
 * The availability bar, its legend and the outages beneath it.
 *
 * The window is whatever the hub measured and reported, printed from `from`/`to`
 * rather than assumed to be a week: under a retention shorter than the request the
 * hub clamps its answer, and a header that said "近 7 天" over three days of
 * measurements would be the one lie this card can tell.
 *
 * `hours` is what the page asked the hub for. The bar is drawn over that whole
 * span, with the part the hub had nothing for shown as "无数据" rather than left
 * out, so a node added yesterday is visibly a node added yesterday.
 */
export function AvailabilityCard({ data, hours }: { data: Availability; hours: number }) {
  const { from, to, incidents } = data
  const segments = segmentsFor(data, hours)
  // Only the measured buckets count towards the figure: the padded hours carry an
  // `m` of their own but nothing was expected of them, and dividing by them would
  // report a node added yesterday as broken.
  const expected = data.buckets.reduce((sum, b) => sum + b.m, 0)
  const reported = data.buckets.reduce((sum, b) => sum + b.n, 0)
  const fraction = expected > 0 ? reported / expected : 1
  const down = missingMinutes(data.buckets)
  const recent = [...incidents].reverse()
  // One wording for the fault summary, used by the line under the title and by the
  // bar's own label, so the two cannot drift apart.
  const faults = incidents.length === 0 ? "没有故障" : `${incidents.length} 次故障 · 共 ${outageLength(down)}`
  // Where the pointer or the keyboard is. `cursor` is the tab stop -- one segment
  // carries it, so the bar is one stop in the page's tab order rather than 168 of
  // them, and the arrow keys walk the rest.
  const [active, setActive] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const bar = useRef<HTMLDivElement>(null)

  const move = (event: React.KeyboardEvent, i: number) => {
    const next =
      event.key === "ArrowRight" ? i + 1
      : event.key === "ArrowLeft" ? i - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? segments.length - 1
      : null
    if (next === null) return
    event.preventDefault()
    const index = Math.max(0, Math.min(segments.length - 1, next))
    setCursor(index)
    setActive(index)
    const items = bar.current?.children
    const target = items?.[index]
    if (target instanceof HTMLElement) target.focus()
  }

  const shown = active === null ? null : segments[active]
  // Centred on its segment, then pulled inside the card: a tooltip centred on the
  // first or last hour would otherwise hang off the edge, and the hour it belongs
  // to is still the nearest one to it.
  const left =
    active === null
      ? "0"
      : `clamp(0px, calc(${(((active + 0.5) / segments.length) * 100).toFixed(3)}% - ${TOOLTIP} / 2), calc(100% - ${TOOLTIP}))`

  return (
    <Card className="gap-0 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          在线状态时间轴
          <span
            role="img"
            title="按小时统计：该小时内每分钟都应有一条上报记录，缺一分钟即计为未上报"
            aria-label="按小时统计：该小时内每分钟都应有一条上报记录，缺一分钟即计为未上报"
            className="inline-flex"
          >
            <Info className="size-3" />
          </span>
        </h4>
        <p className="text-sm">
          <span className="text-xs text-muted-foreground">{windowLabel(from, to)}正常率 </span>
          <span className="tnum font-medium">{availabilityText(fraction)}</span>
        </p>
        <p className="w-full text-xs text-muted-foreground">
          {faults}
        </p>
      </div>

      {/* One segment per hour, each focusable and each carrying its own reading:
          hovering is the quick path, and the arrow keys are the one that also
          works without a pointer. The bar is a group with its own summary, so a
          screen reader landing on it is told what it is before walking it. */}
      <div
        ref={bar}
        role="group"
        aria-label={`在线状态时间轴，${windowLabel(from, to)}，正常率 ${availabilityText(fraction)}，` +
          `${faults}。用左右方向键逐小时查看`}
        className="relative mt-3 flex h-6 gap-px"
        onMouseLeave={() => setActive(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null)
        }}
      >
        {segments.map((s, i) => (
          <div
            key={s.ts}
            role="img"
            tabIndex={i === cursor ? 0 : -1}
            aria-label={`${minuteLabel(s.ts)}，${segmentText(s)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => {
              setActive(i)
              setCursor(i)
            }}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "min-w-px flex-1 outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring",
              TONE_CLASS[segmentTone(s)],
              i === active && "ring-1 ring-ring ring-inset",
              i === 0 && "rounded-l-md",
              i === segments.length - 1 && "rounded-r-md",
            )}
          />
        ))}
        {shown && <Hover segment={shown} left={left} />}
      </div>

      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span className="tnum">{minuteLabel(from)}</span>
        <span className="tnum">{minuteLabel(to)}</span>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((tone) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-[2px]", TONE_CLASS[tone])} />
            {TONE_LABEL[tone]}
          </li>
        ))}
      </ul>

      {recent.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {recent.slice(0, LISTED).map((i) => (
            <Outage key={i.start} incident={i} to={to} />
          ))}
          {recent.length > LISTED && (
            <li className="text-muted-foreground">另外 {recent.length - LISTED} 次故障</li>
          )}
        </ul>
      )}
    </Card>
  )
}
