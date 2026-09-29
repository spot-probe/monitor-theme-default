import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode; empty?: ReactNode }

/**
 * One metric: name and percentage on top, bar in the middle, raw numbers
 * underneath.
 *
 * The bar holds one accent colour until the figure is worth stopping on, then
 * turns amber at 75% and red at 90%. Colouring every bar would leave the busy
 * machine looking like the idle one at exactly the moment the page is being
 * scanned for it. The percentage takes the same colour, so the warning survives
 * a reader who cannot separate the two hues, and the number is still there for
 * anyone the colour means nothing to.
 */
export function Meter({ label, pct, foot, empty = "—" }: Props) {
  // null means the metric has no ceiling to fill, so the bar stays empty rather
  // than reporting 0%. What replaces the percentage depends on the reason:
  // unknown for a node with no metrics, ∞ for a plan with no limit.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const severe = filled >= 90
  const busy = filled >= 75
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tnum text-xs font-medium",
            severe ? "text-danger-fg" : busy ? "text-warn-fg" : "text-foreground",
          )}
        >
          {pct === null ? empty : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      {/* h-2 with a track that is actually visible: at h-1.5 on a light blue-grey
          (#f1f3f7) the track had no readable extent, so the bar looked like it
          floated with no start or end. rounded-full on both halves is what makes
          the two ends read as ends. */}
      <div
        // The bar carries the same reading as the percentage beside it, announced
        // as a gauge instead of drawn twice: with no ceiling (∞, or a node that
        // never reported) there is no value to announce, so `aria-valuetext` says
        // what the tile says and `aria-valuenow` stays off.
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct === null
          ? { "aria-valuetext": typeof empty === "string" ? empty : "无" }
          : { "aria-valuenow": Math.round(filled), "aria-valuetext": `${filled.toFixed(filled < 10 ? 1 : 0)}%` })}
        aria-label={typeof label === "string" ? label : undefined}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted-foreground/20"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            // A 0.2% fill is a third of a pixel, which the browser renders as an
            // invisible or ragged sliver. The floor keeps "almost nothing"
            // legible as "something", which is what the number beside it says.
            filled > 0 && "min-w-[3px]",
            severe ? "bg-destructive" : busy ? "bg-warn" : "bg-primary",
          )}
          style={{ width: `${filled}%` }}
        />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
}
