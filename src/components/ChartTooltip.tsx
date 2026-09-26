import { chipWidth, crosshairY } from "@/lib/chart"
import { stamp } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * What a chart says on hover, and the lines that say where the pointer is.
 *
 * The panels used to inherit recharts' own tooltip, which is styled in its source
 * rather than by the theme: a white box with a grey border and black text, in
 * both schemes. On the dark page that is a white rectangle over the plot -- the
 * one element on the page that did not follow the theme -- and it has no room for
 * the labels this page prints in Chinese. One card, built from the same tokens as
 * everything else, replaces all five.
 */

/**
 * One row of a tooltip: the series' own hue, its name and its reading.
 *
 * A hue rather than a dash pattern, because that is what the line beside it is
 * drawn with, and `hint` for what the reading does not say on its own -- a
 * probe's packet loss, when a bucket had one.
 */
export type Row = { color?: string; label: string; value: string; hint?: string }

/** The colour key shared by a tooltip's rows, a panel header and the bar's legend. */
export function Swatch({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-[2px]", className)}
      style={color ? { background: color } : undefined}
    />
  )
}

export function TooltipCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-pop">
      <div className="tnum font-medium">{title}</div>
      <dl className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-1.5">
            <Swatch color={row.color} />
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tnum ml-auto pl-3 font-medium">
              {row.value}
              {row.hint && <span className="font-normal text-muted-foreground"> {row.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** What recharts hands a custom `content`, as much of it as this page reads. */
type PayloadItem = {
  name?: string | number
  value?: number | string | null
  stroke?: string
  color?: string
  fill?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

/**
 * The tooltip recharts draws, as the page's own card.
 *
 * `format` is the panel's own unit -- `bytes`, `rate`, a percentage -- so the one
 * component serves panels that measure different things without knowing which it
 * is drawing. Note the filter that precedes it: recharts passes a row for every
 * series in the chart, including the ones this bucket had no reading for, and a
 * tooltip listing "内存 —" would read as a measurement of nothing.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  hint,
  nullText,
}: {
  active?: boolean
  payload?: PayloadItem[]
  label?: number | string
  format: (value: number) => string
  hint?: (item: PayloadItem) => string | undefined
  /**
   * What a series with no reading is called. Only reached on a chart that turns
   * recharts' `filterNull` off: with it on -- the default -- a null-valued entry
   * is dropped from the payload before the content sees it, and a bucket every
   * probe timed out in leaves the payload empty, at which point recharts hides
   * the whole tooltip (`TooltipBoundingBox` shows itself on `hasPayload`).
   */
  nullText?: string
}) {
  if (!active || !payload?.length) return null
  const rows: Row[] = []
  for (const item of payload) {
    // `undefined` is a series with no sample in this bucket and `null` one whose
    // sample was a timeout: the hub omits the first and sends the second, and only
    // the second has a reading to name.
    if (item.value === undefined) continue
    const value = typeof item.value === "number" && Number.isFinite(item.value) ? item.value : null
    if (value === null && nullText === undefined) continue
    rows.push({
      // The gradient an area is filled with is a `url(#…)` reference, not a
      // colour, so the stroke is asked for first -- it is what the line is drawn
      // in and what the reader matches against.
      color: item.stroke ?? item.color ?? (typeof item.fill === "string" && !item.fill.startsWith("url(") ? item.fill : undefined),
      label: String(item.name ?? item.dataKey ?? ""),
      value: value === null ? (nullText as string) : format(value),
      hint: value === null ? undefined : hint?.(item),
    })
  }
  if (rows.length === 0) return null
  return <TooltipCard title={typeof label === "number" ? stamp(label) : String(label ?? "")} rows={rows} />
}

/** Where one cursor point sits, in the chart's own coordinates. */
type CursorPoint = { x: number; y: number }

/**
 * The crosshair: a dashed line down the hovered bucket, a dashed line across at
 * its reading, and that reading printed at the plot's edge.
 *
 * Drawn by recharts as the tooltip's cursor, which is the reason it costs no
 * state: a custom cursor is cloned with the active point, the payload and the
 * plot's own frame (`Cursor.js`), so the whole thing is derived during the
 * render recharts was doing anyway rather than from a `mousemove` handler that
 * would re-render a chart held at seven hundred points per series.
 *
 * The horizontal line follows the *first* series, which is the one the panel is
 * about -- memory before swap, download before upload -- and the chip carries
 * that series' hue, so the line says which of the two it is measuring.
 *
 * `domainTop` is the axis top the panel pinned its plot to, and it is what makes
 * the horizontal line possible: the cursor is not given a scale, but a
 * zero-anchored axis is a division. A panel that scales itself to its own window
 * (the latency chart) passes none, and gets the vertical line alone.
 */
export function Crosshair({
  points,
  payload,
  domainTop,
  format,
  top = 0,
  left = 0,
  width = 0,
  height = 0,
  pointerEvents = "none",
  className,
}: {
  points?: CursorPoint[]
  payload?: PayloadItem[]
  domainTop?: number
  format?: (value: number) => string
  top?: number
  left?: number
  width?: number
  height?: number
  pointerEvents?: React.SVGProps<SVGGElement>["pointerEvents"]
  className?: string
}) {
  const x = points?.[0]?.x
  if (x === undefined) return null
  const series = payload?.[0]
  const value = typeof series?.value === "number" ? series.value : null
  const y = value === null || domainTop === undefined ? null : crosshairY(value, domainTop, height)
  const text = y === null || value === null || !format ? "" : format(value)
  const chip = chipWidth(text)
  // Kept inside the plot: a line at the top of the axis would otherwise print its
  // chip over the panel's title.
  const chipY = top + Math.max(6, (y ?? 0) - 20)
  return (
    <g className={className} pointerEvents={pointerEvents}>
      <line
        x1={x}
        y1={top}
        x2={x}
        y2={top + height}
        stroke="var(--color-muted-foreground)"
        strokeOpacity={0.45}
        strokeDasharray="3 3"
      />
      {y !== null && (
        <>
          <line
            x1={left}
            y1={top + y}
            x2={left + width}
            y2={top + y}
            stroke={series?.stroke ?? "var(--color-muted-foreground)"}
            strokeOpacity={0.55}
            strokeDasharray="4 4"
          />
          <g transform={`translate(${left + width - chip - 4}, ${chipY})`}>
            <rect
              width={chip}
              height={16}
              rx={3}
              style={{ fill: "var(--color-popover)", stroke: "var(--color-border)" }}
            />
            <text
              x={chip / 2}
              y={11.5}
              textAnchor="middle"
              fontSize={10}
              style={{ fill: "var(--color-popover-foreground)", fontVariantNumeric: "tabular-nums" }}
            >
              {text}
            </text>
          </g>
        </>
      )}
    </g>
  )
}
