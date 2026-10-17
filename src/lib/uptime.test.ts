// The uptime figures are the one place on this page where a wrong number is
// worse than no number -- a healthy node reading as 23% available is the failure
// this file exists to prevent -- so the derivations the card and the bar share
// are checked here rather than trusted. Run with `npm test`: Node strips the
// types itself, so this needs no runner or dependency.
//
// Nothing imports it, so the bundle never includes it.
import {
  availabilityText, missingMinutes, minuteLabel, outageLength, segmentSpan, segmentText,
  calendarCells, segmentTone, spanHint, stillDown, TONE_LABEL, windowLabel, type Incident, type Segment,
} from "./uptime.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// spanHint: 数据明显短于请求的窗口时说出来；够长就不说。
{
  const hour = 3_600
  const pts = (spanHours: number) => [
    { ts: 1_700_000_000 },
    { ts: 1_700_000_000 + spanHours * hour },
  ]
  eq(spanHint(pts(90), 90) === "", true, "整窗口都给到了 ⇒ 不说话")
  eq(spanHint(pts(80), 90) !== "", true, "八成就提示（差一成以上）")
  eq(spanHint(pts(3), 90).includes("3"), true, "提示里带上实际跨度")
  eq(spanHint(pts(3).slice(0, 1), 90), "", "一个点算不出跨度 ⇒ 不说")
}

// windowLabel: derived from the window, never from the nominal span. The hub
// reports minute-aligned ends, so a week is 10079 minutes and truncation would
// print it as "近 6 天".
const T = 1_800_000_000
eq(windowLabel(T - 7 * 86_400, T), "近 7 天", "整七天")
eq(windowLabel(T - 30 * 86_400, T), "近 30 天", "整三十天")
eq(windowLabel(T - (7 * 86_400 - 60), T), "近 7 天", "整七天少一分钟仍是近 7 天")
eq(windowLabel(T - 3 * 86_400 - 180, T), "近 3 天", "三天加三分钟仍是近 3 天")
eq(windowLabel(T - 86_400, T), "近 1 天", "一天")
eq(windowLabel(T - 3_600, T), "近 1 小时", "一小时")
eq(windowLabel(T - 1_800, T), "近 30 分钟", "半小时")
eq(windowLabel(T - 30, T), "近 1 分钟", "不足一分钟也不写近 0 分钟")
eq(windowLabel(T, T), "刚刚加入", "空窗口")
eq(windowLabel(T, T - 60), "刚刚加入", "反向窗口不产生负数")

// availabilityText: two decimals, and exactly one as "100%".
eq(availabilityText(1), "100%", "满勤写 100% 而不是 100.00%")
eq(availabilityText(0.9985), "99.85%", "两位小数")
eq(availabilityText(0.9985123), "99.85%", "第三位不进位")
eq(availabilityText(0.99855), "99.86%", "第三位进位")
eq(availabilityText(0.99999), "100%", "四舍五入到满值也写 100%")
eq(availabilityText(0), "0.00%", "从未上报")
eq(availabilityText(Number.NaN), "—", "缺失值不写数字")
eq(availabilityText(1.4), "100%", "超过一不打印 140%")

// segmentTone: four states, and the partial-hour rule. A partial first or last
// hour is green when it is full, which is why `n` is compared against the
// segment's own `m` and not against 60.
const seg = (n: number, m: number, known = true): Segment => ({ ts: T, n, m, known })
eq(segmentTone(seg(60, 60)), "ok", "整小时满")
eq(segmentTone(seg(44, 44)), "ok", "残桶满也是绿")
eq(segmentTone(seg(58, 60)), "warn", "缺两分钟是黄")
eq(segmentTone(seg(1, 60)), "warn", "只报了一分钟也是黄")
eq(segmentTone(seg(0, 60)), "down", "整小时没报是红")
eq(segmentTone(seg(0, 0)), "down", "空桶不画成绿")
eq(segmentTone(seg(5, 0)), "down", "不可能的组合不画成绿")
// 无数据 is not a shade of 离线: an hour before the node existed is not an outage.
eq(segmentTone(seg(0, 60, false)), "unknown", "节点不存在的那一小时是无数据而不是离线")
eq(segmentTone(seg(60, 60, false)), "unknown", "unknown 永远压过 n/m")

