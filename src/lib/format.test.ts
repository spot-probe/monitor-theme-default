// Every figure on the page passes through this file, making it the one place
// worth a check. Run it with `npm test`: Node strips the types itself, so this
// requires no runner, framework or dependency.
//
// Nothing imports it, so the bundle never includes it.
import {
  axisBytes, axisTop, bytes, cpuName, cycle, daysUntil, despike, expiryDays, money, osName, pair, percent, quarters, rateAxis,
  RATE_FLOOR, tickClock, timeTicks, uptime,
} from "./format.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// bytes: the significant-digit ladder, and the sub-byte case that would
// otherwise print "512 undefined".
eq(bytes(0), "0 B", "bytes(0)")
eq(bytes(0.5), "0 B", "bytes(0.5) 不能落到 UNITS[-1]")
eq(bytes(-1), "0 B", "bytes(负数)")
eq(bytes(1023), "1023 B", "bytes 在 B 档不带小数")
eq(bytes(1024), "1.00 KB", "bytes(1 KiB)")
eq(bytes(10 * 1024), "10.0 KB", "两位数留一位小数")
eq(bytes(100 * 1024), "100 KB", "三位数不留小数")
eq(bytes(1024, 1), "1.0 KB", "digits 覆盖默认档位")

// pair: one unit when both sides share it, two when they do not.
eq(pair(300 * 1024 ** 2, 900 * 1024 ** 2), "300.00 / 900.00 MB", "同单位只写一次")
eq(pair(300 * 1024 ** 2, 3 * 1024 ** 3), "300 MB / 3.00 GB", "跨单位各写各的")

// axisBytes: ticks under three digits keep one decimal, or a narrow axis repeats
// a label; a trailing .0 adds nothing.
eq(axisBytes(3.2 * 1024 ** 3), "3.2 GB", "窄轴刻度保留一位")
eq(axisBytes(2 * 1024 ** 3), "2 GB", "整数刻度不写 .0")
eq(axisBytes(0), "0 B", "零刻度")

// axisTop: the top is derived from a round gridline, so quarters() lands on round
// values in the unit the axis is printed in. Used for utilisation only -- a rate
// spans orders of magnitude and goes through `rateAxis` below.
eq(axisTop(0.4, 4, 100), 4, "闲置机器拿到地板值")
eq(axisTop(63, 4, 100), 80, "63% -> 0/20/40/60/80")
eq(axisTop(200, 4, 100), 100, "百分比封顶")
// ⚠️ 字节轴那四条断言**随 1024 阶梯一起删掉了** ✓ —— 那条路已经不存在 ✗
//（速率图换成 `rateAxis` 的对数轴 ✓，见下面的用例 ✓）。
eq(quarters(axisTop(25_000_000, 4, 25_000_001)).length, 5, "四条网格线，加 0")

// rateAxis: a logarithmic byte axis, each gridline a round label. The bottom is the
// slowest rate drawn (never below 1 KB/s, since a log axis has no zero) and the top
// the highest peak, so an idle line and a burst are both readable on one panel.
{
  const axis = (low: number, high: number) => {
    const { domain, ticks } = rateAxis(low, high)
    return [domain.map(axisBytes), ticks.map(axisBytes)]
  }
  eq(axis(209, 70 * 1024 ** 2), [["1 KB", "100 MB"], ["1 KB", "10 KB", "100 KB", "1 MB", "10 MB", "100 MB"]],
     "空闲 209 B/s 落在标了的底上，突发 70 MB/s")
  eq(axis(744, 229 * 1024 ** 2), [["1 KB", "1 GB"], ["1 KB", "100 KB", "10 MB", "1 GB"]], "七档隔一档标")
  eq(axis(300, 1.5 * 1024 ** 3), [["1 KB", "10 GB"], ["10 KB", "1 MB", "100 MB", "10 GB"]], "八档从顶往下数")
  eq(axis(5 * 1024 ** 2, 80 * 1024 ** 2), [["1 MB", "100 MB"], ["1 MB", "10 MB", "100 MB"]], "底随最慢的速率上移")
  eq(axis(1100, 5100), [["1 KB", "10 KB"], ["1 KB", "10 KB"]], "不到一档时也有一档")
  eq(axis(1024, 1024), [["1 KB", "10 KB"], ["1 KB", "10 KB"]], "正好落在档上")
  eq(axis(0, 0), [["1 KB", "10 KB"], ["1 KB", "10 KB"]], "全是零")
  eq(axis(Infinity, 0), [["1 KB", "10 KB"], ["1 KB", "10 KB"]], "空窗口：最小值的初值是 Infinity")
  eq(RATE_FLOOR, 1024, "底是 1 KB/s")
}

