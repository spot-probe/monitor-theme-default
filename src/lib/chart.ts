/**
 * The arithmetic behind the resource charts' hover: where the reading under the
 * pointer sits inside the plot, and how wide the chip that prints it has to be.
 *
 * Kept here, apart from the components, because it is the part that can be wrong
 * in a way no screenshot shows -- a crosshair pinned above the plot for a value
 * past the axis top, or a chip that clips its own last digit -- and because the
 * components themselves are untestable without a browser. Run with `npm test`.
 */

/**
 * The y of `value` on a zero-anchored plot `height` tall, clamped to the plot.
 *
 * `null` when there is nowhere to put it: a reading the hub did not send, or an
 * axis with no fixed top (the latency chart scales itself to its own window, so
 * nothing outside the chart knows what a value is worth). The caller draws the
 * vertical line either way; this only decides the horizontal one.
 */
export function crosshairY(
  value: number | null | undefined,
  domainTop: number,
  height: number,
  domainBottom = 0,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (!Number.isFinite(domainTop) || domainTop <= 0 || !(height > 0)) return null
  const clamped = Math.min(height, Math.max(0, value))
  // ⚠️ 速率图是对数轴 ✓（`rateAxis` 的底不是 0 ✗）—— 那时高度按**对数**比例分 ✓，
  // 线性公式会把点画到错的位置 ✓✗（越低越偏 ✓，而那正是平时的流量所在 ✓）。
  if (domainBottom > 0 && domainBottom < domainTop) {
    const v = Math.max(value, domainBottom)
    const y = height - ((Math.log(v) - Math.log(domainBottom)) /
      (Math.log(domainTop) - Math.log(domainBottom))) * height
    return Math.min(height, Math.max(0, y))
  }
  const y = height - (clamped / domainTop) * height
  return Math.min(height, Math.max(0, y))
}

/**
 * How wide the value chip has to be, from the text it carries.
 *
 * An estimate rather than a measurement: the chip is drawn inside the chart's
 * own SVG, once per pointer move, and asking a browser for the text width there
 * would mean a layout read on every one of them. Digits are set in tabular
 * figures at 10px, where 6.2px is the upper bound for an ASCII character, while
 * the arrows the rate chips carry (`↓ 2.4 MB/s`) are full-width glyphs and take
 * the font size itself. Six pixels of inset at each end keep the rounded corners
 * off the glyphs.
 */
export function chipWidth(text: string): number {
  let width = 0
  for (const ch of text) width += ch.codePointAt(0)! > 0x7f ? 10 : 6.2
  return Math.ceil(width) + 12
}

/**
 * 是不是"内部系列"——只为画阴影而存在、不该出现在 tooltip 里的那条带。
 *
 * 延迟图给每个探测建两条内部序列：`b{id}`（均值到峰值的带）与 `c{id}`（裁剪后的带，
 * 见 `NodeDetail` 里那个 rows builder）。它们**已经**在元素上标了 `tooltipType="none"`
 * 与 `legendType="none"`，但实测 `tooltipType` 在这一版 recharts 里**没有被遵守** ——
 * 线上看到过 tooltip 里冒出一行光秃秃的 `b6`（值正好等于该桶的延迟，因为带在缺峰值时
 * 回退成 `[latency, latency]`）。所以真正的排除放在 tooltip 这一侧。
 *
 * 形态写死成"**一个 b 或 c + 一串数字**"，是为了不误伤正常序列（`t6`、`s6`、`l6`、
 * `rx_band`、`ts` 都不匹配）。两端的约定由 `chart.test.ts` 钉住。
 */
/**
 * 速率图的十字线该读哪个数。
 *
 * payload 里第一条是**峰值带**（`rx_band`，值是 `[均值, 峰值]` 数组）—— 拿它算不出 y，
 * 于是横线和数值胶囊都不会出现；而线的值是被抬到每秒 1 KiB 地板之后的数（200 B/s 会被
 * 印成 1 KB/s）。取带的上沿：那是这一段真正的峰值，也是这张图想说的东西。
 * 没有带（`chart_peak` 关着、或老 hub 不给峰值）时退回第一条数值序列。
 */
export function rateCrosshair(
  payload: { dataKey?: unknown; value?: unknown; stroke?: string }[],
): { value: number; stroke?: string } | null {
  const band = payload.find((p) => String(p.dataKey) === "rx_band")
  const range = band?.value
  if (Array.isArray(range) && typeof range[1] === "number") {
    return { value: range[1], stroke: band?.stroke }
  }
  const line = payload.find((p) => typeof p.value === "number")
  return typeof line?.value === "number" ? { value: line.value, stroke: line.stroke } : null
}

export function isInternalSeries(key: unknown): boolean {
  return typeof key === "string" && /^[bc]\d+$/.test(key)
}