// segmentText: the words the tooltip and a screen reader share.
eq(segmentText(seg(60, 60)), "正常", "满覆盖段不再重复分钟数（轴上一片绿已说明）")
eq(segmentText(seg(24, 24)), "正常", "满覆盖的部分小时同样不报分钟")
eq(segmentText(seg(48, 60)), "部分异常 · 上报 48/60 分钟", "部分异常段的读法")
eq(segmentText(seg(0, 60)), "离线 · 上报 0/60 分钟", "离线段的读法")
eq(segmentText(seg(0, 60, false)), "无数据 · 该时段没有上报记录", "无数据段不报 n/m")
eq(Object.keys(TONE_LABEL).length, 4, "图例四个状态")

// Segment labels: an hour names an instant, anything wider names its stretch, and
// a day is written as two dates rather than "00:00 – 00:00".
{
  const at = (h: number, m = 0) => new Date(2026, 8, 22, h, m, 0).getTime() / 1_000
  eq(segmentSpan(at(3), 1), "9月22日 03:00", "一小时段写起点")
  eq(segmentSpan(at(0), 3), "9月22日 00:00 – 03:00", "三小时段写起止")
  eq(segmentSpan(at(0), 24), "9月22日 – 9月23日", "一天段写两个日期")
}

// outageLength: two units at most, never a zero one.
eq(outageLength(1), "1 分钟", "一分钟")
eq(outageLength(12), "12 分钟", "方案里那个例子")
eq(outageLength(59), "59 分钟", "不足一小时")
eq(outageLength(60), "1 小时", "整小时不带零头")
eq(outageLength(90), "1 小时 30 分", "一小时半")
eq(outageLength(1_440), "1 天", "整天")
eq(outageLength(1_500), "1 天 1 小时", "一天零一小时")
eq(outageLength(2_880), "2 天", "两天")

// minuteLabel: the format the page prints, built from date parts so it does not
// move with the reader's ICU.
eq(minuteLabel(T).includes("月") && minuteLabel(T).includes("日 "), true, "写成 X月X日 HH:MM")
eq(/^\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(minuteLabel(T)), true, `时间戳格式（得到 ${minuteLabel(T)}）`)

// stillDown: an outage that reaches the window's end may or may not have
// recovered; the page says "至今" only there.
{
  const to = T
  const open: Incident = { start: T - 12 * 60, minutes: 12 }
  const closed: Incident = { start: T - 60 * 60, minutes: 12 }
  eq(stillDown(open, to), true, "结束于窗口末尾算进行中")
  eq(stillDown(closed, to), false, "早已恢复的不算进行中")
}

// missingMinutes: the sum of the gaps, and nothing for a full window.
eq(missingMinutes([{ ts: T, n: 60, m: 60 }, { ts: T + 3_600, n: 48, m: 60 }]), 12, "缺 12 分钟")
eq(missingMinutes([{ ts: T, n: 44, m: 44 }]), 0, "残桶满则零")
eq(missingMinutes([]), 0, "空列表")

