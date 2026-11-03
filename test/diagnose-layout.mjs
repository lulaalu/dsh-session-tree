// Layout diagnosis against the real DSH data on disk. Read-only.
// Rebuilds the Session Tree model for one workspace so connector geometry can be
// checked without a browser.
//
// Configure with environment variables (all optional):
//   DSH_HOME             DSH data directory (default: ~/.dsh)
//   SESSION_TREE_PROJECT project directory name under <DSH_HOME>/sessions
//                        (default: the project with the most sessions)
//   SESSION_TREE_CWD     workspace path to diagnose (default: the cwd with the most sessions)
//   SESSION_TREE_SESSION target session id for the row-context printout
//                        (default: the session with the most turns)
//
// Sub-agent sessions are excluded: their layout uses chained mini nodes that this
// fork-only geometry mirror does not rebuild.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

const DSH = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
const SESSIONS_ROOT = join(DSH, 'sessions');
const PROJCACHE = join(DSH, 'storages', 'session_projcache', 'sessions');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

if (!existsSync(SESSIONS_ROOT)) {
  console.error('No session store at ' + SESSIONS_ROOT + '. Set DSH_HOME to your DSH data directory.');
  process.exit(1);
}
const workspaceStorePath = join(DSH, 'storages', 'workspace.json');
const workspaceStore = existsSync(workspaceStorePath) ? readJson(workspaceStorePath) : { global: {} };
const archived = new Set(workspaceStore.global.archivedSessionIds || []);

function readSession(id) {
  const dir = join(ROOT, id);
  const file = readdirSync(dir).find((name) => name.startsWith('session.v') && name.endsWith('.jsonl.zstd'));
  if (file === undefined) return undefined;
  const text = zstdDecompressSync(readFileSync(join(dir, file))).toString('utf8');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  let header;
  const turns = [];
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === 'session') {
      header = row;
      continue;
    }
    if (row.type === 'turn/start' && row.data !== undefined) turns.push({ turn: row.data.turn, seq: row.seq });
  }
  return { header, turns };
}

