# DSH – Enhanced Model Support

一个模型座位，同时提供**模型选择**、**思考强度**、**订阅模型**与**订阅用量** —— 订阅栈内置在本包里，
只装这一个插件即可，不需要再单独安装 `dsh-plugin-subscriptions`。

DeepSeek Harness 原生把「模型」交给 `dsh-client-ui-model-selection`，思考强度与用量则各自散落。本插件用单个座位把它们合并进同一个菜单：

```
[ 模型        DeepSeek-V4.1-Flash  1017  › ]
[ 思考强度    High（随档位变色）        › ]
──────────────────────────────────────────
  订阅用量                                 刷新
  ChatGPT / Codex  ·  user@example.com
    5 小时窗口                      12%
    ▓▓░░░░░░░░░░░░░░░░░░   1h 42m 后重置
    每周窗口                        43%
    ▓▓▓▓▓▓▓░░░░░░░░░░░░   3d 4h 后重置
  Claude  ·  user@example.com
    …
```

## 功能

### 模型选择

- 与原生座位一致：按厂商分组列出模型、切换、记住选择
- 保留官方模型标签插槽，并在拿不到渲染器时内联绘制等价标记（例如 `DeepSeek-V4.1-Flash` 的 `1017`）
- 订阅模型（ChatGPT/Codex、Claude、Grok、GitHub Copilot、Google Antigravity）与原生模型在同一行「模型」里按厂商分组排列

### 思考强度

- 把原来的档位按钮列表换成吸附式滑条
- **档位配色与滑条联动**：常规档蓝色 `#4a9eff`、次顶档紫色 `#a97bff`、最高档流动渐变（`ths-topFlow`）
- 到顶有爆发动画与光晕；`prefers-reduced-motion` 下保留颜色、关闭动画
- 自定义厂商（没有上游 reasoning 目录）时回退到 low/medium/high/max/xhigh 五档

### 订阅模型与登录

- 内置上游 [`dsh-plugin-subscriptions`](https://github.com/V1ki/dsh-plugin-subscriptions)（MIT）的宿主半边，
  由本包的 bundle patch 挂载：注册各厂商 LLM 适配器、`subscriptions-auth.*` RPC、OAuth 凭据存储
- 登录/登出与账号管理在 **设置 → 订阅** 页面（同一套上游浏览器半边）
- 凭据与上游共用 `$DSH_HOME` 下的同一份存储，所以从旧版升级、或用命令行 profile 登录过，账号不会丢

### 订阅用量

- 读取内置订阅栈已归一化的 `subscriptions-auth` RPC，因此**自动兼容所有主流厂商的计量方式**：

| 厂商 | 计量 | 展示 |
| --- | --- | --- |
| ChatGPT / Codex | 5 小时 + 每周窗口 | 进度条 + 重置倒计时 + 可用重置次数 |
| Claude | 5 小时 / 每周（含模型级 `scope`） | 进度条 + 倒计时，`scope` 附在标签后 |
| GitHub Copilot | 配额窗口 | 进度条 + 倒计时 |
| Google Antigravity | 配额 / 积分 | 进度条或文本 |
| Grok | 无公开接口 | 明确标注「不提供用量接口」 |

百分比配色：`<80%` 绿 / `80–94%` 琥珀 / `>=95%` 红。区块高度上限 240px，超出独立滚动；面板内可强制刷新（绕过服务端缓存）。

## 结构

```
lib/index.js       宿主半边（空实现）：只为 Loader 提供可挂载的行
lib/client.js      浏览器半边：注册 conversation.input.model 座位
cordis.patch.yml   自激活补丁，挂两行：座位 + 内置订阅栈
vendor/
  dsh-plugin-subscriptions/   上游订阅插件（MIT © V1ki），含其 undici 依赖
tools/sync-subscriptions.mjs  从已安装副本同步上游代码
```

两行的分工：

| 行 id | 模块 | 负责 |
| --- | --- | --- |
| `enhanced-model-support` | `dsh-enhanced-model-support` | 座位、思考强度、用量面板 |
| `enhanced-model-subscriptions` | `./vendor/dsh-plugin-subscriptions/lib/index.js` | 厂商适配器、OAuth 登录、`subscriptions-auth` RPC |

第二行用**相对路径**（`./vendor/...`）而不是包名：patch 里的 `./` 相对 patch 文件自身解析成 file URL，
所以无论 profile 把本包装在 `node_modules` 的哪一层（pnpm 非 hoisted 也一样），这一行都能解析到包内副本。

## 安装

```bash
dsh plugin --profile web add dsh-enhanced-model-support
```

或手动放置：复制本目录到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-enhanced-model-support`，并把 `dsh-enhanced-model-support` 加进该 profile `package.json` 的 `dsh.profile.bundles`。

安装后重启 DSH 服务。

### 从 1.x 升级

1.x 只是「渲染」上游注册的模型，需要另外安装 `dsh-plugin-subscriptions`。2.0 自带，所以：

```bash
dsh plugin --profile web remove dsh-plugin-subscriptions
```

并从 profile `package.json` 的 `dsh.profile.bundles` 里删掉它。

> 旧插件还留在 profile 里时，DSH 会照常启动，但会打一条
> `llm-subscriptions (dsh-plugin-subscriptions): LlmError: an adapter for provider "codex" is already registered`
> 的启动警告 —— 两套代码注册同一批厂商适配器。功能不受影响（内置这套先挂上），但请删掉旧插件保持干净。
> 若旧插件与当前 runtime 版本不匹配，DSH 还会先报一条
> `skipping profile bundle "dsh-plugin-subscriptions"` 然后跳过它，同样无害。

## 优雅降级

- 没有登录任何订阅账号 → 用量区块整块不渲染，模型与思考强度照常工作
- 内置订阅行的 DSH 版本超出 `engines.dsh` 而被拒绝 → 订阅厂商分组消失，座位本身照常工作（错误会指向 `enhanced-model-subscriptions` 行）
- 上游用量接口失败 → 只在该厂商那一行显示错误，其他厂商与模型列表不受影响
- 座位以 `priority: -2` 注册，优先于随客户端分发的 `thinking-slider`（-1）

## 依赖

- DeepSeek Harness `>= 0.2.1-rc.2 < 0.4.0`（内置订阅行的 `engines.dsh`；超出范围时该行会被 DSH 拒绝加载）
- 无其他运行时依赖：`undici` 已随 `vendor/` 一起分发

## 同步上游订阅代码

```bash
node tools/sync-subscriptions.mjs                       # 默认取 web profile 里已安装的副本
node tools/sync-subscriptions.mjs --from <package dir>  # 或指定任意解包目录
```

脚本会重写供应商 `package.json`：去掉 `dsh.bundle`（避免被当成独立 bundle）、写入 `engines.dsh`
（上游把 `@deepseek-ai/dsh-*` peer 锁在 `0.2.1-rc.2`，在更新的 runtime 上会让 DSH 直接丢弃该行 ——
这正是内置而不是依赖上游包的原因），并保留 `dsh.client`（浏览器半边靠它被发现）。

## 许可

MIT。

`vendor/dsh-plugin-subscriptions` 为上游 MIT 代码，版权归 [V1ki](https://github.com/V1ki/dsh-plugin-subscriptions)，
许可证随代码保留在 `vendor/dsh-plugin-subscriptions/LICENSE`。
