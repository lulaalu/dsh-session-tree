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
  // 0.2.1 named cache files "<uuid>.json"; 0.2.2 writes "<session-id>.json".
  const cachePaths = [join(PROJCACHE, id + '.json'), join(PROJCACHE, id.replace(/^session-/, '') + '.json')];
  for (const cachePath of cachePaths) {
    if (existsSync(cachePath)) {
      cache = readJson(cachePath);
      break;
    }
  }
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
    inheritedEventCount: cache !== undefined && cache.record !== undefined && cache.record.identity !== undefined
      ? cache.record.identity.inheritedEventCount
      : undefined,
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
  const sameTurn = (left, right) => left !== undefined && right !== undefined
    && left.seq === right.seq
    && String(left.prompt || '') === String(right.prompt || '')
    && String(left.response || '') === String(right.response || '');
  const sharedPrefix = (left, right) => {
    if (right === undefined) return 0;
    let shared = 0;
    while (shared < left.turns.length && shared < right.turns.length && sameTurn(left.turns[shared], right.turns[shared])) shared += 1;
    return shared;
  };
  const exactTurns = (session) => {
    const boundary = session.inheritedEventCount;
    if (typeof boundary !== 'number') return undefined;
    let count = 0;
    while (count < session.turns.length && session.turns[count].seq < boundary) count += 1;
    return count;
  };
  // DSH 0.2.2 forks without parentSession: recover the source from the copied prefix.
  // Hidden ancestors get resolved too, so a visible child can re-attach to the nearest
  // ancestor that renders cards instead of floating.
  const inferredParent = new Map();
  {
    let pool;
    const candidatePool = () => {
      if (pool !== undefined) return pool;
      pool = [...known.values()];
      return pool;
    };
    const resolved = new Map();
    const inferParent = (child) => {
      if (resolved.has(child.id)) return resolved.get(child.id);
      resolved.set(child.id, undefined);
      if (child.parentSession !== undefined) return undefined;
      if (child.origin === 'subagent') return undefined;
      if (typeof child.inheritedEventCount !== 'number' || child.inheritedEventCount <= 0) return undefined;
      const k = exactTurns(child);
      if (k === undefined || k <= 0) return undefined;
      let best;
      let bestRank;
      for (const candidate of candidatePool()) {
        if (candidate.id === child.id || candidate.origin === 'subagent') continue;
        if (candidate.cwd !== undefined && child.cwd !== undefined && norm(candidate.cwd) !== norm(child.cwd)) continue;
        if (candidate.turns.length < k) continue;
        if (candidate.createdAt >= child.createdAt) continue;
        let matches = true;
        for (let index = 0; index < k; index += 1) {
          if (!sameTurn(candidate.turns[index], child.turns[index])) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        const forkLike = candidate.turns.length === k || Number(candidate.turns[k].seq) > child.inheritedEventCount - 1;
        const rank = [forkLike ? 0 : 1, candidate.turns.length, -candidate.createdAt];
        const better = bestRank === undefined
          || rank[0] < bestRank[0]
          || (rank[0] === bestRank[0] && rank[1] < bestRank[1])
          || (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] < bestRank[2]);
        if (better) {
          best = candidate;
          bestRank = rank;
        }
      }
      const parentId = best === undefined ? undefined : best.id;
      resolved.set(child.id, parentId);
      if (parentId !== undefined) inferredParent.set(child.id, parentId);
      return parentId;
    };
    const queue = [...byId.values()];
    const processed = new Set();
    while (queue.length > 0 && processed.size < 500) {
      const child = queue.shift();
      if (child === undefined || processed.has(child.id)) continue;
      processed.add(child.id);
      const parentId = inferParent(child);
      if (parentId === undefined) continue;
      const parent = known.get(parentId);
      if (parent !== undefined && !processed.has(parent.id)) queue.push(parent);
    }
  }
  const parentIdOf = (session) => (inferredParent.get(session.id) !== undefined ? inferredParent.get(session.id) : session.parentSession);
  const visibleAncestorOf = (session) => {
    let cursor = parentIdOf(session);
    const guard = new Set();
    while (cursor !== undefined && cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      const candidate = byId.get(cursor);
      if (candidate !== undefined) return candidate;
      const lineage = known.get(cursor);
      if (lineage === undefined) return undefined;
      cursor = parentIdOf(lineage);
    }
    return undefined;
  };
  const rendersCards = (session) => {
    if (session.turns.length === 0) return false;
    const exact = exactTurns(session);
    if (exact !== undefined) return session.turns.length > exact;
    return true;
  };
  const cardAncestorOf = (session) => {
    let cursor = parentIdOf(session);
    const guard = new Set();
    while (cursor !== undefined && cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      const candidate = byId.get(cursor);
      if (candidate !== undefined) {
        if (candidate.origin === 'subagent' || rendersCards(candidate)) return candidate;
        cursor = parentIdOf(candidate);
        continue;
      }
      const lineage = known.get(cursor);
      if (lineage === undefined) return undefined;
      cursor = parentIdOf(lineage);
    }
    return undefined;
  };
  const parentOf = new Map();
  const childrenOf = new Map();
  const roots = [];
  for (const session of byId.values()) {
    const nearest = visibleAncestorOf(session);
    const anchor = session.origin === 'subagent' ? undefined : cardAncestorOf(session);
    const ancestor = anchor !== undefined ? anchor : nearest;
    parentOf.set(session.id, ancestor);
    if (ancestor === undefined) {
      roots.push(session);
    } else {
      let list = childrenOf.get(ancestor.id);
      if (list === undefined) {
        list = [];
        childrenOf.set(ancestor.id, list);
      }
      list.push(session);
    }
  }
  const rows = [];
  const seen = new Set();
  const rowOf = (id) => rows.find((row) => row.id === id);
  const walk = (session, depth) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    const directParentId = parentIdOf(session);
    const directParent = directParentId === undefined ? undefined : known.get(directParentId);
    const effectiveParent = parentOf.get(session.id);
    const exact = exactTurns(session);
    const directInherited = exact === undefined ? sharedPrefix(session, directParent) : exact;
    const anchorPrefix = effectiveParent === undefined ? 0 : sharedPrefix(session, effectiveParent);
    const anchorHasTurns = effectiveParent !== undefined && effectiveParent.turns.length > 0;
    const effectiveInherited = exact === undefined
      ? anchorPrefix
      : (effectiveParent === undefined ? 0 : (anchorHasTurns ? Math.min(exact, anchorPrefix) : exact));
    const inherited = exact === undefined ? Math.max(directInherited, effectiveInherited) : exact;
    const parentRow = effectiveParent === undefined ? undefined : rowOf(effectiveParent.id);
    const anchorRendersCards = parentRow !== undefined && parentRow.visibleTo >= parentRow.visibleFrom;
    const hiddenGap = effectiveParent !== undefined && directParentId !== undefined && effectiveParent.id !== directParentId;
    const directParentVisible = directParentId !== undefined && byId.has(directParentId);
    const directParentTurns = directParent === undefined ? [] : directParent.turns;
    // A compact parent renders no cards, so the child shows the fork-point turn itself.
    const compactParent = hiddenGap && directParentVisible && directParentTurns.length > 0 && rendersCards(directParent) === false;
    let visibleFrom;
    if (options.showInherited) visibleFrom = 0;
    else if (!anchorRendersCards) visibleFrom = 0;
    else if (hiddenGap) visibleFrom = Math.max(0, Math.min(effectiveInherited, inherited) - 1);
    else visibleFrom = effectiveInherited;
    rows.push({
      id: session.id,
      turns: session.turns.length,
      depth,
      parentId: effectiveParent === undefined ? undefined : effectiveParent.id,
      directId: directParent === undefined ? undefined : directParent.id,
      inherited,
      effectiveInherited,
      forkCol: effectiveParent === undefined ? -1 : effectiveInherited - 1,
      visibleFrom,
      visibleTo: session.turns.length - 1,
      archived: archived.has(session.id),
      hiddenGap,
    });
    for (const child of childrenOf.get(session.id) || []) walk(child, depth + 1);
  };
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
  // A non-compact row that starts after column 0 needs a drawn incoming fork edge,
  // otherwise its first turn floats with no visible predecessor or connector.
  const incoming = new Set(edges.map((edge) => edge.toRow));
  const dangling = rows.filter((row, index) => row.compact !== true && row.visibleTo >= 0 && row.visibleFrom > 0 && !incoming.has(index));
  const detachedInherited = rows.filter((row) => row.compact !== true && row.inherited > 0 && row.visibleFrom === 0);
  console.log('  dangling rows:', dangling.length, '| inherited prefix shown detached:', detachedInherited.length);
  for (const row of dangling.slice(0, 10)) {
    console.log('    ' + short(row.id) + ' starts at col' + row.visibleFrom + ' parent=' + short(row.parentId));
  }
  for (const row of detachedInherited.slice(0, 5)) {
    console.log('    detached ' + short(row.id) + ' inh=' + row.inherited + ' parent=' + short(row.directId));
  }
}

report('default (archived hidden)', { showArchived: false, showInherited: false });
report('show archived', { showArchived: true, showInherited: false });
report('show inherited', { showArchived: false, showInherited: true });