const projects = readdirSync(SESSIONS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
if (projects.length === 0) {
  console.error('No project directory under ' + SESSIONS_ROOT + '.');
  process.exit(1);
}
const project = process.env.SESSION_TREE_PROJECT !== undefined && process.env.SESSION_TREE_PROJECT !== ''
  ? process.env.SESSION_TREE_PROJECT
  : projects
    .map((name) => ({ name, count: readdirSync(join(SESSIONS_ROOT, name)).length }))
    .sort((left, right) => right.count - left.count)[0].name;
const ROOT = join(SESSIONS_ROOT, project);

const sessions = [];
for (const id of readdirSync(ROOT).filter((name) => name.startsWith('session-'))) {
  const disk = readSession(id);
  if (disk === undefined || disk.header === undefined) continue;
  if (disk.header.cwd === undefined) continue;
  let cache;
  const cachePath = join(PROJCACHE, id + '.json');
  if (existsSync(cachePath)) cache = readJson(cachePath);
  const rows = cache !== undefined && cache.record !== undefined ? cache.record.rows : undefined;
  const metadata = rows !== undefined && rows.sessionListMetadata !== undefined ? rows.sessionListMetadata.val : undefined;
  const outline = rows !== undefined && rows.turnOutline !== undefined ? rows.turnOutline.val : undefined;
  const turns = outline !== undefined && Array.isArray(outline.turns)
    ? outline.turns
    : disk.turns.map((entry) => ({ turn: entry.turn, seq: entry.seq, prompt: '', response: '' }));
  sessions.push({
    id,
    cwd: disk.header.cwd,
    parentSession: disk.header.parentSession,
    origin: disk.header.origin,
    createdAt: disk.header.createdAt,
    isSeeded: disk.header.isSeeded === true,
    updatedAt: (metadata !== undefined && metadata.lastPromptAt) || disk.header.createdAt,
    blank: metadata !== undefined ? metadata.blank : false,
    turns,
  });
}

const norm = (value) => String(value == null ? '' : value).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
const cwdCounts = new Map();
for (const session of sessions) {
  if (session.cwd === undefined) continue;
  const key = norm(session.cwd);
  cwdCounts.set(key, (cwdCounts.get(key) === undefined ? 0 : cwdCounts.get(key)) + 1);
}
const rankedCwds = [...cwdCounts.entries()].sort((left, right) => right[1] - left[1]);
if (rankedCwds.length === 0) {
  console.error('No session in project ' + project + ' records a workspace cwd.');
  process.exit(1);
}
const workspacePath = process.env.SESSION_TREE_CWD !== undefined && process.env.SESSION_TREE_CWD !== ''
  ? norm(process.env.SESSION_TREE_CWD)
  : rankedCwds[0][0];
// Sub-agent sessions lay out as chained mini nodes; this fork-only geometry mirror skips them.
const visible = sessions.filter((session) => norm(session.cwd) === workspacePath && session.origin !== 'subagent');
if (visible.length === 0) {
  console.error('No sessions in workspace ' + workspacePath + '.');
  process.exit(1);
}
const envTarget = process.env.SESSION_TREE_SESSION;
const target = envTarget !== undefined && envTarget !== ''
  ? visible.find((session) => session.id === envTarget)
  : [...visible].sort((left, right) => right.turns.length - left.turns.length)[0];
if (target === undefined) {
  console.error('Target session not found in ' + workspacePath + '; set SESSION_TREE_SESSION.');
  process.exit(1);
}
console.log('DSH data: ' + DSH);
console.log('project: ' + project);
console.log('workspace: ' + workspacePath + ' (' + visible.length + ' sessions)');
console.log('target session: ' + target.id);

const short = (id) => (id === undefined ? '-' : String(id).slice(8, 16));

// ---- layout (mirror of client.js layoutGroup) ---------------------------
function layout(options) {
  const byId = new Map(visible
    .filter((session) => session.blank !== true)
    .filter((session) => options.showArchived || !archived.has(session.id))
    .map((session) => [session.id, session]));
  const known = new Map(sessions.map((session) => [session.id, session]));
  const visibleAncestorOf = (session) => {
    let cursor = session.parentSession;
    const guard = new Set();
    while (cursor !== undefined && cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      const candidate = byId.get(cursor);
      if (candidate !== undefined) return candidate;
      const lineage = known.get(cursor);
      if (lineage === undefined) return undefined;
      cursor = lineage.parentSession;
    }
    return undefined;
  };
  const sharedPrefix = (left, right) => {
    if (right === undefined) return 0;
    let shared = 0;
    while (shared < left.turns.length && shared < right.turns.length && left.turns[shared].seq === right.turns[shared].seq) shared += 1;
    return shared;
  };
  const rows = [];
  const seen = new Set();
  const walk = (session, depth) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    const directParent = session.parentSession === undefined ? undefined : known.get(session.parentSession);
    const effectiveParent = visibleAncestorOf(session);
    const directInherited = sharedPrefix(session, directParent);
    const effectiveInherited = effectiveParent === undefined ? 0 : sharedPrefix(session, effectiveParent);
    rows.push({
      id: session.id,
      turns: session.turns.length,
      depth,
      parentId: effectiveParent === undefined ? undefined : effectiveParent.id,
      directId: directParent === undefined ? undefined : directParent.id,
      inherited: Math.max(directInherited, effectiveInherited),
      effectiveInherited,
      forkCol: effectiveParent === undefined ? -1 : effectiveInherited - 1,
      visibleFrom: options.showInherited || effectiveParent === undefined ? 0 : effectiveInherited,
      visibleTo: session.turns.length - 1,
      archived: archived.has(session.id),
      hiddenGap: effectiveParent !== undefined && directParent !== undefined && directParent.id !== effectiveParent.id,
    });
    for (const child of [...byId.values()].filter((candidate) => visibleAncestorOf(candidate)?.id === session.id)) walk(child, depth + 1);
  };
  const roots = [...byId.values()].filter((session) => visibleAncestorOf(session) === undefined);
  roots.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const root of roots) walk(root, 0);
  for (const session of byId.values()) if (!seen.has(session.id)) walk(session, 0);

  const rowIndexOf = new Map(rows.map((row, index) => [row.id, index]));
  let cursorTop = 0;
  for (const row of rows) {
    row.compact = row.visibleTo < row.visibleFrom;
    row.height = row.compact ? 46 : 100;
    row.top = cursorTop;
    cursorTop += row.height + 16;
  }
  const edges = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const parentIndex = row.parentId === undefined ? -1 : rowIndexOf.get(row.parentId);
    if (parentIndex === undefined || parentIndex < 0 || row.visibleTo < row.visibleFrom || row.forkCol < 0) continue;
    const parentRow = rows[parentIndex];
    if (parentRow.compact) continue;
    const fromCol = Math.max(row.forkCol, parentRow.visibleFrom);
    edges.push({ fromRow: parentIndex, fromCol, toRow: index, toCol: row.visibleFrom, gap: row.hiddenGap });
  }
  const laneBands = new Map();
  for (const edge of edges) {
    edge.long = edge.toRow > edge.fromRow + 1;
    edge.lane = 0;
    if (!edge.long) continue;
    const top = rows[edge.fromRow].top + 8 + 84;
    const bottom = rows[edge.toRow].top + 8;
    let bands = laneBands.get(edge.fromCol);
    if (bands === undefined) {
      bands = [];
      laneBands.set(edge.fromCol, bands);
    }
    let lane = 0;
    while (bands.some((band) => band.lane === lane && band.top < bottom && band.bottom > top)) lane += 1;
    bands.push({ lane, top, bottom });
    edge.lane = lane;
  }
  return { rows, edges, byId };
}
console.log('total sessions:', sessions.length, '| visible in workspace:', visible.length, '| archived:', archived.size);

