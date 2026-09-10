---
feature: together-background-sync
status: delivered
updated: 2026-09-10
branch: fix/together-background-sync
commits: 351084b1ed6aa7647a8628ea359467bee234510d..69fd4c71398e660a31a873fad21156e965e0ee59
---

# 一起听 · 后台同步修复

## Report

**What was built** — 一起听在后台/切走时不再拆掉同步链路：父页与 shared 唱片机的 `pagehide` 不再 pause、reset 或停轮询；隐藏页面换碟跳过飞碟/落针直接装载；入座后通过 `GET /api/together/stream` 订阅 SSE（服务端 control/join/leave 推送 + 15s 心跳刷 `seen`），流失败按 0.5s→5s 指数退避重连并回退约 1s HTTP 轮询；回到前台立即 `poll+sync+unlock`。

**Verification** — `node --check` 改动文件通过；`node --test tests/together.test.js tests/server.test.js tests/listening-controls.test.js tests/listening-shared.test.js` 62/62 通过（含订阅推送与 stream 路由用例）；`npm run check` 136/137，唯一失败为 `pinball.test.js`「three drains end the game」——**PRE-EXISTING**，与本次改动无关。桌面双开与 iOS 后台需用户手工复验。

**Journey log** — 首轮 review 抓出 pagehide 仍 abort 选曲、以及 `openStream` 每次开头重置 `streamDelay` 导致退避失效；二者已修并复审通过。SSE 选用 fetch+ReadableStream 而非 EventSource，以保留 `X-Room-Token` 头且不引入 ws 依赖。Web Worker 心跳方案被否：后台 Worker 定时器同样受限，不如服务端推送。

## [S1] Problem

一起听（`/together.html`）在网页进后台后无法继续与房间同步播放。用户可见现象包括：切到其他标签页或切到手机后台后音乐停了；别人切歌/暂停这边跟不上；回前台后仍不同步甚至要重新入座。

根因已定位，三层叠加：

1. **`pagehide` 主动拆链路**：父页 `together.js` 清 poll、`setConnected(false)`；iframe `listening-room.js` 在 `sharedMode` 下 `sharedPlayer.reset()` + `cancelPlayback()`，直接 pause 并卸掉 `audio.src`。iOS Safari 切 App/锁屏常触发 `pagehide`。
2. **后台换碟流水线卡住**：`playRecord` 的飞碟动画 + `lowerTonearm` 串行 `delay()` 不感知 `document.hidden`；后台 `setTimeout` 节流后换碟可拖到分钟级，期间 `loading=true` 使 `sync()` 早退。
3. **定时器节流**：房间 1s 轮询与 iframe 500ms 纠偏全是页面 timer；后台超约 5 分钟进入 intensive throttling（约 1 次/分钟），成员 `seen` 心跳与权威状态拉取都失效。

服务端进度公式与 `together-sync.js` 本身正确；测试也保证「仅 hidden」不 pause 音频。问题在客户端生命周期与传输层。

## [S2] Design

### 目标行为

| 场景 | 期望 |
|------|------|
| 桌面切标签，房间继续播同一首 | 本端音频不断；进度继续纠偏；别人暂停/seek 在秒级内跟随 |
| 后台时别人换歌 | 本端在无动画捷径下加载新曲并跟随，不依赖 rAF/长串 delay |
| iOS 切 App / 锁屏 | 不因 `pagehide` 拔掉 session、pause 音频或 reset 唱片机；回来后自动对齐 |
| 后台挂很久（节流） | 仍有服务端推送/心跳，成员不被 45s 超时踢出；回前台立刻 `poll` + `sync` |
| 浏览器拒绝后台 `play()` | 回前台后自动 `unlock` 并 seek 到目标位置，无需用户先点「打开声音」 |
| 真正离开房间 / 关页 | 仍可清理；不影响 bfcache 与后台场景 |

### [S2.1] 生命周期：后台不再拆同步链路

**父页 `public/together.js`**

- 删除 `pagehide` 上的 `clearTimeout(pollTimer)` / `selectionController?.abort()` / `player.setConnected(false)`。
- `pagehide` 不再作为断连信号。仅在下列路径断连：显式「离开」、`401/404` 重置、`reset()`。
- `visibilitychange`：从 hidden → visible 且有 `session` 时，立即 `poll()`，并调用 iframe `player.sync()`（经已连接的 transport 或 `sharedListeningPlayer.sync`）。
- `pageshow`：无论 `event.persisted` 与否，只要 `session` 仍在就 `poll()`（去掉仅 `persisted` 才恢复的限制）。
- 轮询：在已有 1s `setTimeout` 链上保留作为兜底；若 SSE 流可用，可将兜底轮询降频（见 S2.3），但不得在流失败时完全停止。

**iframe `public/listening-room.js`**

