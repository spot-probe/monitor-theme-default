# monitor-theme-default

[monitor](https://github.com/monitor-probe/monitor) 的内置默认主题，同时作为第三方主题的参考实现。

React + Vite + shadcn/ui，浅色语义配色。状态由圆点与文字承载，徽章底色因此是中性的
`bg-card` 加描边，而不是每种状态一个淡色底。

## 开发

启动一个 hub 实例：

```bash
monitor-hub --listen 127.0.0.1:9911 --db /tmp/monitor.db --site http://127.0.0.1:9911
```

启动开发服务器，Vite 将 `/api` 与 WebSocket 代理至 hub：

```bash
npm ci
npm run dev
```

构建产物位于 `dist/`。提交前运行 `npm run build && npm run lint && npm test`。

`npm test` 校验数字格式化和实时指标的输入边界。没有测试框架，Node 自己剥掉
类型，失败时退出码非零。

## 主题包

一个可安装主题是一个目录，名字必须与 `theme.json` 的 `short` 相同：

### 版本号

`theme.json` 的 `version` 是**唯一来源**，`package.json` 与 `package-lock.json` 必须与它相同
（CI 会核对这三处，release 流程还会核对 tag 与 `theme.json`）。改版本用：

```bash
npm version --no-git-tag-version 1.7.2   # 前两处
# 再把 theme.json 的 version 改成同一个值
```

为什么较真：hub 判断"这个主题有没有新版"用的是 release tag 与已装 `theme.json` 版本是否
不同，三处不一致就会一直提示更新，而 tag 一旦推出去既不能改也不能删。

```text
<themes-dir>/<short>/
├── theme.json
├── preview.png        # 可选，面板上的预览图
└── dist/
    └── index.html
```

`theme.json` 除 `api` 外均为字符串：

| 字段 | 含义 |
|---|---|
| `name` | 显示名称 |
| `short` | 唯一短名，限字母、数字、`-`、`_`，取 `default` 则顶替 hub 内置的那份 |
| `description` | 简介 |
| `version` | 主题版本 |
| `author` | 作者 |
| `url` | 源码地址。指向 `https://github.com/<owner>/<repo>` 时后台才会给这个主题「从 GitHub 更新」 |
| `api` | 数字，主题要求的**最低**主题 API 等级，省略为 1 |

每个 tag 的 release 里的 `theme.tar.gz` 解开就是这个目录——hub 构建时嵌入的是同一个包，
安装器首次安装时也会拉一份到 `themes/default/`，两者是同一个归档。

`api` 只写**没有它就跑不起来**的等级，不要写「用到了哪些新字段」：hub 比主题旧的常见情形是
主题少画一条线（例如没有 `swap_used` 就不画 Swap），那种降级比让整个公开页拒绝加载好得多。
写高了 hub 会拒绝安装、也不会服务这份主题，后台会说明原因。等级表见 `monitor` 仓库的
`frontend::THEME_API`。

将目录复制到 hub 的 `--themes` 位置，在后台「主题」页切换，无需重启。

## 主题契约

主题是纯静态 SPA，只能依赖下列同源接口：

| 接口 | 用途 |
|---|---|
| `GET /api/me` | 站点名、登录状态、公开页开关、`history_days`（hub 保留多少天） |
| `GET /api/nodes` | 节点列表、实时指标和累计流量 |
| `GET /api/nodes/{id}/metrics` | 历史指标、延迟记录、可用率日历 |
| `GET /api/ws` | 每 2 秒推送一次节点快照的 WebSocket |
| `GET /api/themes/{short}/config` | 这个主题自己的设置项（匿名条件与 `/api/nodes` 相同） |
| `GET /site-icon/{tab,apple,og}` | 站点图标；站长没设置时 302 到主题自带的 `/favicon.svg`、`/apple-touch-icon.png`、`/og.png` |

后两个不在「四个接口」里，但参考实现自己在用：主题的设置项要能声明与读取，页头与
`index.html` 的图标要走站点设置，否则站长在后台换了图标、页面不跟着变。

`metrics` 的查询参数都可省：

- `hours=N` 窗口宽度。**上限是 hub 自己的保留期**（`history_days × 24`），匿名与登录**同一套**
  —— 超出静默 clamp。想画多宽就先读 `/api/me` 的 `history_days`，别自己写死。
- `points=W` 调用方画得下的点数，只会让 hub 抽得更稀，不会更密
- `series=metrics|ping|availability` 只取要画的那部分，省掉的部分原本占响应的大半
- `slot=S` 可用率分桶宽度（秒）。**旧 hub 会忽略它**并按小时分桶——画格子时按返回桶的真实
  宽度切分，否则一格会算到整小时的分钟数

探测曲线的名字在响应的 `probes` 里随样本一起下发，匿名可读，所以画延迟图不需要第二个请求，也不
需要管理员身份。

整个窗口的丢包率在响应的 `loss` 里，按探测 id 给出百分比，没丢包的探测不出现。**不要拿样本行里
的 `loss` 自己平均**：那一个是所在桶的百分比，除数已经丢了，而各桶样本数天然不等——窗口首尾两桶
本来就是残缺的，探测启停、节点掉线、agent 跳过一轮都会再造几个。十三次里丢一次，平均桶百分比会
算出 50%。

匿名访问 `GET /api/nodes` 仅返回 `public=1` 的节点，响应中不含 `ip`、`hostname`、`remark`。字段定义以 hub 的 `src/api.rs` 为准。

未知路径回落到主题的 `dist/index.html`，客户端路由可用。`/admin/*` 由 hub 内置后台接管，不属于主题契约。

本主题用 `/node/{id}` 作为详情页。hub 的回落对它够用，但**hub 前面若有按路径做正向白名单的反代
或 WAF，得把这个前缀放行**：从列表点进去只是 pushState，边缘看不见，刷新详情页才会真的请求
`/node/{id}`，症状是「点进去正常，一刷新就被拦」。

## 许可

MIT
