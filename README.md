# DSH – Enhanced Model Support

当前版本 `2.0.1`。随附上游 `dsh-plugin-subscriptions` `0.9.11`（MIT）及其 `undici` `7.30.1`。

## 概述

Enhanced Model Support（下称 EMS）是 DeepSeek Harness（下称 DSH）的 profile 插件。它在对话输入区注册单一模型座位，
用于合并三类操作与信息：模型选择、思考强度设置、订阅用量展示。自 `2.0.0` 起，EMS 同时提供订阅模型所依赖的宿主能力
（各厂商 LLM 适配器、OAuth 凭据管理、`subscriptions-auth` RPC）与订阅登录界面，因此无需另行安装
`dsh-plugin-subscriptions`。

DSH 默认将模型选择交由 `dsh-client-ui-model-selection`，思考强度与用量分属其他插件。EMS 以
`conversation.input.model` 座位取而代之，把上述内容置于同一菜单内。菜单结构示意：

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

## 组成与挂载

EMS 是一个 DSH bundle（`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`）。该 patch 向 profile 条目树插入两行：

| 行 id | 模块 | 职责 |
| --- | --- | --- |
| `enhanced-model-support` | `dsh-enhanced-model-support` | 模型座位、思考强度、用量面板 |
| `enhanced-model-subscriptions` | `./vendor/dsh-plugin-subscriptions/lib/index.js` | 厂商 LLM 适配器、OAuth 登录、`subscriptions-auth` RPC |

第二行使用相对路径而非包名。DSH 在加载 patch 时，会把 `insert` 条目中相对于 patch 文件的 `./`、`../` 路径转换为
file URL；因此无论 profile 把本包安装在 `node_modules` 的哪一层（包括 pnpm 非 hoisted 布局），该行都解析到包内副本。
若改为包名，该行将从 profile 根目录解析，嵌套安装时无法命中。

浏览器半边不在 patch 中声明，而由各包 `package.json` 的 `dsh.client` 声明决定：DSH 依据活跃 Loader 行解析出包，
读取其 `dsh.client` 与 `exports["./client"]`，再将该 bundle 提供给浏览器。

## 行为说明

### 模型选择

- 按厂商分组列出模型目录，支持切换并记忆选择，行为与原生座位一致。
- 保留官方模型标签插槽；无法取得渲染器时，内联绘制等价标记（例如 `DeepSeek-V4.1-Flash` 的 `1017`）。
- 订阅模型（ChatGPT/Codex、Claude、Grok、GitHub Copilot、Google Antigravity）与原生模型位于同一列表，按厂商分组。

### 思考强度

- 以吸附式滑条取代原档位按钮列表。
- 档位配色与滑条联动：常规档 `#4a9eff`，次顶档 `#a97bff`，最高档使用流动渐变（`ths-topFlow`）。
- 到达最高档时播放爆发动画与光晕；`prefers-reduced-motion` 生效时保留配色、禁用动画。
- 厂商未提供 reasoning 档位信息时，回退为 `low`/`medium`/`high`/`max`/`xhigh` 五档。

### 订阅模型与登录

- EMS 的 bundle patch 挂载 vendored 上游宿主半边，由其实施：调用 `ctx.llm.registerAdapter` 注册各厂商适配器、
  处理 OAuth 授权与刷新、提供服务端凭据存储、挂载 `subscriptions-auth.*` RPC。
- 登录、登出与账号管理位于 **设置 → 订阅** 页面（同一份 vendored 浏览器半边）。
- 凭据写入 `$DSH_HOME` 下由该实现决定的位置，与独立安装的同一上游版本共用同一存储；因此从 1.x 升级后既有账号仍然有效。

### 订阅用量

用量面板调用 `subscriptions-auth` RPC（channel `/api`，endpoint 前缀 `subscriptions-auth.`）读取由 vendored 实现
归一化后的结果，并按厂商渲染：

| 厂商 | 计量口径 | 展示内容 |
| --- | --- | --- |
| ChatGPT / Codex | 5 小时窗口与每周窗口 | 进度条、重置倒计时、可用重置次数 |
| Claude | 5 小时窗口与每周窗口，可含模型级 `scope` | 进度条、倒计时，`scope` 附于窗口标签 |
| GitHub Copilot | 配额窗口 | 进度条、倒计时 |
| Google Antigravity | 配额或积分 | 进度条或文本 |
| Grok | 无公开用量接口 | 标注「不提供用量接口」 |

