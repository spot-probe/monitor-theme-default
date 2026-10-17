import { useEffect, useState } from "react"
import { FALLBACK_DAYS, historyDays } from "./ranges.ts"

import type { Uptime } from "./uptime"

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  /**
   * The operator's own category -- 建站, 入口集群, whatever they call it. The hub
   * does not carry this field yet; when it does, the panel's group tabs fill in
   * on their own, and until then they are not rendered at all.
   */
  group?: string
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  last_seen: number
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  /**
   * Days until `expires_at` on the hub's calendar, negative once past, null
   * without a date. Absent on a hub from before the field, in which case the
   * page counts from the visitor's own clock -- which is the behaviour this
   * field exists to replace.
   */
  expires_in?: number | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  month_start: string
  day_rx: number
  day_tx: number
  /**
   * The share of each window the node was reporting in, with the window it was
   * measured over. Absent from a hub older than the feature, and absent is the
   * only honest answer then -- the page shows no uptime line rather than a zero.
   */
  uptime?: Uptime
  /** Panel only. */
  hostname?: string
  ip?: string
  remark?: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * How far back the hub keeps history -- what the range picker may offer and what the
 * availability timeline covers.
 *
 * A hub that predates the field, or one that cannot be reached, keeps the week this
 * theme has always offered; `historyDays` does that fallback, so this only has to
 * carry the answer.
 */
