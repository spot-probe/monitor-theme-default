import { useRef, useState } from "react"
import { Info } from "lucide-react"

import { Swatch } from "@/components/ChartTooltip"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  availabilityText, calendarCells, missingMinutes, minuteLabel, outageLength, SLOT_HOURS, SLOTS_PER_DAY,
  segmentSpan, segmentText, stillDown, TONE_CLASS, TONE_LABEL, windowLabel,
  type Availability, type Cell, type Incident, type Segment, type Tone,
} from "@/lib/uptime"

/**
 * How many outages are listed before the rest are counted instead. A node that
 * flapped through a week can carry dozens, and the bar above already shows where
 * they were; the list is here to name the ones that matter, not to enumerate them.
 */
const LISTED = 6

/** The legend's order: the states a reader looks for, least-informed last. */
const LEGEND: Tone[] = ["ok", "warn", "down", "unknown"]

/** 行的标签：周一在第一行（与 `calendarCells` 的布局一致）。 */
const WEEKDAY = ["一", "二", "三", "四", "五", "六", "日"]

/** 列的标签：每格的起始小时（4 小时一格 ⇒ 00 04 08 12 16 20）。 */
// 24 列全都写标签会挤成一团 ⇒ **每 4 小时写一个**（00 04 08 …），其余留空占位以对齐。
const SLOT_LABELS = Array.from({ length: SLOTS_PER_DAY }, (_, i) =>
  Number.isInteger(i * SLOT_HOURS) && (i * SLOT_HOURS) % 4 === 0
    ? String(i * SLOT_HOURS).padStart(2, "0")
    : "",
)

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

/**
 * What one segment says, over the bar. The same words reach a screen reader.
 *
 * `step` is the segment's width in hours, so a three-hour or day-wide segment is
 * named by the stretch it covers rather than by the instant it starts at; the
 * minute count underneath is exact either way, which is what keeps the coarse bar
 * from hiding a twelve-minute outage inside a day.
 */
