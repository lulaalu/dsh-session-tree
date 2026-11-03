<h1 align="center">dsh-session-tree</h1>

<p align="center">A per-workspace map of DeepSeek Harness sessions, turns and fork branches in the Web UI</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3da639?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4d6bfe?style=flat-square" alt="DeepSeek Harness 0.2.x">
</p>

<p align="center">
  <a href="README.md">中文说明</a>
</p>

> A DeepSeek Harness bundle. It never changes the session format, copies conversations, or stores extra chat data; it only reads the session projections DSH already computes.

## Why

When you branch off mid-conversation, DSH's session list stays linear: forks get buried, it is hard to see which turn a branch came from, and the original main line gets lost. Session Tree draws sessions, turns and forks as one browsable map.

## Features

| Capability | Description |
|---|---|
| Per-workspace pages | One group per workspace, switchable from the page header; defaults to the most recently active workspace. |
| One row per session, one column per turn | Every turn (your prompt + the reply) is a node carrying a two-line excerpt. |
| Fork lines | A fork is drawn from the exact turn it was cut from. Hidden/archived intermediate sessions are reconnected to the nearest visible ancestor with a dashed link. |
| Hidden parent | A branch whose parent is not in view shows its inherited history inline (faded) instead of dangling. |
| Turn links | Consecutive turns in one session are connected; can be switched off. |
| Row separators | Gradient hairlines between session labels; graph-wide separators are opt-in and lighter. |
| Sub-sessions | Toggle "Sub-sessions": each sub-agent hangs under the turn that spawned it as a small chained node. Collapsed, that turn shows a count badge instead. |
| Archived rows | Toggle "Archived": archived sessions get a tinted row, an "Archived" chip and dimmed nodes. |
| Resizable label column | Drag the column edge to fit long session titles. |
| Accent color | Gear button: custom accent (or follow the theme) for links, hover outlines and fork buttons; stored in the browser. |
| Row menu | Rename, pin/unpin, fork session, archive/unarchive, copy Session ID — the same operations as the sidebar's row menu. |
| Click to locate | Clicking a node opens the session, pages the history to that turn and flashes it. |
| Compact empty rows | Forks that never got their own turn collapse to a slim row. |

## Install

### Requirements

- DeepSeek Harness **0.2.x** (Web UI; the `web` profile or the desktop app's `desktop` profile).
- Plain JavaScript, no build step and no `install`/`prepare` scripts, so a GitHub install does **not** require granting pnpm build-script permission.

```powershell
dsh --version
```

### Option A: from GitHub (recommended)

```powershell
# Pin the release tag
dsh plugin --profile web add github:lulaalu/dsh-session-tree#v0.1.0

# Or pin the exact commit
dsh plugin --profile web add github:lulaalu/dsh-session-tree#dbc85c5
```

Use `--profile desktop` for the desktop app. The plugin manager / agent equivalent is:

```text
plugin_manager install_bundle target="github:lulaalu/dsh-session-tree"
```

### Option B: local checkout (development)

```powershell
dsh plugin --profile web add D:\path\to\dsh-session-tree
```

This is a pnpm `link:` install: files are not copied, the profile only records a directory link. After editing, let the Host re-read the bundle (disable and re-enable the plugin row) and refresh the page.

### Option C: tarball

```powershell
pnpm pack
dsh plugin --profile web add .\dsh-session-tree-0.1.0.tgz
```

### Uninstall

```powershell
dsh plugin --profile web remove dsh-session-tree
```

### Where did the panel go?

1. A tree icon appears in the left sidebar, after Plugins and Schedules; click it to open **Session Tree**.
2. Restart the desktop app, or restart `dsh web` and refresh the page after a CLI install.
3. The usual mistake is installing into the other profile: the desktop app and the CLI each use their own (`desktop` vs `web`).

## Usage

- Header toggles: `Turn links` · `Row separators` · `Strong outlines` · `Inherited history` · `Sub-sessions` · `Archived`; the gear opens appearance settings (accent color / follow theme).
- Click a node: open the session and jump to that turn.
- Hover the node corner ⑂: fork from that turn; the new branch opens automatically.
- Row menu `⋯`: rename, pin, fork session, archive, copy Session ID.
- Drag the right edge of the label column to resize it.

## Data and boundaries

- Reads `ctx.sessions` list state and projections (`turnOutline`) only. It never touches session files or the session format.
- Fork lineage comes from the existing session header fields `parentSession` / `isSeeded`; sub-sessions come from `origin === 'subagent'`. No second relation store.
- Session content stays owned by DSH's own session log; the plugin stores no conversation text.
- The only browser-local writes are the accent color (localStorage) and the label width for the current page.
- The Host half (`index.js`) is an empty `apply()`; all UI lives in the client half.

## Known limitations

- Sub-agents that start a fresh timeline are attached to the parent's latest turn: DSH does not expose the spawn turn to clients. Context-inheriting sub-agents align exactly.
- Locating a turn is best effort (paged history plus a DOM anchor); very old turns may not be reached and no error is surfaced.
- More than three long connectors sharing one column gutter reuse lanes and may overlap in extreme trees.
- No search, export or batch operations yet; deeper sub-agent conversations stay as mini nodes instead of full timelines.

## Development

```powershell
npm run check       # syntax checks
npm test            # render smoke test: real client.js against a stub React, 17 scenarios
npm run test:layout # read-only geometry diagnosis against real DSH data
```

`test:layout` accepts `DSH_HOME`, `SESSION_TREE_PROJECT`, `SESSION_TREE_CWD` and `SESSION_TREE_SESSION`.

Local iteration loop: edit, disable and re-enable the `include:session-tree` plugin row so the Host re-reads the bundle, then refresh the page.

## Layout

```text
.
├── package.json        # npm package + dsh.bundle / dsh.client
├── cordis.patch.yml    # bundle layer: inserts the session-tree row
├── index.js            # Host half (empty apply)
├── client.js           # entire Web client UI (plain JS, no build)
├── locale/             # display metadata (en/zh)
├── icon.svg
├── test/               # render smoke test + real-data geometry diagnosis
└── .github/workflows/  # CI: syntax checks + smoke test
```

## Compatibility

`package.json` declares `engines.dsh = ">=0.2.0 <0.3.0"`. DSH validates it on install and startup (prereleases participate in the range).

## License

[MIT](LICENSE)
