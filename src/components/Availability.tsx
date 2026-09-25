import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  availabilityText, barTone, incidentStamp, missingMinutes, outageLength, stillDown, TONE_CLASS,
  windowLabel, type Availability, type Incident,
} from "@/lib/uptime"

/**
 * How many outages are listed before the rest are counted instead. A node that
 * flapped through a week can carry dozens, and the bar above already shows where
 * they were; the list is here to name the ones that matter, not to enumerate them.
 */
const LISTED = 6

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
        className={cn(
          "size-1.5 shrink-0 translate-y-px rounded-full",
          open ? TONE_CLASS.down : TONE_CLASS.warn,
        )}
      />
      <span className="tnum shrink-0">{incidentStamp(incident.start)}</span>
      <span className="text-muted-foreground">
        {open ? `起离线至今（已 ${outageLength(incident.minutes)}）` : `起离线 ${outageLength(incident.minutes)}`}
      </span>
    </li>
  )
}

/**
 * The availability bar and the outages beneath it.
 *
 * The window is whatever the hub measured and reported, printed from `from`/`to`
 * rather than assumed to be a week: under the hub's default retention of seven
 * days a longer request comes back clamped, and a header that said "近 30 天"
 * over a seven-day bar would be the one lie this card can tell.
 */
export function AvailabilityCard({ data }: { data: Availability }) {
  const { from, to, buckets, incidents } = data
  const label = windowLabel(from, to)
  // Both ends of the window can hold a partial hour -- a node added mid-hour, or
  // the hour in progress -- and `m` carries how many minutes each really covers,
  // so a full partial hour stays green rather than reading as downtime.
  const expected = buckets.reduce((sum, b) => sum + b.m, 0)
  const reported = buckets.reduce((sum, b) => sum + b.n, 0)
  const fraction = expected > 0 ? reported / expected : 1
  const down = missingMinutes(buckets)
  const recent = [...incidents].reverse()

  return (
    <Card className="gap-0 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">可用率 · {label}</h4>
        <p className="text-sm">
          <span className="tnum font-medium">{availabilityText(fraction)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {incidents.length === 0
              ? "没有故障"
              : `${incidents.length} 次故障 · 共 ${outageLength(down)}`}
          </span>
        </p>
      </div>

      {/* One segment per hour. The whole bar is one image to a screen reader,
          which reads the summary above; the segments carry hover text for the
          hour under the pointer. */}
      <div
        role="img"
        aria-label={`${label}可用率 ${availabilityText(fraction)}，${incidents.length} 次故障，共 ${outageLength(down)}`}
        className="mt-3 flex h-6 gap-px overflow-hidden rounded-md"
      >
        {buckets.map((b) => (
          <span
            key={b.ts}
            title={`${incidentStamp(b.ts)} · ${b.n}/${b.m} 分钟`}
            className={cn("min-w-px flex-1", TONE_CLASS[barTone(b.n, b.m)])}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span className="tnum">{incidentStamp(from)}</span>
        <span className="tnum">{incidentStamp(to)}</span>
      </div>

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