function Hover({ segment, step, left }: { segment: Segment; step: number; left: string }) {
  return (
    <div
      role="tooltip"
      style={{ left }}
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 w-56 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-pop"
    >
      <div className="tnum font-medium">{segmentSpan(segment.ts, step)}</div>
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
  // ⚠️ 时间轴固定看**最近一周** ✓、步长固定**一小时** ✓（168 格 ✓）——
  // 这本来就是它注释里写的意图（"covers a fixed week" ✓），只是代码此前跟着
  // **保留期**走 ✗ ⇒ 保留期设成 90 天时，格子会粗到一天一格、还要往回铺 90 天空格 ✗。

  const windowHours = Math.min(hours, 168)
  // ⚠️ 步长**由这一周的窗口推**（不是写死 ✓）：`stepHours(168)` = **3 小时** ✓
  // ⇒ 一格 = **180 分钟** ✓ —— 满 180 分钟为绿 ✓、缺任何一分钟为「部分异常 · 上报 N/180」✓
  //（这套语义 `segmentTone`/`segmentText` 本来就有 ✓，我先前写死 1 小时把它盖掉了 ✓✗）。
  // ⚠️ 关键是 `windowHours` 已经封顶一周 ✓ ⇒ 推出来的步长与保留期无关 ✓
  //（保留期 90 天时原来是"一天一格 + 往回铺 90 天空格" ✓✗，现在不会了 ✓）。
  const cells = calendarCells(data, windowHours)
  // 提示框与无障碍标签仍然吃 `Segment` 那一套（状态文案、区间文案都在 `uptime.ts` 里，
  // 不在这里重写一遍 —— 页面只有一套说法 ✓）。
  const asSegment = (c: Cell): Segment => ({ ts: c.ts, n: c.n, m: c.m, known: c.tone !== "unknown" })
  // The width of one segment, in hours, for labelling it. Coarser than an hour
  // whenever the window is long enough that hourly strips would be unreadable:
  // a week is 3-hour segments, a month is 12-hour ones.

  // Only the measured buckets count towards the figure: the padded hours carry an
  // `m` of their own but nothing was expected of them, and dividing by them would
  // report a node added yesterday as broken.
  const expected = data.buckets.reduce((sum, b) => sum + b.m, 0)
  const reported = data.buckets.reduce((sum, b) => sum + b.n, 0)
  const fraction = expected > 0 ? reported / expected : 1
  const down = missingMinutes(data.buckets)
  const recent = [...incidents].reverse()
  // One wording for the fault summary, used by the line under the title and by the
  // bar's own label, so the two cannot drift apart. When there are none the line
  // is not drawn at all: no faults is the same statement as the 100% printed
  // beside it -- the hub derives its outages from the missing minutes, and the
  // ratio is exactly those minutes over the window -- so the row would repeat the
  // figure in words and cost every healthy node a line of height.
  const faults = incidents.length === 0 ? "没有故障" : `${incidents.length} 次故障 · 共 ${outageLength(down)}`
  // Where the pointer or the keyboard is. `cursor` is the tab stop -- one segment
  // carries it, so the bar is one stop in the page's tab order rather than 168 of
  // them, and the arrow keys walk the rest.
  const [active, setActive] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const bar = useRef<HTMLDivElement>(null)

  const move = (event: React.KeyboardEvent, i: number) => {
    // 网格是 7 行 × 6 列：左右走一格、上下走一行（±6）。仍然是一个 tab 停靠。
    const next =
      event.key === "ArrowRight" ? i + 1
      : event.key === "ArrowLeft" ? i - 1
      : event.key === "ArrowDown" ? i + SLOTS_PER_DAY
      : event.key === "ArrowUp" ? i - SLOTS_PER_DAY
      : event.key === "Home" ? 0
      : event.key === "End" ? cells.length - 1
      : null
    if (next === null) return
    event.preventDefault()
    const index = Math.max(0, Math.min(cells.length - 1, next))
    setCursor(index)
    setActive(index)
    const items = bar.current?.children
    const target = items?.[index]
    if (target instanceof HTMLElement) target.focus()
  }

  const shown = active === null ? null : asSegment(cells[active])
  // Centred on its segment, then pulled inside the card: a tooltip centred on the
  // first or last hour would otherwise hang off the edge, and the hour it belongs
  // to is still the nearest one to it.
  const left =
    active === null
      ? "0"
      // 横向按**列**居中（问的是第几列，不是"第几格"）：`active % 6`。
      : `clamp(0px, calc(${((((active % SLOTS_PER_DAY) + 0.5) / SLOTS_PER_DAY) * 100).toFixed(3)}% - ${TOOLTIP} / 2), calc(100% - ${TOOLTIP}))`

  return (
    <Card className="gap-0 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          在线状态日历
          {/* A button, not the icon alone: it is focusable, so the explanation is
              reachable without a pointer, and its 24px target is one a reader can
              hit. The negative margin pulls it back onto the title's baseline,
              leaving the glyph where a bare 12px icon sat. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="统计口径与颜色说明"
                className="-m-1.5 grid size-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="leading-relaxed">
                按格统计：每格是四小时，格内每分钟都应有一条上报记录，缺一分钟即计为未上报。悬停或聚焦某一格可看该格的实际分钟数；方向键可逐格走。
              </p>
              {/* The four colours again, in the same shape the legend uses: the
                  key belongs beside the rule that produced it, and a reader who
                  opened this rather than reading the row below should not have to
                  close it to find out what orange means. */}
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                {LEGEND.map((tone) => (
                  <li key={tone} className="inline-flex items-center gap-1.5">
                    <Swatch className={TONE_CLASS[tone]} />
                    {TONE_LABEL[tone]}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </h4>
        <p className="text-sm">
          <span className="text-xs text-muted-foreground">{windowLabel(from, to)}正常率 </span>
          <span className="tnum font-medium">{availabilityText(fraction)}</span>
        </p>
        {incidents.length > 0 && (
          <p className="w-full text-xs text-muted-foreground">{faults}</p>
        )}
      </div>

      {/* ⭐ **7 × 6 的日历格** ✓（周一…周日 × 每 4 小时）—— 换掉原来那条 56 格的横条。
          横条只能看出"哪几天有事"；日历格能看出"**每天哪个时段**不稳"，
          例如"每天凌晨 2–6 点掉线"在这张图上立刻可见 ✓。
          ⚠️ 交互没有退化 ✓：仍然是**一个 tab 停靠 + 方向键走格**（左右 ±1 格、上下 ±6 格），
          42 个格子不会变成 42 个 tab 停靠。 */}
      <div
        ref={bar}
        role="group"
        aria-label={`在线状态日历，${windowLabel(from, to)}，正常率 ${availabilityText(fraction)}，` +
          `${faults}。用方向键逐格查看`}
        className="relative mt-3"
        onMouseLeave={() => setActive(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null)
        }}
      >
        <div className="flex gap-1.5">
          {/* 行的标签：周一到周日。只占一格宽，字号与刻度同档。 */}
          <div className="grid shrink-0 grid-rows-[repeat(7,1.5rem)] gap-1 text-[10px] leading-none text-muted-foreground">
            {WEEKDAY.map((w) => (
              <span key={w} className="grid w-4 place-items-center">
                {w}
              </span>
            ))}
          </div>
          {/* ⚠️ 宽度**限住**：24 列铺满整卡时每格 ≈50px（方的话 7 行就 350px 高 ✗），
                压扁又变成横条 ✗。GitHub 那种"又小又宽"靠的是**列多**（一整年 53 列），
                7 天 × 每小时只有 24 列 ⇒ 只能二者取一。
                这里取"接近小方块"：限到 42rem ⇒ 每格约 26×20px ✓。 */}
            <div className="min-w-0 flex-1">
            <div className="grid grid-cols-[repeat(48,minmax(0,1fr))] gap-1">
              {cells.map((c, i) => (
                <div
                  key={`${c.weekday}-${c.slot}`}
                  role="img"
                  tabIndex={i === cursor ? 0 : -1}
                  aria-label={`${segmentSpan(c.ts, SLOT_HOURS)}，${segmentText(asSegment(c))}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => {
                    setActive(i)
                    setCursor(i)
                  }}
                  onKeyDown={(e) => move(e, i)}
                  className={cn(
                    // ⚠️ 尺寸的两次教训都在这里 ✗：
                    //   · `aspect-square` + `w-full` ⇒ 每格 = 卡片宽/6（≈300px），
                    //     高度跟着算出来 ⇒ 整张卡被撑成一屏多高 ✗；
                    //   · 只把高度固定、宽度仍 `w-full` ⇒ 每行变成一根长条 ✗。
                    // ⇒ 固定边长：24px 方块，和 GitHub 那套热力图一个语汇 ✓。
                    "h-5 w-full rounded-[4px] outline-offset-1 " +
                      "focus-visible:outline-2 focus-visible:outline-ring",
                    TONE_CLASS[c.tone],
                    i === active && "ring-1 ring-ring ring-inset",
                  )}
                />
              ))}
            </div>
            {/* 列的标签：每格的起始小时。 */}
            <div className="mt-1 grid grid-cols-[repeat(48,minmax(0,1fr))] gap-1 text-[10px] leading-none text-muted-foreground">
              {SLOT_LABELS.map((s) => (
                <span key={s} className="tnum text-center">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
        {shown && <Hover segment={shown} step={SLOT_HOURS} left={left} />}
      </div>

      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span className="tnum">{minuteLabel(from)}</span>
        <span className="tnum">{minuteLabel(to)}</span>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((tone) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <Swatch className={TONE_CLASS[tone]} />
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
