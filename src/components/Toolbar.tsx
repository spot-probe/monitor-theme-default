import { LayoutGrid, List, Search, X } from "lucide-react"

import { Segmented } from "@/components/ui/segmented"
import type { Node } from "@/lib/api"
import { FILTERS, type FilterKey } from "@/lib/group"
import { cn } from "@/lib/utils"

export type View = "grid" | "list"

/**
 * Every control in this row is the same height. Three different heights read as
 * three unrelated widgets that happened to land together rather than as one
 * instrument panel.
 */
const CONTROL = "h-8"

/**
 * A group tab. Plain text with the active one in the accent colour, which is the
 * shape the reference panel uses -- a group is a place, not a control that needs
 * a box drawn around it.
 */
function GroupTab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // text-xs, not text-sm: the second size made the tabs the loudest thing in a
      // row of otherwise 12px controls. Weight is constant so switching tabs does
      // not reflow the row -- the colour is the whole difference.
      className={cn(
        "rounded text-xs font-medium whitespace-nowrap transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

/**
 * The band between the summary and the fleet.
 *
 * No totals here: the four cards above already state the fleet's size and
 * throughput. What this row holds is the three things that act on the list below
 * -- which group is in view, which attention filter is on, and how it is laid out.
 */
export function Toolbar({ nodes, counts, view, onView, query, onQuery, filters, onFilters, groups, group, onGroup }: {
  nodes: Node[]
  counts: { shown: number; total: number }
  view: View
  onView: (view: View) => void
  query: string
  onQuery: (query: string) => void
  filters: FilterKey[]
  onFilters: (filters: FilterKey[]) => void
  /** Empty until the hub carries a group field; the tabs are hidden until then. */
  groups: string[]
  group: string | null
  onGroup: (group: string | null) => void
}) {
  const toggleFilter = (key: FilterKey) =>
    onFilters(filters.includes(key) ? filters.filter((k) => k !== key) : [...filters, key])

  // Each chip carries the size of the set it would leave you with, so a filter
  // that leads nowhere is visible before it is clicked rather than after.
  const chips = FILTERS.map((f) => ({ ...f, count: nodes.filter(f.test).length })).filter(
    (f) => f.count > 0 || filters.includes(f.key),
  )

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
      {/* Only once the fleet actually carries groups. A lone "全部节点" tab would
          be a control that cannot do anything, and the row is the widest thing
          here -- it should not cost space until it earns it. */}
      {groups.length > 0 && (
        <>
          <div role="group" aria-label="节点分组" className={cn("flex shrink-0 items-center gap-3.5", CONTROL)}>
            <GroupTab active={group === null} onClick={() => onGroup(null)}>
              全部节点
            </GroupTab>
            {groups.map((name) => (
              <GroupTab key={name} active={group === name} onClick={() => onGroup(name)}>
                {name}
              </GroupTab>
            ))}
          </div>
          <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
        </>
      )}

      {/* One container for the whole set, the same shape as the view toggle on the
          right -- they are both segmented controls and should look like it.

          Hidden when it holds no chips, the same guard the group row above uses. On a
          healthy fleet with nothing expiring, every count is zero, so the container
          rendered on its own as a small empty bordered pill. */}
      {chips.length > 0 && (
      <div
        role="group"
        aria-label="筛选节点"
        className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-md border bg-card px-0.5", CONTROL)}
      >
        {chips.map((f) => {
          const active = filters.includes(f.key)
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFilter(f.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs whitespace-nowrap transition-colors",
                active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  // Same size as the label beside it: a 10px count inside a 12px
                  // chip was the other half of the mismatch.
                  "tnum rounded-full px-1.5 text-xs leading-[18px] font-medium",
                  active ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
                )}
              >
                {f.count}
              </span>
            </button>
          )
        })}
      </div>
      )}

      {filters.length > 0 && (
        <button
          type="button"
          onClick={() => onFilters([])}
          className={cn(
            "inline-flex items-center rounded px-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline",
            CONTROL,
          )}
        >
          清除筛选
        </button>
      )}

      {/* Only while something is being hidden: a permanent "9 / 9" is a label
          that never carries information. */}
      {counts.shown !== counts.total && (
        <span className={cn("tnum inline-flex items-center px-1 text-xs text-muted-foreground", CONTROL)}>
          {counts.shown} / {counts.total} 台
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <label className={cn("relative inline-flex items-center", CONTROL)}>
          <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索节点"
            aria-label="按名称、国家或系统搜索节点"
            className="h-8 w-36 rounded-md border border-input bg-card pr-7 pl-7 text-xs outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:w-48"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="清除搜索"
              className="absolute right-1.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>

        {/* The same component the detail page uses for its two controls: one
            segmented control in the theme, not one per page. */}
        <Segmented
          label="切换视图"
          value={view}
          onChange={onView}
          items={[
            { value: "grid", label: "", title: "网格视图", icon: <LayoutGrid className="size-3.5" /> },
            { value: "list", label: "", title: "列表视图", icon: <List className="size-3.5" /> },
          ]}
        />
      </div>
    </div>
  )
}
