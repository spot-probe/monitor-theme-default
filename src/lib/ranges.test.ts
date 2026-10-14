// The range picker must not offer a window the hub will not answer: a chart shorter
// than the one that was picked reads as lost data. Run with `npm test`.
import { FALLBACK_DAYS, historyDays, MAX_DAYS, rangesFor } from "./ranges.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) {
    failed++
    console.error(`not ok - ${what}\n  got  ${a}\n  want ${b}`)
  }
}

// Nothing said, or nothing usable said: the week this theme has always offered.
eq(historyDays(undefined), FALLBACK_DAYS, "未给配置时按 7 天")
eq(historyDays({}), FALLBACK_DAYS, "没有这个字段时按 7 天")
eq(historyDays({ history_days: 0 }), FALLBACK_DAYS, "0 不是保留天数，按 7 天")
eq(historyDays({ history_days: "abc" }), FALLBACK_DAYS, "读不出数字时按 7 天")
eq(historyDays({ history_days: 90 }), 90, "数字直接用")
eq(historyDays({ history_days: "90" }), 90, "字符串也认（设置值是字符串）")
eq(historyDays({ history_days: 9_999 }), MAX_DAYS, "超过上限按上限")
eq(historyDays({ history_days: 90.7 }), 90, "取整")

// The ladder: never a rung above what the hub keeps.
eq(rangesFor(1).map((r) => r.hours), [1, 6, 24], "保留 1 天：小时级三档")
eq(rangesFor(7).map((r) => r.hours), [1, 6, 24, 168], "保留 7 天：到一周")
eq(rangesFor(30).map((r) => r.hours), [1, 6, 24, 168, 720], "保留 30 天：多一个月")
eq(rangesFor(90).map((r) => r.hours), [1, 6, 24, 168, 720, 2_160], "保留 90 天：多一个季度")
eq(rangesFor(365).map((r) => r.hours), [1, 6, 24, 168, 720, 2_160, 8_760], "保留 365 天：多一年")
// ⭐ 保留期本身也是**一档** ✓：整档不够用的时候，不该让最长的历史看不到 ✓。
eq(rangesFor(200).map((r) => r.hours), [1, 6, 24, 168, 720, 2_160, 4_800], "200 天：整档 + 保留期本身")
// ⚠️ 而与某个整档差不到四分之一时，**不单列那个整档** ✓（并排两个等价的档位像重复 ✓）。
eq(rangesFor(31).map((r) => r.hours), [1, 6, 24, 168, 744], "保留 31 天：不给「30 天」这一档")
eq(rangesFor(92).map((r) => r.hours), [1, 6, 24, 168, 720, 2_208], "保留 92 天：不给「90 天」这一档")
eq(rangesFor(90)[0].label, "1 小时", "档位带中文标签")
// ⚠️ 一天那一档写「1 天」✗ 不是「24 小时」—— 一排档位都以天为单位 ✓
eq(rangesFor(7).map((r) => r.label), ["1 小时", "6 小时", "1 天", "7 天"], "标签用天为单位")
eq(rangesFor(365).at(-1)?.label, "1 年", "一年那一档写「1 年」")
// What the latency chart does with them: it stops at a day, whatever the ladder holds.
eq(rangesFor(90).filter((r) => r.hours <= 24).map((r) => r.hours), [1, 6, 24], "延迟那条只到一天")

if (failed > 0) {
  console.error(`${failed} 项未通过`)
  process.exit(1)
}
console.log("ranges: 全部通过")
