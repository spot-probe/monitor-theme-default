import { useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { Country, StatusDot, monthUsage, statusLabel } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { cycle, FOREVER, bytes, daysUntil, money, osName, pair, percent, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

type SortKey = "name" | "cpu" | "mem" | "disk" | "traffic" | "expiry"
/** `order` is the hub's own ordering -- the one the grid uses. */
type Sort = { key: SortKey | "order"; dir: 1 | -1 }

/**
 * Columns are declared as data, with each cell beside its own header. The header
 * row is generated from the same array, so a column cannot drift out of step with
 * the heading above it.
 *
 * `w` is a share of the width rather than a hint. The table is `table-fixed`
 * because these cells hold figures that change every two seconds: under automatic
 * layout the browser re-derives every column from its content, so a rate ticking
 * from `9.9 KB/s` to `227.7 KB/s` shunts the whole row sideways. Fixed shares make
 * the layout independent of what the numbers happen to say.
 *
 * The responsive classes hide a column rather than squeezing it: below `lg` there
 * is no width for the machine's shape as well as its numbers.
 */
const COLUMNS: {
  header: string
  w: string
  sort?: SortKey
  className?: string
  cell: (node: Node) => React.ReactNode
}[] = [
  {
    header: "节点",
    w: "230px",
    sort: "name",
    cell: (n) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusDot node={n} />
        <span className="truncate font-medium">{n.name}</span>
        <Country node={n} />
      </span>
    ),
  },
  {
    header: "状态",
    w: "130px",
    className: "hidden sm:table-cell",
    cell: (n) => <span className="tnum block truncate text-xs text-muted-foreground">{statusLabel(n)}</span>,
  },
  {
    header: "系统",
    w: "150px",
    className: "hidden lg:table-cell",
    cell: (n) => (
      <span className="block truncate text-xs text-muted-foreground">
        {[n.os ? osName(n.os) : "", n.virt !== "none" ? n.virt : "", n.arch].filter(Boolean).join(" · ") || "—"}
      </span>
    ),
  },
  { header: "CPU", w: "82px", sort: "cpu", cell: (n) => <Bar pct={n.metrics ? n.metrics.cpu : null} /> },
  {
    header: "内存",
    w: "82px",
    sort: "mem",
    cell: (n) => <Bar pct={n.metrics ? percent(n.metrics.mem_used, n.metrics.mem_total) : null} />,
  },
  {
    header: "硬盘",
    w: "82px",
    sort: "disk",
    className: "hidden md:table-cell",
    cell: (n) => <Bar pct={n.metrics ? percent(n.metrics.disk_used, n.metrics.disk_total) : null} />,
  },
  {
    header: "本月流量",
    w: "132px",
    sort: "traffic",
    cell: (n) => (
      <span className="tnum block truncate text-xs">
        {n.traffic_limit > 0 ? pair(monthUsage(n), n.traffic_limit) : `${bytes(monthUsage(n))} / ${FOREVER}`}
      </span>
    ),
  },
  {
    header: "网络",
    w: "186px",
    className: "hidden xl:table-cell",
    cell: (n) => (
      <span className="tnum flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
          {n.metrics ? rate(n.metrics.net_rx) : "—"}
        </span>
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <ArrowUp className="size-3 shrink-0" />
          {n.metrics ? rate(n.metrics.net_tx) : "—"}
        </span>
      </span>
    ),
  },
  { header: "到期", w: "88px", sort: "expiry", cell: (n) => <Expiry node={n} /> },
  {
    header: "续费",
    w: "120px",
    className: "hidden lg:table-cell",
    cell: (n) => (
      <span className="block truncate text-xs text-muted-foreground">
        {n.price > 0 ? `${money(n.price, n.currency)} / ${cycle(n.billing_cycle)}` : "免费"}
      </span>
    ),
  },
]

/** A percentage with the same bar the cards use, sized for a table cell. */
function Bar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>
  const filled = Math.min(100, Math.max(0, pct))
  return (
    <span className="flex items-center gap-1.5">
      <span className="tnum w-8 shrink-0 text-right text-xs">
        {filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%
      </span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/20">
        <span
          className={cn(
            "block h-full rounded-full",
            filled >= 90 ? "bg-destructive" : filled >= 75 ? "bg-warn" : "bg-primary",
          )}
          // The floor keeps a 0.2% fill from rendering as a ragged sliver. No
          // width transition here on purpose: at this size it reads as the bar
          // creeping rather than as the figure changing.
          style={{ width: `${filled}%`, minWidth: filled > 0 ? 4 : undefined }}
        />
      </span>
    </span>
  )
}

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="text-xs text-muted-foreground">{FOREVER}</span>
  return (
    <span
      className={cn(
        "tnum block truncate text-xs",
        days < 0 ? "text-danger-fg" : days <= 7 ? "text-warn-fg" : "text-muted-foreground",
      )}
    >
      {days < 0 ? `逾期 ${-days} 天` : `${days} 天`}
    </span>
  )
}

/** `null` is "nothing to rank", and stays at the bottom in either direction. */
function rank(node: Node, key: SortKey): number | null {
  switch (key) {
    case "cpu":
      return node.metrics?.cpu ?? null
    case "mem":
      return node.metrics ? percent(node.metrics.mem_used, node.metrics.mem_total) : null
    case "disk":
      return node.metrics ? percent(node.metrics.disk_used, node.metrics.disk_total) : null
    case "traffic":
      return monthUsage(node)
    case "expiry":
      return daysUntil(node.expires_at)
    default:
      return null
  }
}

function sortNodes(nodes: Node[], { key, dir }: Sort): Node[] {
  if (key === "order") return nodes
  return [...nodes].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name, "zh") * dir
    const x = rank(a, key)
    const y = rank(b, key)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x - y) * dir
  })
}

/**
 * The fleet as a table: the same figures the cards carry, one row each, so a
 * column can be read down rather than each card read across.
 *
 * Groups are a filter, not a layout: the toolbar narrows the array before it
 * arrives here, so this component stays a plain list of rows and cannot develop
 * an opinion about grouping that the grid would then have to match.
 */
export function NodeTable({ nodes, onOpen }: { nodes: Node[]; onOpen: (id: number) => void }) {
  const [sort, setSort] = useState<Sort>({ key: "order", dir: 1 })

  // A fresh column starts ascending; the same column again reverses it.
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
      {/* A floor on the width, so the shares stay readable and the container
          scrolls rather than squeezing `debian · kvm · x86_64` onto two lines. */}
      <table className="w-full min-w-[1282px] table-fixed border-collapse text-sm">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.header} style={{ width: c.w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b">
            {COLUMNS.map((c) => {
              const active = c.sort !== undefined && sort.key === c.sort
              return (
                <th
                  key={c.header}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cn(
                    "px-2.5 py-2.5 text-left text-xs font-normal whitespace-nowrap text-muted-foreground",
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.sort!)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
                        active && "text-foreground",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort.dir === 1 ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortNodes(nodes, sort).map((n) => (
            <tr
              key={n.id}
              // Convenience for the pointer; the name cell's button below is the
              // control keyboard and screen-reader users actually reach.
              onClick={() => onOpen(n.id)}
              className="cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/50"
            >
              {COLUMNS.map((c, i) => (
                <td key={c.header} className={cn("overflow-hidden px-2.5 py-2.5", c.className)}>
                  {i === 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(n.id)
                      }}
                      className="flex w-full min-w-0 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {c.cell(n)}
                    </button>
                  ) : (
                    c.cell(n)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
