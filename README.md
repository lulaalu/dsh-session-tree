<h1 align="center">dsh-session-tree</h1>

<p align="center">DeepSeek Harness 的会话树：把同一工作区的会话、每一轮对话和分叉画成一张可浏览的地图</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3da639?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4d6bfe?style=flat-square" alt="DeepSeek Harness 0.2.x">
  <img src="https://img.shields.io/badge/build-none-9aa3b2?style=flat-square" alt="No build step">
</p>

<p align="center">
  <a href="README.en.md">English guide</a>
</p>

> 这是一个 DSH 插件（bundle）。它不修改 session 格式、不复制会话内容、不额外存储对话；只读取 DSH 已有的会话投影来画图。

![会话树总览：同一工作区的会话、每一轮对话和分叉关系](docs/images/session-tree-overview.png)

## 为什么做它

在对话里发散思考时，你经常会从某一轮分叉出一个新会话继续追问；新会话又可能再分叉。DSH 的会话列表是线性的，分支多了以后：

- 找不到当初是从哪一轮分出去的；
- 忘记原本的主线；
- 旧会话被淹没在后面，越翻越乱。

Session Tree 把「会话 → 每一轮对话 → 分叉」画成一张地图，让分支关系一眼可见。

## 功能

| 能力 | 说明 |
|---|---|
| 按工作区分页 | 每个工作区一组，页面顶部下拉切换，默认停在最近活跃的工作区。 |
| 一行一会话、一列一轮 | 每个会话一行，每一轮（你的 prompt + 回复）一个节点，节点上显示这一轮的两行摘要。 |
| 分叉可视化 | 从被切出的那一轮画线到新会话；被归档/隐藏的中间会话会自动重连到最近的可见祖先，并用虚线标示。 |
| 中间会话被隐藏 | 「父会话不在视图」时，子会话就地显示自己的继承历史（淡显），不会凭空断掉。 |
| 回合连线 | 同一会话内相邻回合之间有连线，可在顶部关闭。 |
| 行分隔 | 会话名之间用渐变短条分隔；图区的分隔线可按需打开（默认关闭、颜色更浅）。 |
| 子会话 | 「显示子会话」打开后，子会话以迷你节点挂在**调用它的那一轮节点下方**并依次串成链；收起时该轮节点右下角显示子会话数量徽标。 |
| 归档行 | 「显示归档」打开后，归档会话行以浅灰底 + 「已归档」胶囊 + 降低不透明度的节点区分。 |
| 列宽可拖拽 | 名字列宽度可拖动，会话名太长时可以拉宽。 |
| 强调色 | 右上角 ⚙ 可自定义强调色（或跟随主题），用于连线高亮、节点悬停、分叉按钮等；选择保存在浏览器。 |
| 节点操作 | 行内「⋯」菜单：重命名、置顶 / 取消置顶、分叉会话、归档 / 取消归档、复制 Session ID。 |
| 点击定位 | 点任意节点：打开该会话并自动翻页/滚动定位到那一轮，闪一下高亮。 |
| 空行压缩 | 分叉出来但还没产生自己对话的会话，压缩成一条窄行，不浪费纵向空间。 |

![隐藏中间会话：分支线用虚线连回最近的可见祖先，子会话就地淡显继承历史](docs/images/session-tree-hidden-middle.png)

## 安装

### 要求

- DeepSeek Harness **0.2.x**（Web UI；`web` profile 或桌面 App 的 `desktop` profile 都可以）。
- 本插件是**纯 JavaScript**，没有构建步骤、没有 `install`/`prepare` 脚本——从 GitHub 安装**不需要**给 pnpm 授权运行构建脚本。

先确认 `dsh` 可用：

```powershell
dsh --version
```

### 方式 A：从 GitHub 安装（推荐）

```powershell
# 固定到标签（当前发布版本）
dsh plugin --profile web add github:lulaalu/dsh-session-tree#v0.1.0

# 或固定到具体提交，最严格
dsh plugin --profile web add github:lulaalu/dsh-session-tree#dbc85c5
```

桌面 App 用 `--profile desktop`。也可以在 DSH 的插件页面（或让 Agent 调 `plugin_manager`）用包 spec 安装：

```text
plugin_manager install_bundle target="github:lulaalu/dsh-session-tree"
```

### 方式 B：本地目录（开发用）

```powershell
dsh plugin --profile web add D:\path\to\dsh-session-tree
```

等价的 GUI/Agent 方式：`plugin_manager install_bundle target="D:\path\to\dsh-session-tree"`。

这是 pnpm 的 `link:` 安装：**不复制文件**，profile 里只登记一个目录联接。改代码后需要让 Host 重新读取 bundle（禁用/启用插件行）并刷新页面。

### 方式 C：tarball

