// The uptime figures are the one place on this page where a wrong number is
// worse than no number -- a healthy node reading as 23% available is the failure
// this file exists to prevent -- so the derivations the card and the bar share
// are checked here rather than trusted. Run with `npm test`: Node strips the
// types itself, so this needs no runner or dependency.
//
// Nothing imports it, so the bundle never includes it.
import {
  availabilityText, missingMinutes, minuteLabel, outageLength, segmentSpan, segmentsFor, segmentText,
  segmentTone, stepHours, stillDown, TONE_LABEL, windowLabel, type Availability, type Incident, type Segment,
} from "./uptime.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
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
eq(segmentText(seg(60, 60)), "正常 · 上报 60/60 分钟", "正常段的读法")
eq(segmentText(seg(24, 24)), "正常 · 上报 24/24 分钟", "部分小时按它自己的 m 读")
eq(segmentText(seg(48, 60)), "部分异常 · 上报 48/60 分钟", "部分异常段的读法")
eq(segmentText(seg(0, 60)), "离线 · 上报 0/60 分钟", "离线段的读法")
eq(segmentText(seg(0, 60, false)), "无数据 · 该时段没有上报记录", "无数据段不报 n/m")
eq(Object.keys(TONE_LABEL).length, 4, "图例四个状态")

// stepHours: the width is chosen so the segment count stays countable, whatever
// the window. One hour per segment is right for a day and absurd for a month.
eq(stepHours(1), 1, "一小时窗就是一段")
eq(stepHours(6), 1, "六小时窗仍然一小时一段")
eq(stepHours(24), 1, "一天窗一小时一段（24 段）")
eq(stepHours(48), 1, "两天仍是 48 段，仍在带内")
eq(stepHours(72), 2, "三天改用两小时一段（36 段）")
eq(stepHours(168), 3, "一周改用三小时一段（56 段）")
eq(stepHours(720), 12, "三十天改用十二小时一段（60 段）")
eq(stepHours(2160), 24, "九十天改用一天一段（90 段）")
for (const h of [1, 6, 24, 48, 72, 168, 720, 2160]) {
  const n = Math.ceil(h / stepHours(h))
  eq(n <= 90, true, `${h} 小时窗的段数不超过 90（得到 ${n}）`)
}

// segmentsFor: the bar always covers the period it claims, in segments of that
// width. The hub answers in hours, so they are grouped; the padding is cut on the
// same grid and stops at the first measured segment, which may begin before
// `from` -- two segments over one stretch would be a lie about the width.
{
  const to = T
  const buckets = [
    { ts: to - 7_200, n: 60, m: 60 },
    { ts: to - 3_600, n: 30, m: 60 },
  ]
  const full: Availability = { from: to - 7_200, to, buckets, incidents: [] }
  const fullSegs = segmentsFor(full, 2)
  eq(fullSegs.length, 2, "窗口已有全部数据时不补任何段")
  eq(fullSegs.every((s) => s.known), true, "也不该有 unknown")

  // Three hours asked for, one hour of history: two hours of 无数据 in front.
  const short: Availability = { from: to - 3_600, to, buckets: [buckets[1]], incidents: [] }
  const shortSegs = segmentsFor(short, 3)
  eq(shortSegs.length, 3, "补到请求的宽度")
  eq(shortSegs.slice(0, 2).every((s) => !s.known && s.m === 60), true, "补的是整段的无数据")
  eq(shortSegs[2].known, true, "最后一段是实测的")
  eq(shortSegs[2].ts, to - 3_600, "补齐的边界与第一个实测段对齐，不重叠")

  const none: Availability = { from: to, to, buckets: [], incidents: [] }
  eq(segmentsFor(none, 2).length, 2, "完全没有数据时整条都是无数据")
  eq(segmentsFor(none, 2).every((s) => segmentTone(s) === "unknown"), true, "且都是 unknown")
}

// Grouping: a week's hours become 3-hour segments, and `m` follows the width --
// the denominator must not stay at 60 when the numerator spans three hours.
{
  const to = T
  const hours = Array.from({ length: 168 }, (_, i) => ({ ts: to - (168 - i) * 3_600, n: 60, m: 60 }))
  const week: Availability = { from: to - 168 * 3_600, to, buckets: hours, incidents: [] }
  const segs = segmentsFor(week, 168)
  // 56 whole segments, and a 57th when the window's own start does not land on the
  // 3-hour grid: the grid is the hub's, and cutting to it can only ever add a
  // partial segment at the front, never drop one.
  eq(segs.length >= 56 && segs.length <= 57, true, `一周合成 56–57 段（得到 ${segs.length}）`)
  const whole = segs.filter((s) => s.m === 180)
  eq(whole.every((s) => s.n === 180), true, "整段的分母与分子都是三小时")
  eq(segs.every((s) => s.m > 0 && s.m <= 180), true, "每段的分母都在 0 与一整段之间")
  eq(segs.reduce((sum, s) => sum + s.m, 0), 168 * 60, "所有段的分母加起来正好是整个窗口的分钟数")
  eq(segs.filter((s) => s.m < 180).length <= 2, true, "最多只有首尾两段是残段（网格切法决定）")
  eq(whole.length >= 55, true, `整段至少 55 个（得到 ${whole.length}）`)

  // One 12-minute outage inside a day still shows: the day is partial, not full.
  const day = hours.map((b, i) => (i === 40 ? { ...b, n: 48 } : b))
  const withGap: Availability = { from: to - 168 * 3_600, to, buckets: day, incidents: [] }
  const gapSegs = segmentsFor(withGap, 168)
  eq(gapSegs.some((s) => segmentTone(s) === "warn"), true, "缺口落在的那一段是部分异常")
  eq(segmentText(gapSegs.find((s) => segmentTone(s) === "warn")!), "部分异常 · 上报 168/180 分钟",
     "粗粒度下仍然精确到分钟")
}

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

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("uptime 校验未通过")
}
console.log("uptime 校验通过")
