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
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (!Number.isFinite(domainTop) || domainTop <= 0 || !(height > 0)) return null
  const y = height - (value / domainTop) * height
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
export function isInternalSeries(key: unknown): boolean {
  return typeof key === "string" && /^[bc]\d+$/.test(key)
}