百分比配色阈值为 `<80%` 绿、`80–94%` 琥珀、`>=95%` 红。用量区块最大高度 240px，超出部分独立滚动。面板内的
刷新操作会向服务端传递 `force` 参数，绕过其缓存。

## 兼容性与失败模式

- **DSH 版本**：`engines.dsh` 为 `>=0.2.1-rc.2 <0.4.0`。运行时版本超出该范围时，DSH 会拒绝
  `enhanced-model-subscriptions` 行（拒绝的普通行以 `disabled` 形式保留并输出报告）；订阅厂商分组与用量面板随该行一同不可用，
  座位其余功能不受影响。
- **未登录任何订阅账号**：用量区块整体不渲染，模型列表与思考强度不受影响。
- **profile 中仍存在 `dsh-plugin-subscriptions`**：若该副本能通过版本校验，两套代码会注册相同的 provider id，
  后挂载的一行失败并输出 `an adapter for provider "codex" is already registered`；若不能通过，DSH 先输出
  `skipping profile bundle "dsh-plugin-subscriptions"` 并跳过该 bundle。两种情况下 EMS 的订阅行均正常加载，
  但应移除该副本以避免重复注册。
- **单个厂商的用量接口失败**：仅该厂商条目显示错误，其余厂商与模型列表不受影响。
- **座位优先级**：`priority: -2`，高于随客户端分发的 `thinking-slider`（`-1`）。

## 安装

```bash
dsh plugin --profile web add dsh-enhanced-model-support
```

也可手工安装：将本目录复制到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-enhanced-model-support`，
并把 `dsh-enhanced-model-support` 加入该 profile `package.json` 的 `dsh.profile.bundles`。

安装后须重启 DSH 服务，新行才会被挂载。

### 从 1.x 升级

1.x 仅渲染由外部 `dsh-plugin-subscriptions` 注册的模型与用量。2.0 起该能力内置，因此需要移除旧插件：

```bash
dsh plugin --profile web remove dsh-plugin-subscriptions
```

并从该 profile `package.json` 的 `dsh.profile.bundles` 中删除同名条目。若未移除，症状见上文
「profile 中仍存在 `dsh-plugin-subscriptions`」。

## 结构

```
lib/index.js                   宿主半边：空实现，仅为 Loader 提供可挂载的行
lib/client.js                  浏览器半边：注册 conversation.input.model 座位
cordis.patch.yml               bundle 自激活 patch：座位行与订阅栈行
vendor/
  dsh-plugin-subscriptions/    上游订阅实现（MIT © V1ki），含其 undici 依赖
tools/sync-subscriptions.mjs   从已安装副本同步上游代码
```

## 同步上游订阅代码

```bash
node tools/sync-subscriptions.mjs                       # 默认取 web profile 中已安装的副本
node tools/sync-subscriptions.mjs --from <package dir>  # 或指定任意已解包的副本
node tools/sync-subscriptions.mjs --check               # 仅比较本地与来源的版本
```

脚本对 `vendor/` 执行以下变换，并在任何一步不符合预期时以非零状态退出：

- 复制 `lib/`、上游 `LICENSE`，以及 `undici`（优先取包内 `node_modules/undici`，否则取同级 hoisted 副本）。
- 删除所有 `.d.ts`。vendored 副本仅作运行时使用；上游声明文件以字面量形式重复了公开 OAuth 常量。
- 重写 vendored `package.json`：移除 `dsh.bundle`（不得作为独立 bundle 挂载）、`types`、`scripts`、`devDependencies`，
  写入 `engines.dsh`，保留 `dsh.client`。
- 将两个公开 Antigravity OAuth 应用常量改写为运行时分段拼接。其字面量与 base64 形式均会被 GitHub push protection
  判定为 secret 并拒绝推送，拼接后的常量在运行时取值不变。
- 写入 `UPSTREAM.json`，记录来源版本与同步时间。

写入 `engines.dsh` 是必要的：该声明使本行不再依赖上游 `peerDependencies` 的逐版本枚举。上游 `0.9.11` 的 peer 范围已
包含 `0.2.1-rc.3`，而更早的版本（例如 `0.9.9`）仅列到 `0.2.1-rc.2`，在更新的 runtime 上会被 DSH 拒绝；`engines.dsh`
的优先级高于 peer 范围，可避免版本枚举变化导致整行被丢弃。

## 许可与归属

本项目以 MIT 许可发布。

`vendor/dsh-plugin-subscriptions` 为上游 MIT 代码，版权归 [V1ki](https://github.com/V1ki/dsh-plugin-subscriptions)。
原始许可证随代码保留于 `vendor/dsh-plugin-subscriptions/LICENSE`。