// ---- geometry ------------------------------------------------------------
const COL_W = 180, COL_GAP = 26, STEP = COL_W + COL_GAP, CARD_H = 84, ROW_H = 100, ROW_GAP = 16, CARD_TOP = (ROW_H - CARD_H) / 2, INSET = 18;
function segments(edge, rows) {
  const y1 = rows[edge.fromRow].top + CARD_TOP + CARD_H;
  const y2 = rows[edge.toRow].top + CARD_TOP;
  if (edge.long === true) {
    const startX = INSET + edge.fromCol * STEP + COL_W / 2;
    const gutterX = INSET + edge.fromCol * STEP + COL_W + COL_GAP / 2 + (edge.lane % 3) * 6;
    const endX = INSET + edge.toCol * STEP + COL_W / 2;
    const dropY = y1 + 4;
    const approachY = y2 - 10;
    return [
      { kind: 'v', x: startX, a: y1, b: dropY },
      { kind: 'h', y: dropY, a: Math.min(startX, gutterX), b: Math.max(startX, gutterX) },
      { kind: 'v', x: gutterX, a: dropY, b: approachY },
      { kind: 'h', y: approachY, a: Math.min(gutterX, endX), b: Math.max(gutterX, endX) },
      { kind: 'v', x: endX, a: approachY, b: y2 },
    ];
  }
  const x1 = INSET + edge.fromCol * STEP + COL_W / 2;
  const x2 = INSET + edge.toCol * STEP + COL_W / 2;
  if (Math.abs(x1 - x2) < 1) return [{ kind: 'v', x: x1, a: Math.min(y1, y2), b: Math.max(y1, y2) }];
  const mid = Math.max(y1 + 10, y2 - 20);
  return [
    { kind: 'v', x: x1, a: y1, b: mid },
    { kind: 'h', y: mid, a: Math.min(x1, x2), b: Math.max(x1, x2) },
    { kind: 'v', x: x2, a: mid, b: y2 },
  ];
}
function collinearOverlap(left, right) {
  if (left.kind !== right.kind) return undefined;
  if (left.kind === 'v') {
    if (Math.abs(left.x - right.x) > 0.5) return undefined;
    const a = Math.max(left.a, right.a);
    const b = Math.min(left.b, right.b);
    return b - a > 0.5 ? b - a : undefined;
  }
  if (Math.abs(left.y - right.y) > 0.5) return undefined;
  const a = Math.max(left.a, right.a);
  const b = Math.min(left.b, right.b);
  return b - a > 0.5 ? b - a : undefined;
}
function hitsCard(segment, card) {
  if (segment.kind === 'v') {
    if (segment.x < card.x1 + 1 || segment.x > card.x2 - 1) return false;
    return Math.min(segment.b, card.y2) - Math.max(segment.a, card.y1) > 0.5;
  }
  if (segment.y < card.y1 + 1 || segment.y > card.y2 - 1) return false;
  return Math.min(segment.b, card.x2) - Math.max(segment.a, card.x1) > 0.5;
}

