import type { Node } from "@/lib/api"
import { expiryDays } from "@/lib/format"
// `deployed` 定义在卡片里（"未接入"这个说法本来就属于展示层）；这里转出去一层，
// 免得取筛选谓词的地方都得知道它住在哪个组件里。
import { deployed } from "@/components/NodeCard"
export { deployed }

/**
 * Group tabs.
 *
 * A group is a name the hub attaches to a node -- the operator's own categories,
 * not something derived here. Nothing sends that field yet, so `groupNames` comes
 * back empty against a real hub and the tab row is not rendered at all: a lone
 * "全部节点" tab would be a control that cannot do anything, the same objection as
 * a total that only repeats the card above it.
 *
 * The field name has to match whatever the hub ends up calling it.
 */
export function groupNames(nodes: Node[]): string[] {
  const seen: string[] = []
  for (const node of nodes) {
    const name = node.group?.trim()
    if (name && !seen.includes(name)) seen.push(name)
  }
  return seen
}

/** The selected group, or `null` for 全部节点. */
export function inGroup(node: Node, name: string | null): boolean {
  return name === null || (node.group?.trim() ?? "") === name
}

/** One thing worth narrowing the fleet to. */
export type FilterKey = "loaded" | "offline" | "expiring" | "expired" | "unreported"

export const FILTERS: {
  key: FilterKey
  label: string
  tone?: string
  test: (node: Node) => boolean
}[] = [
  // The order is the order of the questions an operator asks: what is on fire,
  // what has stopped answering, what is about to cost money.
  { key: "loaded", label: "高负载", tone: "text-warn-fg", test: (n) => (n.metrics?.cpu ?? 0) >= 80 },
  { key: "offline", label: "离线", tone: "text-danger-fg", test: (n) => !n.online && deployed(n) },
  { key: "expiring", label: "即将到期", tone: "text-warn-fg", test: (n) => within(n, 0, 30) },
  { key: "expired", label: "已过期", tone: "text-danger-fg", test: (n) => within(n, null, -1) },
  { key: "unreported", label: "未接入", test: (n) => !deployed(n) },
]

function within(node: Node, from: number | null, to: number): boolean {
  const days = expiryDays(node.expires_in, node.expires_at)
  if (days === null) return false
  return from === null ? days < 0 : days >= from && days <= to
}

export function matches(node: Node, keys: FilterKey[]): boolean {
  return keys.every((key) => FILTERS.find((f) => f.key === key)?.test(node) ?? true)
}
