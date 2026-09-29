import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { LayoutDashboard, LogIn, Moon, Sun } from "lucide-react"

import { NodeCard } from "@/components/NodeCard"
import { NodeTable } from "@/components/NodeTable"
import { Summary } from "@/components/Summary"
import { Toolbar, type View } from "@/components/Toolbar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes } from "@/lib/api"
import { groupNames, inGroup, matches, type FilterKey } from "@/lib/group"
import { cn } from "@/lib/utils"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

// Split out because recharts is most of this bundle and the list page draws no
// chart. The landing page is 242 kB rather than 629 kB (77 kB gzipped against
// 188 kB), with the rest fetched immediately after it paints.
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

// `/node/{id}` is a real page: it survives a reload, can be linked to, and back
// leaves the detail view rather than the site. The hub serves index.html for any
// unknown path, so no server-side route is required.
function useNodeRoute() {
  const read = () => {
    const match = location.pathname.match(/^\/node\/(\d+)/)
    return match ? Number(match[1]) : null
  }
  const [id, setId] = useState(read)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return [
    id,
    (next: number | null) => {
      history.pushState({}, "", next === null ? "/" : `/node/${next}`)
      setId(next)
      scrollTo(0, 0)
    },
  ] as const
}

const DARK_MEDIA = matchMedia("(prefers-color-scheme: dark)")

/**
 * The visitor's own choice, or the system's while there is none. Only the toggle
 * writes the choice down: persisting the system's answer on load would pin it,
 * leaving a visitor who never touched the toggle in whatever mode their system
 * happened to be in that day. The panel at `/admin/` shares this key on one
 * origin, so it holds to the same rule -- one app writing on load pins the others.
 *
 * The system's answer is subscribed to rather than copied into state: a flip
 * landing between the first render and the effect that would have attached the
 * listener is otherwise never heard, and the next one is a day away.
 */
function useTheme() {
  const [saved, setSaved] = useState(() => localStorage.getItem("theme"))
  const system = useSyncExternalStore(
    (notify) => {
      DARK_MEDIA.addEventListener("change", notify)
      return () => DARK_MEDIA.removeEventListener("change", notify)
    },
    () => DARK_MEDIA.matches,
  )
  const dark = saved ? saved === "dark" : system

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return [
    dark,
    () => {
      const next = dark ? "light" : "dark"
      localStorage.setItem("theme", next)
      setSaved(next)
    },
  ] as const
}

/** A preference, not a route: which view you left on is where you come back to. */
function useView() {
  const [view, setView] = useState<View>(() => (localStorage.getItem("view") === "list" ? "list" : "grid"))
  useEffect(() => {
    localStorage.setItem("view", view)
  }, [view])
  return [view, setView] as const
}

/**
 * Whether what the page is showing is still arriving.
 *
 * A status page is read while something is wrong, which is exactly when the
 * stream is most likely to be down too -- and a list that quietly stopped
 * updating shows stale figures with the same confidence as live ones. The time is
 * the hub's last frame rather than a ticking clock, so it answers "how old is
 * this?" at a glance; the disconnect case keeps the last time, because knowing
 * *when* it stopped is the useful part then.
 */
function Live({ live, updatedAt }: { live: boolean; updatedAt: number }) {
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""
  return (
    <span
      className={cn(
        // Hidden on a phone, where the header has no room for it; the figures that
        // would be stale are on the same screen either way.
        "hidden items-center gap-1.5 text-xs whitespace-nowrap sm:inline-flex",
        live ? "text-muted-foreground" : "text-warn-fg",
      )}
      title={live ? "数据由 hub 实时推送" : "实时推送已断开，正在重连；期间每 5 秒轮询一次"}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-online" : "bg-warn")} />
      {live ? `更新于 ${time}` : updatedAt ? `已断开 · 最后更新 ${time}` : "连接中…"}
    </span>
  )
}

