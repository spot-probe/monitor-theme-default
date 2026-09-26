import type { CSSProperties } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { bytes, CYCLES, daysUntil, FOREVER, money, osName, pair, percent, rate, uptime } from "@/lib/format"
import { availabilityText, fractionTone, TONE_CLASS, windowLabel } from "@/lib/uptime"
import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 267. vite.config.ts keeps them from being inlined
// into the entry chunk as data URLs. The simplified 3x2 set: this theme is
// embedded in the hub binary, and flag-icons' detailed emblems total 1.95 MiB
// against 174 KiB here, a difference invisible at 18 by 12 pixels.
const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/country-flag-icons/3x2/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

// Matched against the whole release name, since "Red Hat Enterprise Linux" and
// "Raspbian GNU/Linux" do not lead with one word to key on. The distributions a
// VPS ships with; the rest take the penguin. Each logo costs 1-6 KB of entry
// bundle, so the list stays at what hosts offer.
const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/** Which direction the plan meters, matching the node's traffic_mode. */
export function monthUsage(node: Node): number {
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

// A node that has reported once has told the hub its shape -- cores, memory,
// disk -- and the hub retains its traffic totals whether connected or not. A node
// that never connected is the only case with nothing to show.
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

// Three states, three colours. A node that never connected is not "down": it is
// simply absent, so it stays grey rather than borrowing the red that means a
// machine stopped answering. Online keeps upstream's own `--online` green rather
// than this fork's brighter `--ok`, which is a meter fill and too light to carry
// as a six-pixel dot on a white card. Upstream's third state is a second grey
// here; the red is deliberate and predates the port.
//
// The absent dot is `--muted-foreground` at 80%: at full strength it would clear
// the contrast bar by more than the online dot does and rank "never connected" as
// the loudest state on the card. Measured against the chip's own tint: online
// 3.34, offline 3.22, absent 3.32 (light) and 5.98 / 5.33 / 4.86 (dark).
const DOT = {
  ok: "bg-online ring-2 ring-online/25",
  down: "bg-destructive ring-2 ring-destructive/20",
  absent: "bg-muted-foreground/80",
} as const

/**
 * The wash behind the state chip, per state, out of the theme's own fill tokens.
 *
 * A tint of the state's own fill rather than a neutral surface: the card carries
 * three states side by side, and the chip is what a reader scans for. The label
 * stays `--foreground` rather than taking the `-fg` twin of its state, which is
 * the obvious reach: `--danger-fg` measures 4.83:1 on the card, and any red tint
 * worth seeing drops it to 4.13 -- under the 4.5 a 12px label needs. Measured on
 * the chip itself, foreground is 14.33 / 13.58 / 15.68 (light) and 11.72 / 12.44
 * / 14.53 (dark), so the state is carried by the tint and the dot, and the word
 * stays readable. Upstream's own pill is a foreground label too.
 */
const CHIP = {
  ok: "bg-ok/12 text-foreground",
  down: "bg-destructive/12 text-foreground",
  absent: "bg-muted text-foreground",
} as const

function stateOf(node: Node) {
  if (node.online) return "ok"
  return deployed(node) ? "down" : "absent"
}

/**
 * How long the machine has been up, or once it is gone, how long it has been
 * absent -- the first question asked of an offline node. Both are durations, so
 * the line keeps its shape either way.
 */
export function statusLabel(node: Node) {
  const down = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  if (node.online) return `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}`.trim()
  return deployed(node) ? `离线 ${down >= 60 ? uptime(down) : ""}`.trim() : "未接入"
}

/** The dot on its own, for the line the detail page draws the name on. */
export function StatusDot({ node }: { node: Node }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[stateOf(node)])} />
}

/**
 * The dot and the duration welded into one chip. It sits at the right end of the
 * name's line on the card, which is where the reference panel puts it, and in the
 * header of the detail page.
 *
 * `shrink-0` is half of the arrangement and the load-bearing half: the chip must
 * survive a name long enough to truncate, so the name is the flex item that
 * gives, not the chip. `overflow-visible` undoes the badge's own clipping, which
 * would otherwise cut the halo off the dot.
 */
export function Status({ node, className }: { node: Node; className?: string }) {
  const state = stateOf(node)
  return (
    <Badge
      variant="outline"
      className={cn("tnum shrink-0 gap-1.5 overflow-visible border-transparent font-normal", CHIP[state], className)}
    >
      <StatusDot node={node} />
      {statusLabel(node)}
    </Badge>
  )
}

/**
 * Where the machine is: its flag, or the bare code for one the set lacks.
 *
 * The flag is fetched on demand rather than inlined, and the code stays legible
 * in the `title` for anyone who does not read the emblems. A country the hub
 * could not resolve renders nothing at all; a code with no flag in the simplified
 * set falls back to this fork's tinted chip, which is the shape this badge had
 * before the flags arrived.
 */
export function Country({ node }: { node: Node }) {
  if (!node.country) return null
  const src = FLAGS[node.country]
  if (!src) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 rounded-md border-transparent bg-tag font-normal text-tag-foreground"
      >
        {node.country}
      </Badge>
    )
  }
  return (
    <img
      src={src}
      alt={node.country}
      title={node.country}
      className="h-3 w-4.5 shrink-0 rounded-[2px] ring-1 ring-foreground/10"
    />
  )
}

/**
 * The distribution's logo in its brand colour, ahead of its name in the muted
 * line. Mixed toward white on the dark theme, where AlmaLinux's black and
 * CentOS's navy would otherwise vanish into the card.
 */
function OsIcon({ os }: { os: string }) {
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className="size-3 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]"
    >
      <path d={icon.path} />
    </svg>
  )
}