// timeTicks: round clock values, phased on local midnight rather than the epoch,
// and never more than requested.
{
  const day = 86_400_000
  const to = Date.now()
  const ticks = timeTicks(to - day, to)
  eq(ticks.length <= 8, true, `24 小时窗最多 8 个刻度（得到 ${ticks.length}）`)
  eq(
    ticks.every((t) => new Date(t).getMinutes() === 0 && new Date(t).getSeconds() === 0),
    true,
    "刻度落在整点上",
  )
  eq(
    ticks.every((t, i) => i === 0 || t - ticks[i - 1] === ticks[1] - ticks[0]),
    true,
    "刻度间距均匀",
  )
  eq(timeTicks(to, to - day), [], "反向区间不产出刻度")
}

// percent: 没有容量是"未知"，不是 0% —— 每一张卡、每一行表格都经过它。
eq(percent(50, 100), 50, "正常百分比")
eq(percent(200, 100), 100, "上限封顶 100")
eq(percent(1, 0), null, "没有容量 ⇒ 未知，不是 0%")
eq(percent(0, 0), null, "0 / 0 也是未知")
eq(percent(1, -1), null, "负容量同样是说不清")

// daysUntil: whole days, negative once past, null when there is no date.
{
  const at = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }
  eq(daysUntil(at(10)), 10, "十天后")
  eq(daysUntil(at(-3)), -3, "已过期为负")
  eq(daysUntil(null), null, "无到期日")
  eq(daysUntil("不是日期"), null, "无法解析的日期")

  // expiryDays: hub 的日历优先 —— 卡片、表格、筛选必须用**同一个**数字。
  // `0`（今天到期）是有效值，不能因为"看起来像没给"就退回访客时钟。
  eq(expiryDays(3, at(10)), 3, "有 expires_in 就用它，与访客时钟无关")
  eq(expiryDays(0, at(10)), 0, "0 是有效值（今天到期）")
  eq(expiryDays(undefined, at(10)), 10, "旧 hub 没有这个字段 ⇒ 退回 daysUntil")
  eq(expiryDays(null, at(-2)), -2, "null 也退回")
}

eq(uptime(0), "—", "没上报过就不写时长")
eq(uptime(90), "1 分", "不足一小时")
eq(uptime(3 * 3600 + 25 * 60), "3 小时 25 分", "不足一天")
eq(uptime(2 * 86400 + 5 * 3600), "2 天 5 小时", "超过一天不再写分钟")
eq(uptime(2 * 86400), "2 天", "整天的零头不写")
eq(uptime(3 * 3600), "3 小时", "整小时的零头不写")

// despike：孤立的尖峰被拉回邻域，持续的高延迟保留，超时仍是缺口。
{
  const flat = [20, 21, 20, 22, 21, 20, 21]
  eq(despike(flat), flat, "没有离群点就原样返回")
  eq(despike([20, 21, 20, 900, 21, 20, 21])[3], 21, "孤立尖峰替换为窗口中位数")
  // 一段持续的高延迟是真实状况而非尖峰：窗口内多数样本同样高，中位数随之抬高。
  eq(despike([20, 21, 300, 310, 305, 300, 21, 20]).slice(2, 6), [300, 310, 305, 300], "持续升高不被削掉")
  eq(despike([20, null, 900, null, 21]), [20, null, 21, null, 21], "超时保持为缺口，不参与比较")
  // 延迟以整毫秒存储，稳定线路的窗口内多数样本完全相同，绝对中位差为 0。没有 1 ms
  // 下限时这一条会失败，而它正是削峰要处理的形状：平直的线加一个 2 秒的桶。
  eq(despike([180, 180, 181, 180, 2000, 180, 180, 181, 180])[4], 180, "平直线路上的尖峰同样被削掉")
  // 下限不能低到把正常抖动当成尖峰：整毫秒数据里 1 ms 的起伏是常态。
  eq(despike([180, 181, 180, 180, 181, 180, 180]), [180, 181, 180, 180, 181, 180, 180], "1 ms 抖动原样保留")
}

