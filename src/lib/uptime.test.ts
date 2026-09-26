// The uptime figures are the one place on this page where a wrong number is
// worse than no number -- a healthy node reading as 23% available is the failure
// this file exists to prevent -- so the derivations the card and the bar share
// are checked here rather than trusted. Run with `npm test`: Node strips the
// types itself, so this needs no runner or dependency.
//
// Nothing imports it, so the bundle never includes it.
import {
  availabilityText, missingMinutes, minuteLabel, outageLength, segmentsFor, segmentText, segmentTone,
  stillDown, TONE_LABEL, windowLabel, type Availability, type Incident, type Segment,
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

// segmentsFor: the bar always covers the period it claims. The hub clamps its
// answer to the node's life, so the front has to be put back as 无数据 -- and the
// padding must stop at the first measured bucket, which may begin before `from`.
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
  eq(shortSegs.slice(0, 2).every((s) => !s.known && s.m === 60), true, "补的是整小时的无数据")
  eq(shortSegs[2].known, true, "最后一段是实测的")
  eq(shortSegs[2].ts, to - 3_600, "补齐的边界与第一个实测桶对齐，不重叠")

  const none: Availability = { from: to, to, buckets: [], incidents: [] }
  eq(segmentsFor(none, 2).length, 2, "完全没有数据时整条都是无数据")
  eq(segmentsFor(none, 2).every((s) => segmentTone(s) === "unknown"), true, "且都是 unknown")
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
