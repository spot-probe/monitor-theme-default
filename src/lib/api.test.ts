/// <reference types="node" />
import assert from "node:assert/strict"
import { reconnectDelay, safeNodes, type Node } from "./api.ts"

const node = { id: 1, metrics: { uptime: 100, cpu: 1, load: [0.1, 0.2, 0.3],
  mem_total: 1024, mem_used: 512, swap_total: 0, swap_used: 0, disk_total: 2048, disk_used: 1024,
  net_rx: 10, net_tx: 20, total_rx: 100, total_tx: 200, month_rx: 50, month_tx: 100,
  tcp: 3, udp: 4, procs: 20 } } as Node
assert.equal(safeNodes([node])[0], node)
for (const patch of [{ load: null }, { load: [1, "bad", 3] }, { cpu: "bad" }, { net_rx: Infinity }]) {
  const bad = { ...node, metrics: { ...node.metrics, ...patch } } as unknown as Node
  const result = safeNodes([bad, node])
  assert.equal(result[0].metrics, null)
  assert.equal(result[1], node)
}
// reconnectDelay: 1s 起、翻倍、封顶 30s，并带一半抖动（rand 注入，免得依赖随机数）。
assert.equal(reconnectDelay(0, () => 0), 500, "第一次至少半秒")
assert.equal(reconnectDelay(0, () => 1), 1_000, "第一次最多一秒")
assert.equal(reconnectDelay(1, () => 0), 1_000, "第二次 1–2 秒")
assert.equal(reconnectDelay(3, () => 0), 4_000, "第四次 4–8 秒")
assert.equal(reconnectDelay(99, () => 1), 30_000, "封顶 30 秒")
console.log("invalid live reports are isolated")
console.log("reconnect backoff is bounded and jittered")
