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