/**
 * How much of the recent past this node was actually reporting in.
 *
 * The window is the one the hub measured, printed from `from7`/`to` rather than
 * assumed to be a week: it is clamped to the node's own life and to the history
 * the hub retains, so a machine added yesterday reads "近 1 天" over a day it is
 * genuinely accountable for, and a hub keeping a week does not let the card claim
 * a month. The dot takes the same three colours as the detail page's bar at the
 * same thresholds, so the card and the bar cannot disagree about a node.
 *
 * A hub older than this feature sends no `uptime` at all, and no line is drawn:
 * an absent figure and a node that missed every minute are different answers.
 */
export function UptimeLine({ node }: { node: Node }) {
  const u = node.uptime
  // Nothing was expected yet -- a node added within the current minute -- so
  // there is no fraction to print that would not be a claim about a window of
  // zero minutes.
  if (!u || u.to <= u.from7) return null
  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[fractionTone(u.d7)])}
      />
      {windowLabel(u.from7, u.to)}
      <span className="tnum">{availabilityText(u.d7)}</span>
    </p>
  )
}

// Traffic uses the plan's own counting rule, so the bar matches the quota the
// node is billed against.
function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} / ${FOREVER}`
}

// No date means nothing expires: a permanent host, or one with no renewal set. A
// blank corner asserts neither.
function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null)
    return (
      <span className="text-xs text-muted-foreground" title="永不到期">
        {FOREVER}
      </span>
    )
  // The darker twins of the amber and red fills: #f59e0b on white is 2.2:1,
  // which carries as a bar and not as a word.
  const tone = days < 0 ? "text-danger-fg" : days <= 7 ? "text-warn-fg" : "text-muted-foreground"
  return (
    <span className={cn("tnum text-xs", tone)}>
      {days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`}
    </span>
  )
}

/** What the plan costs, in the same cell shape as the expiry beside it. */
function Price({ node }: { node: Node }) {
  if (node.price <= 0) return <span className="text-xs text-muted-foreground">免费</span>
  return (
    <span className="tnum truncate text-xs text-muted-foreground">
      {money(node.price, node.currency)} / {CYCLES[node.billing_cycle] ?? node.billing_cycle}
    </span>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: () => void }) {
  const m = node.metrics

  return (
    <Card
      onClick={onOpen}
      // min-w-0: a grid item sizes to its content unless told otherwise, and the
      // OS line below does not wrap, so on a phone the card would grow past its
      // column and scroll the page sideways. The truncate inside only takes effect
      // once the card is allowed to be narrower.
      className="min-w-0 cursor-pointer gap-0 p-4 transition hover:border-primary/40 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <div className="min-w-0">
          {/* Identity left, state right, one line each -- the reference panel's
              arrangement. The name is the item that gives way: `min-w-0` on this
              row and `truncate` on the name, against `shrink-0` on the chip, so a
              hostname too long for the column is cut at the ellipsis while the
              state stays whole. The chip used to live on the line below as bare
              text, which cost nothing but read as part of the machine's shape
              rather than as its state.
              `ml-auto` rather than a spacer: with the flag between the name and
              the chip, the chip's edge still lands on the card's right edge
              whether or not the node has a country. */}
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate font-semibold">{node.name}</h3>
            <Country node={node} />
            <Status node={node} className="ml-auto" />
          </div>
          {/* The machine's shape, and nothing else now that the state has moved up.
              The distro's own logo sits against the distro's name; what truncates
              on a narrow card is the tail of this line, which is the part a reader
              can afford to lose. */}
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {node.os ? (
              <>
                <OsIcon os={node.os} />
                <span className="truncate">
                  {osName(node.os)}
                  {node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}
                  {node.arch ? ` · ${node.arch}` : ""}
                </span>
              </>
            ) : (
              <span className="shrink-0">等待首次上报</span>
            )}
          </p>
          {/* Its own line rather than a fourth item on the one above: that line
              is the machine's shape and truncates first on a narrow card, and the
              uptime figure is the one thing here a reader scans the whole fleet
              for. */}
          <UptimeLine node={node} />
      </div>

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <>
          {/* No rules between the blocks. A 20px gap against the 16px inside each of
            them groups the figures by rhythm instead, which is what the two hairlines
            were doing while also cutting the card into three. */}
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            {/* The core count belongs beside the word CPU: it is what the
                percentage and the load averages are both measured against. */}
            <Meter
              label={`CPU ${node.cpu_cores} 核`}
              pct={m ? m.cpu : null}
              foot={m ? m.load.map((n) => n.toFixed(2)).join(" ") : "—"}
            />
            <Meter
              label="内存"
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              foot={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
            />
            <Meter
              label="硬盘"
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              foot={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)}
            />
            <Meter
              label="流量"
              pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null}
              empty={FOREVER}
              foot={trafficFoot(node)}
            />
          </div>

          {/* Three columns read downwards: rate, lifetime total, then the deadline
              and what it costs. Equal shares and one gutter, so the columns line up
              instead of drifting apart. Down before up throughout, the order every
              other figure on this page takes. */}
          <div className="mt-5 grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
              {m ? rate(m.net_rx) : "—"}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <ArrowDown className="size-3 shrink-0" />
              {bytes(node.total_rx)}
            </span>
            <Expiry node={node} />

            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
              {m ? rate(m.net_tx) : "—"}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <ArrowUp className="size-3 shrink-0" />
              {bytes(node.total_tx)}
            </span>
            <Price node={node} />
          </div>
        </>
      ) : (
        /* Never connected: nothing to plot, so the card stays short rather than
           padding out to match its neighbours. */
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}