- `pagehide`：`sharedMode` 下不调用 `sharedPlayer.reset()`、不 `cancelPlayback()`。非共享模式可保持原有清理。
- 可选：仅当 `!event.persisted && sharedMode===false` 或非共享路径时做旧清理；共享模式一律保留音频与 player 状态。
- `visibilitychange`（已有 `updateVisibility`）：补强——变为 visible 且 `sharedPlayer` 时调用 `sharedPlayer.sync()`；若 `blocked` 则尝试 `sharedPlayer.unlock()`。

**`public/listening-shared.js`**

- 契约不变：`setConnected(false)` 仍会 `audio.pause()`；但房间页不得在后台路径调用它。
- `unlock()` 保持；供回前台自动恢复。

### [S2.2] 后台安全换碟

**`playRecord`（`listening-room.js`）在 `remote` / shared 加载路径：**

- 当 `document.hidden` 为 true 时：
  - 跳过 `flyRecord`、跳过 `lowerTonearm` 动画延时（或降为 0ms）；
  - 直接 `audio.src = url; audio.load();`，由 `sharedPlayer.sync()` 决定 `play`/`seek`；
  - 仍执行必要的状态复位：`cancelPlayback` 的「取消进行中操作」语义保留，但不要在 pagehide 触发。
- 当前台：行为与现在一致（飞碟 + 落针）。
- 实现落点：在 `playRecord` 开头判断 `sharedMode && (document.hidden || reduced())` 走捷径；或抽出 `loadTrackMedia(track,url,{skipChoreography})` 供共享模式复用。优先最小改动：共享模式 + hidden/reduced 时跳过编舞。
- `loading` 标志在捷径下也必须在 `loadedmetadata`/`canplay` 或 `load()` 后的 sync 路径上正确清除，避免永久卡住。

### [S2.3] 抗节流：SSE 状态流（完整层）

选型：**SSE over `fetch` + `ReadableStream`**（不用 `EventSource`，因无法带 `X-Room-Token` 头；不引入 `ws` 依赖，贴合现有纯 Node `http.createServer`）。

**服务端 `server/together-service.js`**

- 每个房间维护订阅者集合：`subscribe(roomId, token, emit) -> unsubscribe`。
- 鉴权与 `state` 相同：`token` 必须属于该房间成员；无效 → 401。
- 触发推送：
  - 订阅成功立即 emit 一次完整 snapshot；
  - `control` / `join` / `leave` / 播完自动 pause 等导致 `revision` 或成员列表变化时，向该房间全部订阅者 emit；
  - 心跳：每 15s emit 一次 snapshot（或 `: ping` 注释 + 仍刷新 `member.seen`），避免 45s 成员超时。
- 订阅回调内调用现有 `snapshot(room)`，不复制进度算法。
- 断开（客户端 abort / socket close）时清理订阅，防止泄漏。

**HTTP `server/server.js`**

- 路由：`GET /api/together/stream?room=XXXX`，头 `X-Room-Token: <token>`。
- 响应：`Content-Type: text/event-stream; charset=utf-8`，`Cache-Control: no-cache`，`Connection: keep-alive`（HTTP/1.1 下注意不要错误地缓冲）。
- 每条消息：`data: <json snapshot>\n\n`。
- 与现有 `/api/together/<action>` 共存；`stream` 不走 `json()` 一次性响应。
- CSP 已是 `connect-src 'self'`，同源 fetch 流可用，无需放宽。
- Host 校验、方法限制沿用现有安全逻辑。

**客户端 `public/together.js`**

- 入座成功后启动 `openStream(session)`：
  - `fetch('/api/together/stream?room='+room, {headers:{'X-Room-Token':token}, signal})`；
  - 读 reader，按 `\n\n` 切帧，解析 `data:` JSON，走现有 `accept()`；
  - 使用 RTT 补偿的逻辑可沿用：流式推送无「请求往返」时，`lag` 可用最近一次 control/state 的 RTT，或流上带 `serverTime` 并用单调时钟锚点（与现 `accept` 一致：`anchor=performance.now()-lag`；流上首次可 `lag=0` 或复用上次）。
- 流错误 / 关闭：
  - 若仍 `session` 且页面未显式离开，指数退避重连（0.5s → 1s → 2s → 上限 5s）；
  - 重连期间降级为现有 1s `poll`，保证功能可用。
- 离开房间 / `reset()`：abort 流、清重连定时器。
- 流健康时：可将 HTTP poll 降为兜底（例如仅在流断开时 1s；或流上时每 5–10s 一次状态校准）。实现时以「流为主、poll 兜底」为准，避免双通道风暴。

**鉴权与分享链接**

- Token 仍只放在 `X-Room-Token` 头，不进 URL query、不进 hash、不进成员列表（与现 README 约定一致）。

### [S2.4] 回前台自动对齐

