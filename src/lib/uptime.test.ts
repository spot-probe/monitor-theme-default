// The uptime figures are the one place on this page where a wrong number is
// worse than no number -- a healthy node reading as 23% available is the failure
// this file exists to prevent -- so the derivations the card and the bar share
// are checked here rather than trusted. Run with `npm test`: Node strips the
// types itself, so this needs no runner or dependency.
//
// Nothing imports it, so the bundle never includes it.
import {
  availabilityText, barTone, fractionTone, incidentStamp, missingMinutes, outageLength, stillDown,
  windowLabel, type Incident,
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

// barTone: against the bucket's own expected minutes, so a partial first or last
// hour is green when it is full.
eq(barTone(60, 60), "ok", "整小时满")
eq(barTone(44, 44), "ok", "残桶满也是绿")
eq(barTone(58, 60), "warn", "缺两分钟是黄")
eq(barTone(1, 60), "warn", "只报了一分钟也是黄")
eq(barTone(0, 60), "down", "整小时没报是红")
eq(barTone(0, 0), "down", "空桶不画成绿")
eq(barTone(5, 0), "down", "不可能的组合不画成绿")

// fractionTone: the card's three states, at the thresholds the bar uses.
eq(fractionTone(1), "ok", "满勤")
eq(fractionTone(0.995), "ok", "阈值上")
eq(fractionTone(0.9949), "warn", "阈值下一点")
eq(fractionTone(0.9), "warn", "九成")
eq(fractionTone(0.8999), "down", "九成以下")
eq(fractionTone(0), "down", "从未上报")

// outageLength: two units at most, never a zero one.
eq(outageLength(1), "1 分钟", "一分钟")
eq(outageLength(12), "12 分钟", "方案里那个例子")
eq(outageLength(59), "59 分钟", "不足一小时")
eq(outageLength(60), "1 小时", "整小时不带零头")
eq(outageLength(90), "1 小时 30 分", "一小时半")
eq(outageLength(1_440), "1 天", "整天")
eq(outageLength(1_500), "1 天 1 小时", "一天零一小时")
eq(outageLength(2_880), "2 天", "两天")

// incidentStamp: the format the page prints, built from date parts so it does not
// move with the reader's ICU.
eq(incidentStamp(T).includes("月") && incidentStamp(T).includes("日 "), true, "写成 X月X日 HH:MM")
eq(/^\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(incidentStamp(T)), true, `时间戳格式（得到 ${incidentStamp(T)}）`)

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