// calendarCells: 4 小时一格。⚠️ 一格里的四个小时里只要有一小时**完全没上报**，
// 这一格就必须是**离线** —— 把四小时的分钟数相加再判会把那次中断稀释成"部分异常"
// （3 小时正常 ⇒ n/m = 0.75），那就把一次真实的中断画轻了。
{
  const HOUR = 3_600
  const to = Math.floor(Date.parse("2026-10-16T12:00:00Z") / 1_000)
  const t0 = Math.floor((to - 4 * HOUR) / (4 * HOUR)) * 4 * HOUR
  // 一格就是一小时 ⇒ 那一小时完全没上报，这一格就是离线（不再有"被稀释"的可能 ✓）。
  const withGap = calendarCells({ from: t0, to, incidents: [], buckets: [
    { ts: t0, n: 60, m: 60 }, { ts: t0 + 1 * HOUR, n: 60, m: 60 },
    { ts: t0 + 2 * HOUR, n: 0, m: 60 }, { ts: t0 + 3 * HOUR, n: 60, m: 60 },
  ] })
  const gapCell = withGap.filter((c) => c.m > 0 && c.n === 0)
  // 桶宽一小时、格子半小时 ⇒ 那个桶铺到它覆盖的两格上，两格都该是离线。
  eq(gapCell.length, 2, `完全没上报的那个小时铺到的两格（得到 ${gapCell.length} 格）`)
  eq(gapCell.every((c) => c.tone === "down"), true, `那两格都必须是离线`)

  const empty = calendarCells({ from: to, to, incidents: [], buckets: [] })
  eq(empty.length, 336, "7 行 × 48 格 = 336 格")
  eq(empty.every((c) => c.tone === "unknown"), true, "没有桶的格子是无数据，不是离线")

  const full = calendarCells({ from: t0, to, incidents: [], buckets: [
    { ts: t0, n: 60, m: 60 }, { ts: t0 + 1 * HOUR, n: 60, m: 60 },
    { ts: t0 + 2 * HOUR, n: 60, m: 60 }, { ts: t0 + 3 * HOUR, n: 60, m: 60 },
  ] })
  eq(full.filter((c) => c.m > 0).every((c) => c.tone === "ok"), true, "四小时都满 ⇒ 正常")

  const partial = calendarCells({ from: t0, to, incidents: [], buckets: [
    { ts: t0, n: 60, m: 60 }, { ts: t0 + 1 * HOUR, n: 60, m: 60 },
    { ts: t0 + 2 * HOUR, n: 60, m: 60 }, { ts: t0 + 3 * HOUR, n: 30, m: 60 },
  ] })
  // 一格一桶之后，要看的是**那一格**，不能再断言所有带 m 的格子：
  // 那是四小时合并成格时的写法（四个桶落在同一格里）。
  const part = partial.filter((c) => c.n > 0 && c.n < c.m)
  // 桶宽一小时、格子半小时 ⇒ 那个不满的桶同样铺到两格上。
  eq(part.length, 2, `有上报但不齐的桶铺到的两格（得到 ${part.length} 个）`)
  eq(part.every((c) => c.tone === "warn"), true, `那两格都是部分异常`)

  // ⚠️ **分钟数不能算两遍** ✗✗ —— 旧 hub 不认识 `slot=1800`、按小时分桶时，一个桶铺两格；
  // 旧行为是每格都整份累加 ⇒ 两格各写「30/60 分钟」（分母 60 而跨度只有 30，同一小时算了两次）。
  const spread = calendarCells({ from: to, to, incidents: [], buckets: [
    { ts: t0 + 3 * HOUR, n: 30, m: 60 },
  ] })
  const filled = spread.filter((c) => c.m > 0)
  eq(filled.length, 2, "一小时桶铺两格")
  eq(filled.reduce((a, c) => a + c.n, 0), 30, "两格的 n 加起来仍是 30")
  eq(filled.reduce((a, c) => a + c.m, 0), 60, "两格的 m 加起来仍是 60")
  eq(filled.every((c) => c.n / c.m === 0.5), true, "每一格自己的比例仍是对的（15/30）")
}
// ⚠️ 窗口对齐到本地零点之后，七行（星期）拿到的日期必须落在**同一周**里：
// 请求 168 小时会跨 8 个自然日，不对齐就会出现两行拿着一周前的日期（看着像"更旧"）。
{
  const HOUR = 3_600
  const now = Math.floor(Date.parse("2026-10-16T22:15:00+08:00") / 1_000)
  const buckets = []
  for (let h = 0; h < 168; h++) buckets.push({ ts: now - h * HOUR, n: 60, m: 60 })
  const cells = calendarCells({ from: now - 168 * HOUR, to: now, incidents: [], buckets })
  const dates = new Set(cells.filter((c) => c.m > 0).map((c) => new Date(c.ts * 1_000).toDateString()))
  eq(dates.size, 7, `只应有 7 个自然日（得到 ${dates.size}）`)
  const days = [...dates].map((d) => new Date(d).getTime()).sort((a, b) => a - b)
  eq((days[days.length - 1] - days[0]) / 86_400_000, 6, "首尾日期相差恰好 6 天")
}



if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("uptime 校验未通过")
}
console.log("uptime 校验通过")