`visibilitychange` → visible：

1. 父页立即 `poll()`（或触发流重连若已断）；
2. `accept` 后 `setState`/`sync`；
3. 若 `blocked`，自动 `player.unlock()`（`unlock` 内已 seek + 条件 play）。

不弹额外 UI；失败时保留「打开声音」按钮作为兜底。

### [S2.5] 错误与边界

| 情况 | 行为 |
|------|------|
| SSE 不可用（旧代理缓冲、不支持） | 自动回退 1s poll，功能不降级为不可用 |
| 流认证 401/404 | 与 poll 相同：`reset` + 提示重新入座 |
| 后台 `play()` NotAllowedError | `blocked=true`；回前台 auto unlock |
| 房间 revision 冲突 | 沿用现有 409 → `poll`/拉流对齐 |
| 多 iframe/标签 | 每标签独立 stream + poll；服务端按 token 订阅，无额外共享状态 |
| 服务端重启 | 房间本就内存态；客户端 404 → 重新入座（现行为） |

### [S2.6] 测试边界

- `tests/together.test.js`：扩展 service——subscribe 收到 control 后的 snapshot、心跳刷新 `seen`、unsubscribe 后不再收到、无效 token 订阅 401。
- `tests/server.test.js`（若已有 together 路由）：stream 路由存在、错误 room/token 状态码；不强制在单测里跑完整 chunked 流（可用 service 层单测覆盖订阅）。
- `tests/listening-shared.test.js` / `listening-controls.test.js`：
  - hidden 时 shared 换碟不调用编舞（可注入 `hidden()` 与 choreography spy，或测 `playRecord` 捷径的可观察结果：`audio.src` 在无 animation await 下被设置）；
  - 现有「hidden 不 pause 音频」用例保持通过。
- 手工验收：双开窗口，A 切后台，B 暂停/切歌/seek，A 音频与进度在回到前台后 1–2s 内对齐；iOS 场景由用户侧验证。

## [S3] Out of Scope

- 不改服务端进度算法、`targetPosition`/`playbackCorrection` 公式。
- 不引入 WebSocket 库、SharedWorker、Service Worker、Media Session 高级控制。
- 不做多进程房间共享存储；仍单进程内存房间。
- 不修改黑胶聆听室独立模式（非 `together=1`）的播放 UX，除非共享模式捷径顺带用到的公共函数保持兼容。
- 不解决「系统级丢弃标签页」后的完全恢复（标签被 discard 需要用户重新打开页面）。

## Tasks

- [x] T1: 服务端房间订阅与 SSE 推送 — acceptance: `createTogetherService` 支持 `subscribe/unsubscribe`；control 后订阅者收到新 snapshot；心跳刷新 `seen`；无效 token 订阅失败 (covers: S2.3)
- [x] T2: HTTP stream 路由 — acceptance: `GET /api/together/stream` 鉴权后以 `text/event-stream` 推送；错误 token/room 返回 JSON 错误而非挂死 (covers: S2.3; depends: T1)
- [x] T3: 客户端流消费与 poll 兜底 — acceptance: 入座后建立流；`accept` 更新 UI/播放器；流断自动重连并回退 poll；离开时 abort (covers: S2.3, S2.1)
- [x] T4: pagehide/visibility 生命周期修正 — acceptance: shared 模式下 `pagehide` 不 pause/reset/清 poll；visible 时强制 poll+sync；`pageshow` 不依赖 persisted (covers: S2.1, S2.4)
- [x] T5: 后台安全换碟捷径 — acceptance: `document.hidden` 时跳过飞碟/落针，直接设 `src` 并 sync；前台行为不变 (covers: S2.2)
- [x] T6: 回前台自动 unlock — acceptance: 曾 blocked 的客户端在 visible 后自动 unlock 并对齐进度 (covers: S2.4; depends: T4)
- [x] T7: 回归测试与 `npm run check` — acceptance: 新增/扩展用例覆盖订阅与 hidden 捷径；`npm run check` 通过 (covers: S2.6; depends: T1,T2,T4,T5)
- [x] T8: README 一起听章节同步 — acceptance: 删除「休眠/冻结后可能需要重新加入」的过时绝对化表述，改为后台保持同步与极冷恢复限制 (covers: S1; depends: T4,T5)

## 验收清单（实现后勾选）

- [ ] 桌面：A 播放中切到其他标签 ≥1 分钟，B 暂停/切歌，A 仍接收（流或兜底 poll），回前台 2s 内对齐
- [ ] 桌面：后台 ≥5 分钟，成员不被 45s 踢出（心跳）
- [ ] 共享模式 `pagehide` 后 `audio.paused === false`（在原本正在播的前提下）
- [x] `npm test` / `npm run check` 全绿（pinball 一项 PRE-EXISTING）