export function useHistoryDays(): number {
  const [days, setDays] = useState(FALLBACK_DAYS)
  useEffect(() => {
    let live = true
    api<{ history_days?: unknown }>("/me")
      .then((me) => {
        if (live) setDays(historyDays(me))
      })
      .catch(() => {
        // The week stands; a status page that cannot read one setting still has a
        // page to draw.
      })
    return () => {
      live = false
    }
  }, [])
  return days
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

/**
 * Fleet throughput, one sample per push. Held beside the stream that feeds it
 * rather than in the tile that draws it: the summary unmounts while a node page is
 * open, so a buffer held there would restart empty on every return. Two minutes at
 * the hub's push interval.
 */
const KEEP = 60
export const speedHistory: { rx: number; tx: number }[] = []

function sample(nodes: Node[]) {
  const live = nodes.filter((n) => n.online && n.metrics)
  speedHistory.push({
    rx: live.reduce((s, n) => s + n.metrics!.net_rx, 0),
    tx: live.reduce((s, n) => s + n.metrics!.net_tx, 0),
  })
  if (speedHistory.length > KEEP) speedHistory.shift()
}

/** A malformed report must not remove every other node from the page. */
export function safeNodes(nodes: Node[]): Node[] {
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  const fields = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
    "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
  return nodes.map((node) => {
    const m = node.metrics
    return !m || (fields.every((key) => number(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(number))
      ? node : { ...node, metrics: null }
  })
}

/**
 * Live node list. Uses the WebSocket the hub pushes every two seconds, falling
 * back to polling if it cannot be established.
 */
/**
 * 一次重连要等多久：1s 起、翻倍、封顶 30s，并带**一半的抖动**。
 *
 * 抖动不是审美：hub 重启时所有标签页同时失去连接，固定间隔会让它们踩着同一拍回去，
 * 把刚起来的 hub 再拍一次。`rand` 可注入，用例才不必依赖随机数。
 */
export function reconnectDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt)
  return base / 2 + rand() * (base / 2)
}

export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // When the last frame arrived, and whether the stream carrying them is open.
  // Both are for the page's own "is this still live?" line: a status page that
  // silently stops updating shows yesterday's numbers with today's confidence.
  const [updatedAt, setUpdatedAt] = useState(0)
  const [live, setLive] = useState(false)
  // ⚠️ **"最近一次收到"与"最近一次内容变化"是两件事** ✗✗：hub 在内容没变时不推快照
  // （空闲机群上这是常态），所以 `updatedAt` 回答不了"连接还活着吗"。hub 每 10 秒发一条
  // 心跳帧，用它判新鲜；`beatSeen` 让不认识心跳的旧 hub 保持原来的行为（socket 开着就算活）。
  const [lastSeen, setLastSeen] = useState(0)
  const [beatSeen, setBeatSeen] = useState(false)
  // Set when the hub answers 401: the status page has been closed to anonymous
  // callers since this tab loaded. The hub also ends the stream, so this surfaces
  // on the fallback fetch the reconnect starts; a close allows a client to
  // re-query its state but cannot compel it.
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    // 重连退避：见 `reconnectDelay`。`attempt` 在连上时归零。
    let attempt = 0
    const backoff = () => reconnectDelay(attempt++)
    // ⚠️ 卸载标志。这里**曾经同名遮蔽**了外层的 `closed` 状态（公开页被关掉之后
    // 不再重连的那个标志），于是 `onclose` 里的 `if (closed) return` 读的永远是
    // 这个局部变量 —— 那条"401 之后别再重连"的承诺从来没生效，标签页会每 5 秒
    // 重连一次直到关闭。
    let disposed = false
    // 401：公开页在本标签页打开之后被关掉了。重连与轮询都没有意义（再问还是 401）。
    let unauthorized = false
    // 最近一次收到任何帧的时刻，以及"这个 hub 会不会发心跳"。
    // 后者决定下面那个看门要不要生效：旧 hub 不心跳，安静时几十秒没有帧是**正常**的。
    const seen = { current: 0 }
    let beats = false

    const receive = (list: Node[]) => {
      const safe = safeNodes(list)
      sample(safe)
      setNodes(safe)
      setError(null)
      setClosed(false)
      setUpdatedAt(Date.now())
    }

    const fetchOnce = () =>
      api<{ nodes: Node[] }>("/nodes")
        .then((d) => receive(d.nodes))
        .catch((e: Error) => {
          setError(e.message)
          if (e instanceof ApiError && e.status === 401) {
            unauthorized = true
            setClosed(true)
            // 轮询也没有意义了。
            if (poll) {
              clearInterval(poll)
              poll = null
            }
          }
        })

    fetchOnce()

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`
    // A hub restart closes every stream. Without reconnecting, a page that
    // outlives a deploy would remain on the fallback poll for the rest of its
    // life, refreshing at a fifth of the live rate with no indication.
    const connect = () => {
      if (disposed || unauthorized) return
      try {
        socket = new WebSocket(url)
      } catch {
        // 构造函数抛异常（URL 非法之类）：别把这一页永久留成轮询，但也别什么都不做。
        poll ??= setInterval(fetchOnce, 5000)
        retry = setTimeout(connect, backoff())
        return
      }
      socket.onmessage = (event) => {
        // ⚠️ 一帧解析失败不能把这条流弄死：跳过这一帧，等下一帧。
        let frame: { nodes?: unknown; beat?: unknown }
        try {
          frame = JSON.parse(event.data)
        } catch {
          return
        }
        // 任何一帧都证明连接还活着。
        seen.current = Date.now()
        setLastSeen(seen.current)
        if (Array.isArray(frame.nodes)) {
          receive(frame.nodes as Node[])
          return
        }
        // 心跳帧：只更新"还活着"，不动数据。
        if (typeof frame.beat === "number") {
          beats = true
          setBeatSeen(true)
        }
      }
      socket.onopen = () => {
        // 连上了 ⇒ 退避归零，下一次断开从 1 秒重新开始。
        attempt = 0
        setLive(true)
        // ⚠️ **连上就把轮询停掉** ✓ —— 放在 `onmessage` 里时，一个安静的集群（快照没变
        // hub 就不发包）会让轮询继续跑几十秒，而那期间 WS 明明已经通了。
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        // 卸载之后不再碰任何状态。
        if (disposed) return
        // The fallback poll below still updates the figures, at a fifth of the
        // rate; `live` is about the stream, which is what the page says.
        setLive(false)
        // 401 之后重连没有意义。
        if (unauthorized) return
        poll ??= setInterval(fetchOnce, 5000)
        retry = setTimeout(connect, backoff())
      }
    }
    connect()

    // ⚠️ **半开的连接不会自己死** ✗✗：中间盒静默丢弃之后，TCP 可能几十分钟才超时，
    // 而 socket 一直是 open ⇒ 页面不重连、只是数字停住。既然 hub 每 10 秒发心跳，
    // 那 60 秒一帧都没有就是"这条连接已经没用了" ⇒ 关掉它，让 onclose 里的重连接管。
    // 只在对方确实会心跳时启用（`beats`），否则安静机群会被误杀。
    const watchdog = setInterval(() => {
      if (!beats || seen.current === 0) return
      if (Date.now() - seen.current > 60_000) socket?.close()
    }, 15_000)

    return () => {
      disposed = true
      clearInterval(watchdog)
      socket?.close()
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
    }
  }, [])

  return { nodes, error, closed, updatedAt, live, lastSeen, beatSeen }
}