```powershell
pnpm pack
dsh plugin --profile web add .\dsh-session-tree-0.1.0.tgz
```

### 卸载

```powershell
dsh plugin --profile web remove dsh-session-tree
```

### 装完找不到入口？

1. 左侧边栏应出现一个**树形图标**（在 Plugins、Schedules 图标之后），点它进入「会话树」。
2. 桌面 App 安装后需要**重启 App**；命令行安装后重启 `dsh web` 并刷新页面。
3. 最常见的原因是**装到了另一套 profile**：桌面 App 和命令行各用一套，把 `--profile` 换成另一套再装一次。

## 使用

- **顶部开关**：`回合连线` · `行分隔` · `清晰边框` · `显示继承历史` · `显示子会话` · `显示归档`，右侧 ⚙ 是外观设置（强调色 / 跟随主题）。
- **点节点**：打开会话并定位到这一轮。
- **悬停节点右上角 ⑂**：从这一轮直接分叉（新分支自动打开）。
- **行内「⋯」**：重命名 / 置顶 / 分叉会话 / 归档 / 复制会话 ID，和侧边栏的行菜单同源。
- **拖动名字列右边缘**：调整列宽。

## 数据与边界

- 只读 `ctx.sessions` 的会话列表与投影（`turnOutline`），**不读写 session 文件、不改 session 格式**。
- 分叉关系来自 DSH 会话 header 里已有的 `parentSession` / `isSeeded`，子会话来自 `origin === 'subagent'`；插件不维护第二份关系表。
- 会话内容始终以 DSH 原生 session log 为唯一事实来源；插件不保存任何对话正文。
- 唯一写到浏览器本地的是强调色（`localStorage`）与本次会话内的列宽；删掉不影响任何会话。
- Host 半（`index.js`）只有一个空的 `apply()`，全部 UI 都在 Web 客户端半边。

## 已知限制

- **全新子会话的精确轮次**：DSH 没有向客户端暴露 subagent 的 spawn 时刻轮次，所以这类子会话暂时挂在父会话**当前最后一轮**下方；继承上下文的子会话能精确对齐到被切出的那一轮。
- **定位到某一轮是"尽力而为"**：DSH 没有公开的"滚动到某轮"接口，插件用 `loadThrough(seq)` 翻页 + 对话区 DOM 锚点滚动；历史特别长时可能翻不到，且不会报错。
- **跨行连线**：同一列间空隙里超过 3 条长连线时会复用车道，极端情况下可能重叠。
- 暂无搜索、导出、多选批量操作；子会话内部更深层的对话以迷你节点表示，不展开成完整时间线。

## 开发

```powershell
# 语法检查
npm run check

# 渲染冒烟测试：用桩 React + 桩客户端上下文跑真实 client.js，覆盖 17 个场景
npm test

# 真实数据几何诊断（只读）：检查连线是否穿卡片 / 共线重叠
npm run test:layout
```

`npm run test:layout` 会读取本机 DSH 数据，可用环境变量指定范围：

| 环境变量 | 含义 |
|---|---|
| `DSH_HOME` | DSH 数据目录，默认 `~/.dsh` |
| `SESSION_TREE_PROJECT` | `sessions/` 下的项目目录名，默认取会话最多的项目 |
| `SESSION_TREE_CWD` | 要诊断的工作区路径，默认取会话最多的工作区 |
| `SESSION_TREE_SESSION` | 用于打印行上下文的会话 id，默认取回合最多的会话 |

本地开发循环：

```powershell
# 1) 改代码后重新让 Host 读取 bundle（禁用再启用插件行）
plugin_manager set_plugin target="include:session-tree" enabled=false
plugin_manager set_plugin target="include:session-tree" enabled=true

# 2) 刷新浏览器页面，加载新的 client bundle
```

## 仓库结构

```text
.
├── package.json        # npm 包 + dsh.bundle / dsh.client 声明
├── cordis.patch.yml    # bundle 层：插入 session-tree 这一行
├── index.js            # Host 半（空 apply）
├── client.js           # Web 客户端全部 UI 与逻辑（纯 JS，无构建）
├── locale/en.json      # 插件显示元数据（英文）
├── locale/zh.json      # 插件显示元数据（中文）
├── icon.svg            # 插件图标
├── docs/images/        # README 截图
├── test/               # 冒烟测试 + 真实数据几何诊断
└── .github/workflows/  # CI：语法检查 + 冒烟测试
```

## 兼容性

`package.json` 声明 `engines.dsh = ">=0.2.0 <0.3.0"`。DSH 在安装和启动时会校验该范围（预发布版本也参与匹配）；不满足时会拒绝加载并提示用 `dsh plugin allow-version` 豁免。

## 许可证

[MIT](LICENSE)