export default function App() {
  const [dark, toggleTheme] = useTheme()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed, updatedAt, live } = useNodes()
  const [open, go] = useNodeRoute()
  const [view, setView] = useView()
  // A group filter, not persisted -- unlike the view. Left selected from an
  // earlier visit it would read as machines having gone missing.
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<FilterKey[]>([])

  const loadMe = useCallback(() => {
    // `|| "..."` because an empty message reads as no error: api() falls back to
    // res.statusText, which HTTP/2 and HTTP/3 removed, so a bodiless 502 from a
    // proxy arrives as "". The check below would then take the loading branch and
    // the retry button would never render.
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message || "网络错误"))
  }, [])

  useEffect(() => {
    loadMe()
    // Warmed here rather than left to Suspense, which requests the chunk only
    // once a render reaches the detail view, itself waiting on /me. Without this
    // the split trades its first paint for a full-page skeleton over the first
    // node opened: 2.6s click-to-chart on 4G against 1.4s unsplit, 1.7s warm.
    void loadDetail()
  }, [loadMe])

  // The status page was closed while this tab was open. `me` holds whatever it
  // reported at load, so it is re-queried; the effect below then directs an
  // anonymous visitor to the panel rather than leaving them on a list that
  // stopped updating with only a red line to explain it.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)
  // Narrow first, group second. The other order leaves empty headings behind for
  // every group the filter emptied.
  //
  // The query is a substring match over the things a node is named by, so
  // "debian", "us" and a hostname fragment all work without a query language.
  const needle = query.trim().toLowerCase()
  const names = groupNames(sorted)
  // A group the fleet no longer carries falls back to 全部节点, rather than showing
  // an empty list behind a tab that should not still be selected. Derived during
  // render, so no effect has to run afterwards to correct it.
  const activeGroup = group !== null && names.includes(group) ? group : null
  // Three independent narrowings, applied in one pass: group, attention filters,
  // free-text search. None of them knows about the others.
  const filtered = sorted.filter(
    (n) =>
      inGroup(n, activeGroup) &&
      matches(n, filters) &&
      (needle === "" ||
        [n.name, n.country, n.os, n.virt, n.arch].some((f) => (f || "").toLowerCase().includes(needle))),
  )
  // Everything the visitor chose that could be narrowing the list, in the same
  // terms the pass above uses, plus one call that undoes all three. The empty
  // state needs both: the toolbar's own 清除筛选 clears only the chips, and
  // neither the search box nor a group tab is one.
  const narrowing = needle !== "" || activeGroup !== null || filters.length > 0
  const clearAll = () => {
    setQuery("")
    setGroup(null)
    setFilters([])
  }

  const selected = sorted.find((n) => n.id === open)

  // `/node/{id}` is a page people bookmark and share, so the tab needs the node's
  // name. The site name rather than a fixed string, since the hub lets an operator
  // rename the site.
  useEffect(() => {
    // Assigning document.title from an effect is the documented way to set the
    // page title -- there is no declarative equivalent in React itself. The
    // React Compiler's immutability rule flags the outer-scope assignment anyway,
    // the same over-strictness the sibling `react/purity` rule is switched off
    // for in .oxlintrc.json.
    // oxlint-disable-next-line react/immutability
    document.title = [selected?.name, me?.site_name || "Monitor"].filter(Boolean).join(" · ")
  }, [selected?.name, me?.site_name])

  // Only while there is nothing else to show. Once `me` has loaded, a later
  // failure belongs beside the page rather than over it.
  if (!me) return (
    <div className="min-h-svh">
      {/* A skeleton of the page rather than the word 加载中: the shape arrives
          first and the figures fill into it, so the first paint is not a blank
          page that then jumps. */}
      <header className="border-b">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <Skeleton className="h-5 w-28" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-24" />
        </div>
      </header>
      {meError ? (
        <div className="grid min-h-[60svh] place-items-center p-6">
          <div className="space-y-3 text-center">
            <p role="alert" className="text-sm text-destructive">加载失败：{meError}</p>
            <Button onClick={loadMe}>重试</Button>
          </div>
        </div>
      ) : (
        <main className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[86px] rounded-xl" />)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[282px] rounded-xl" />)}
          </div>
        </main>
      )}
    </div>
  )

  // The status page is closed and nobody is signed in: redirect to the panel.
  if (!me.public_page && !me.authed) return null

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          {/* The site name is one way back to the list. The node page also carries
              its own back arrow beside the name -- where the eye already is -- so
              this note no longer claims it needs none. */}
          {/* The page's own title, in the one place every view shares. `h1` around
              the button rather than on it: the mark goes back to the list, and the
              heading is what a screen reader lists the page under. */}
          <h1 className="flex min-w-0 items-center">
            <button
              className="flex min-w-0 items-center gap-2 rounded-md text-base font-semibold tracking-tight transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              onClick={() => go(null)}
            >
              {/* The tab's own mark, so the page and the tab read as the same thing
                  rather than two things that happen to share a name. */}
              <img src="/favicon.svg" alt="" className="size-5 shrink-0" />
              <span className="truncate">{me.site_name || "Monitor"}</span>
            </button>
          </h1>
          <Live live={live} updatedAt={updatedAt} />
          <div className="flex-1" />
          {/* The panel is a separate app built into the hub, not part of this
              theme, so this is a navigation rather than a route. */}
          <Button variant="ghost" size="sm" asChild>
            <a href="/admin/">
              {me.authed ? <LayoutDashboard /> : <LogIn />} {me.authed ? "进入后台" : "登录"}
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="切换主题">
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <Skeleton className="h-96" />
          ) : selected ? (
            <Suspense fallback={<Skeleton className="h-96" />}>
              <NodeDetail node={selected} onBack={() => go(null)} />
            </Suspense>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              节点不存在或未公开。<button className="underline" onClick={() => go(null)}>返回列表</button>
            </p>
          )
        ) : !nodes ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : (
          <>
            <Summary
              nodes={sorted}
              // The same 离线 chip the toolbar carries, so the count and the filter
              // cannot come to mean different things. A toggle, so a second click
              // on the tile is never a dead one.
              filtering={filters.includes("offline")}
              onFilter={() =>
                setFilters((f) => (f.includes("offline") ? f.filter((k) => k !== "offline") : [...f, "offline"]))
              }
              onOpen={(n) => go(n.id)}
            />
            {/* Ten pixels either side of the toolbar, not twenty. It belongs to
                the list it acts on, so the page's own rhythm between sections
                would read as a break the toolbar is not. */}
            <div className="mt-2.5 space-y-2.5">
              <Toolbar
                nodes={sorted}
                counts={{ shown: filtered.length, total: sorted.length }}
                view={view}
                onView={setView}
                query={query}
                onQuery={setQuery}
                filters={filters}
                onFilters={setFilters}
                groups={names}
                group={activeGroup}
                onGroup={setGroup}
              />
              {filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    {/* Two empties, two causes: an empty fleet is not a filter that
                        matched nothing, and only one of them is the visitor's doing. */}
                    {sorted.length === 0 ? "还没有节点" : "没有符合条件的节点"}
                  </p>
                  {/* An empty state that names the problem and offers no way out is a
                      dead end: the toolbar's own 清除筛选 clears only the chips, and
                      neither the search nor the group tab is a chip. */}
                  {narrowing && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={clearAll}>
                      清除筛选
                    </Button>
                  )}
                </div>
              ) : view === "list" ? (
                <NodeTable nodes={filtered} onOpen={go} />
              ) : (
                // No `items-start`: the grid's own stretch is what keeps a row's cards
                // the same height. One card with a longer figure -- a price with its
                // period, a name that truncates differently -- otherwise ends a line
                // lower than its neighbours, which reads as a layout bug rather than as
                // data. The shorter cards take the slack at the bottom.
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map((n) => (
                    <NodeCard key={n.id} node={n} onOpen={() => go(n.id)} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
