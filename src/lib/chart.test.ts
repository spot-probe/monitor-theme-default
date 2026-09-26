// The hover arithmetic for the resource charts. A crosshair drawn outside its own
// plot, or a value chip that clips its last digit, is the kind of wrong a
// screenshot taken at one pointer position does not catch -- so the two functions
// the hover is built from are checked here instead. Run with `npm test`: Node
// strips the types itself, so this needs no runner or dependency.
//
// Nothing imports it, so the bundle never includes it.
import { chipWidth, crosshairY } from "./chart.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// crosshairY: the plot is zero-anchored and `height` tall, so half the axis is
// half the height and the top of the axis is its top edge.
eq(crosshairY(0, 4, 160), 160, "零在底边")
eq(crosshairY(4, 4, 160), 0, "轴顶在顶边")
eq(crosshairY(1, 4, 160), 120, "四分之一落在四分之三高处")
eq(crosshairY(2, 100, 200), 196, "百分比的刻度")

// Past the axis top it is pinned to the edge rather than drawn over the panel's
// own title: the hub can report a figure above the capacity the axis was built
// from when a machine gains memory without the page being reloaded.
eq(crosshairY(9, 4, 160), 0, "超出轴顶钉在顶边")
eq(crosshairY(-1, 4, 160), 160, "负值钉在底边")

// Nothing to draw: a series with no reading at this bucket, a chart whose axis
// has no fixed top, or a plot that has not been laid out yet.
eq(crosshairY(null, 4, 160), null, "空值不画横线")
eq(crosshairY(undefined, 4, 160), null, "缺字段不画横线")
eq(crosshairY(Number.NaN, 4, 160), null, "NaN 不画横线")
eq(crosshairY(1, 0, 160), null, "没有轴顶就不画横线")
eq(crosshairY(1, 4, 0), null, "没有高度就不画横线")

// chipWidth: monotone in the text, and wide enough for the widest value these
// charts print -- a byte rate, which is the longest string any of them formats.
{
  const texts = ["0 B", "12.5%", "1.9 GB", "958.7 MB", "↓ 2.4 MB/s"]
  eq(texts.every((t) => chipWidth(t) > 0), true, "每个都有宽度")
  const byLength = [...texts].sort((a, b) => a.length - b.length)
  eq(
    byLength.every((t, i) => i === 0 || chipWidth(t) >= chipWidth(byLength[i - 1])),
    true,
    "更长的文字不会更窄",
  )
  // 6.2px per ASCII character at 10px tabular figures plus the 12px inset:
  // `958.7 MB` is eight characters, so 49.6px of text.
  eq(chipWidth("958.7 MB"), 62, "八字符的胶囊")
  // The arrow is a full-width glyph, so it is charged the font size itself:
  // 10 + 9 × 6.2 = 65.8, and the inset rounds it to 78.
  eq(chipWidth("↓ 2.4 MB/s"), 78, "带箭头的胶囊更宽")
  eq(chipWidth("↓ 2.4 MB/s") > chipWidth("2.4 MB/s"), true, "箭头不是免费的")
}

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("chart 校验未通过")
}
console.log("chart 校验通过")