eq(osName("Debian GNU/Linux 12 (bookworm)"), "Debian 12", "发行版名去掉代号")
eq(cpuName("Intel(R) Xeon(R) CPU E5-2680 8-Core Processor"), "Intel Xeon E5-2680", "CPU 名去掉商标和核数")

// 旧 hub 存名称，新 hub 把其余长度存成 `<n>m`；同一个长度两种写法读出来一样，
// 而认不出的周期原样显示，不吞掉。
eq(
  ["monthly", "yearly", "12m", "60m", "18m", "biennial", "36m", "once", "weekly"].map(cycle),
  ["月", "年", "年", "5 年", "18 个月", "两年", "三年", "一次性", "weekly"],
  "付款周期",
)

// 货币一律放在数字前面：代码跟在数字后面（`100.00 HKD`）与 `$100.00` 同列看着是两种
// 风格。原来那五个符号保持不变，其余借 Intl 的完整符号。
eq(
  ["USD", "CNY", "EUR", "GBP", "JPY", "HKD", "TWD", "SGD", "KRW", "XYZ", "USDT", ""].map((c) =>
    money(1234.5, c),
  ),
  [
    "$1,234.50", "¥1,234.50", "€1,234.50", "£1,234.50", "¥1,235",
    // Intl 用 U+00A0 分隔代码与金额，回退那条也一样：普通空格会让价格从两
    // 者之间折行。
    "HK$1,234.50", "NT$1,234.50", "SGD\u00A01,234.50", "₩1,235",
    "XYZ\u00A01,234.50", "USDT\u00A01,234.50", "1,234.50",
  ],
  "货币显示",
)

// Past two weeks the ticks land on the first of a month: months differ in length, so
// no fixed step can land on one. They are still local midnights, and the label drops
// the time once every tick is one -- "00:00" beside each says nothing.
{
  const day = 86_400_000
  const from = new Date(2026, 0, 15).getTime()
  const year = timeTicks(from, from + 365 * day)
  eq(year.length >= 4 && year.length <= 8, true, "一年的窗口给 4–8 个刻度")
  eq(year.every((t) => new Date(t).getDate() === 1), true, "月刻度每一格都是 1 号")
  eq(year.every((t) => new Date(t).getHours() === 0), true, "月刻度落在本地零点")
  eq(tickClock(year, 8_760)(year[0]).includes(":"), false, "刻度全是零点时只写日期")
  const six = timeTicks(from, from + 6 * 3_600_000)
  eq(six.length, 7, "六小时窗口给 7 个刻度")
  eq(tickClock(six, 6)(six[0]).includes(":"), true, "有非零点时写回时刻")
  eq(tickClock([], 6)(from).includes(":"), true, "一个刻度都没有时退回窗口自己的格式")
}

// ⚠️ 夏令时：日尺度刻度跨过切换点会漂一小时 ✗（相位对齐治不了这个 ✓ —— 实测在
// America/New_York 下切换后的四个刻度会落在 01:00 ✗）。断言写成"落点是本地零点" ✓，
// 在任何时区都成立 ✓，而在有夏令时的时区里才有牙齿 ✓。
{
  const day = 86_400_000
  const before = new Date(2026, 2, 5).getTime()
  const daily = timeTicks(before, before + 7 * day, 7)
  eq(daily.length, 8, "七天窗口给 8 个日刻度")
  eq(daily.every((t) => new Date(t).getHours() === 0), true, "跨夏令时的日刻度仍落在本地零点")
}

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("format 校验未通过")
}
console.log("format 校验通过")