function report(mode, options) {
  const { rows, edges } = layout(options);
  console.log('\n=== ' + mode + ' | rows=' + rows.length + ' | edges=' + edges.length + ' ===');
  const targetRow = Math.max(0, rows.findIndex((row) => row.id === target.id));
  console.log('target row:', targetRow);
  for (let index = Math.max(0, targetRow - 2); index <= Math.min(rows.length - 1, targetRow + 2); index += 1) {
    const row = rows[index];
    console.log(' ', String(index).padStart(2), short(row.id), 'd' + row.depth, 'turns=' + row.turns,
      'inh=' + row.inherited, 'cols=' + row.visibleFrom + '..' + row.visibleTo, 'parent=' + short(row.parentId));
  }
  const cards = [];
  rows.forEach((row, index) => {
    for (let col = row.visibleFrom; col <= row.visibleTo; col += 1) {
      cards.push({
        row: index,
        session: short(row.id),
        col,
        x1: INSET + col * STEP,
        x2: INSET + col * STEP + COL_W,
        y1: row.top + CARD_TOP,
        y2: row.top + CARD_TOP + CARD_H,
      });
    }
  });
  console.log('  cards:', cards.length, '| compact rows:', rows.filter((row) => row.compact === true).length);

  const all = [];
  for (const edge of edges) {
    segments(edge, rows).forEach((part, partIndex) => all.push({
      ...part,
      label: 'edge r' + edge.fromRow + '→r' + edge.toRow + (edge.gap ? '(gap)' : '') + '#' + partIndex,
    }));
  }
  const links = [];
  rows.forEach((row, index) => {
    if (row.visibleTo <= row.visibleFrom) return;
    const y = row.top + CARD_TOP + CARD_H / 2;
    for (let col = row.visibleFrom; col < row.visibleTo; col += 1) {
      links.push({ kind: 'h', y, a: INSET + col * STEP + COL_W - 3, b: INSET + (col + 1) * STEP + 3, label: 'link r' + index + ' c' + col });
    }
  });
  const combined = [...all, ...links];

  const overlaps = [];
  for (let i = 0; i < combined.length; i += 1) {
    for (let j = i + 1; j < combined.length; j += 1) {
      const length = collinearOverlap(combined[i], combined[j]);
      if (length !== undefined) overlaps.push({ a: combined[i], b: combined[j], length });
    }
  }
  const collisions = [];
  for (const segment of all) {
    for (const card of cards) {
      if (hitsCard(segment, card)) collisions.push({ segment, card });
    }
  }
  console.log('  collinear overlaps:', overlaps.length);
  for (const item of overlaps.slice(0, 20)) console.log('    len=' + item.length.toFixed(1), item.a.label, '~', item.b.label);
  console.log('  line × card collisions:', collisions.length);
  const seen = new Set();
  for (const item of collisions) {
    const key = item.segment.label + '@' + item.card.session + ':' + item.card.col;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('    ' + item.segment.label + ' hits card ' + item.card.session + ' row' + item.card.row + ' col' + item.card.col);
  }
}

report('default (archived hidden)', { showArchived: false, showInherited: false });
report('show archived', { showArchived: true, showInherited: false });
report('show inherited', { showArchived: false, showInherited: true });
