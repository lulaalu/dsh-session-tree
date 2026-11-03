// Smoke render test for the Session Tree client bundle.
// Runs the real client.js against a stub React + stub DSH client context, so a
// render-time ReferenceError/TypeError fails here instead of blanking the panel.
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const code = readFileSync(new URL('../client.js', here), 'utf8');

// ---- fake browser globals -------------------------------------------------
const noop = () => {};
const fakeElement = () => ({
  dataset: {},
  style: { setProperty: noop },
  setAttribute: noop,
  removeAttribute: noop,
  remove: noop,
  appendChild: noop,
  textContent: '',
});
globalThis.window = { __ModuleLoader__: { load: (m) => { globalThis.__pluginModule = m; } } };
globalThis.document = {
  querySelector: () => null,
  createElement: fakeElement,
  head: { appendChild: noop },
  addEventListener: noop,
  removeEventListener: noop,
};
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'zh-CN', platform: 'Win32', clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

new Function(code)();

// ---- fake React -----------------------------------------------------------
function makeFakeReact() {
  const hooks = { state: [], index: 0 };
  const forced = {};
  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props || {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(init) {
      const index = hooks.index++;
      if (!Object.prototype.hasOwnProperty.call(forced, index)) {
        hooks.state[index] = { value: typeof init === 'function' ? init() : init };
      } else {
        hooks.state[index] = { value: forced[index] };
        delete forced[index];
      }
      return [hooks.state[index].value, (next) => { hooks.state[index].value = typeof next === 'function' ? next(hooks.state[index].value) : next; }];
    },
    useMemo(fn) { return fn(); },
    useRef(init) { return { current: init }; },
    useEffect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanup(); },
  };
  const renderNode = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') return;
    if (Array.isArray(node)) { for (const child of node) renderNode(child); return; }
    const { type, props } = node;
    if (typeof type === 'function') {
      const savedState = hooks.state;
      const savedIndex = hooks.index;
      hooks.state = [];
      hooks.index = 0;
      let output;
      try {
        output = type(props || {});
      } finally {
        hooks.state = savedState;
        hooks.index = savedIndex;
      }
      renderNode(output);
      return;
    }
    if (typeof type === 'string' && props !== undefined) {
      if (typeof props.className === 'string') {
        React.seen.push(props.className);
        const classes = props.className.split(' ');
        if (props.className.indexOf('st-edge') >= 0 && typeof props.d === 'string') React.seen.push('EDGE:' + props.d);
        if (classes.indexOf('st-card') >= 0 && props.style !== undefined && typeof props.style.left === 'string') {
          React.seen.push('CARDLEFT:' + props.style.left);
        }
        if (classes.indexOf('st-mini') >= 0 && props.style !== undefined && typeof props.style.left === 'string') {
          React.seen.push('MINILEFT:' + props.style.left);
        }
      }
      if (props['data-archived'] === 'true') React.seen.push('data-archived');
      if (props['data-compact'] === 'true') React.seen.push('data-compact');
      if (props['data-subagent'] === 'true') React.seen.push('data-subagent');
      if (props['data-mini'] === 'true') React.seen.push('data-mini');
      if (props.children !== undefined) renderNode(props.children);
    }
  };
  React.render = renderNode;
  React.forced = forced;
  React.resetHooks = () => { hooks.state = []; hooks.index = 0; };
  React.seen = [];
  return React;
}

// ---- test data ------------------------------------------------------------
const turns = (count, baseSeq, startTurn) => Array.from({ length: count }, (_, i) => ({
  turn: startTurn + i,
  seq: baseSeq + i * 4,
  prompt: 'prompt ' + (startTurn + i),
  response: 'reply ' + (startTurn + i),
}));
const parentTurns = turns(5, 0, 1);
// A fork copies the first three turns verbatim (same seqs) and owns the rest with
// fresh seqs past the inherited prefix, so the prefix matcher can see the cut.
const childTurns = [...parentTurns.slice(0, 3), ...turns(2, 13, 4)];

function makeSessions(ids) {
  const parent = {
    id: 's1', title: '主会话', displayTitle: '主会话', cwd: 'D:\\proj', running: false, blank: false,
    updatedAt: Date.now(), projectionValues: { turnOutline: parentTurns },
  };
  const child = {
    id: 's2', title: '分叉会话', displayTitle: '分叉会话', cwd: 'D:\\proj', running: false, blank: false,
    updatedAt: Date.now() - 2000, parentId: 's1', projectionValues: { turnOutline: childTurns },
  };
  const byId = {};
  for (const id of ids) byId[id] = id === 's1' ? parent : child;
  return { ids, byId };
}
const workspace = {
  items: [{ workspaceId: 'w1', path: 'D:\\proj', title: 'proj', sessionIds: ['s1', 's2'] }],
  archivedSessionIds: [],
  pinnedSessionIds: [],
  state: 'idle', phase: 'ready', error: null,
};

// ---- install the plugin ---------------------------------------------------
const React = makeFakeReact();
const requireStub = (id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
};
const plugin = globalThis.__pluginModule.factory(requireStub);

const captured = {};
const ctx = {
  effect: (fn) => fn(),
  get: () => undefined,
  locale: { register: noop, bind: () => (key) => key },
  layout: { selectPanel: noop },
  sessions: { refreshProjections: async () => {}, using: async () => ({ ok: true }), fork: async () => 'x', binding: () => undefined },
  workspaces: { pinSession: async () => {}, unpinSession: async () => {} },
  uiWorkspace: { openSession: noop, archiveSession: async () => {}, unarchiveSession: async () => {}, forkSession: async () => 'x' },
  slots: {
    inject: (name, callback) => { callback(); },
    register: (options, component) => {
      captured[options.name + ':' + (options.key || options.id || '')] = component;
      return noop;
    },
  },
};
plugin.apply(ctx);

const mainComponent = captured['main:session-tree'];
if (mainComponent === undefined) throw new Error('main panel component was not registered');

function renderScenario(label, sessionsState, workspacesState, forced, checks) {
  const check = checks || {};
  React.resetHooks();
  React.seen = [];
  Object.assign(React.forced, forced || {});
  const props = {
    useSessions: (selector) => selector(sessionsState),
    useWorkspaces: (selector) => selector(workspacesState),
    t: (key) => key,
    locateTurn: noop,
    forkTurn: noop,
    refreshProjections: async () => {},
    shortcutLabel: () => 'Ctrl + Alt + G',
    sessionActions: {
      rename: async () => {},
      archive: async () => {},
      unarchive: async () => {},
      pin: async () => {},
      fork: async () => 'x',
      copyId: async () => true,
    },
  };
  const hasClass = (name) => React.seen.some((cls) => cls.split(' ').indexOf(name) >= 0);
  const countClass = (name) => React.seen.filter((cls) => cls.split(' ').indexOf(name) >= 0).length;
  try {
    React.render(React.createElement(mainComponent, props));
    const missing = (check.has || []).filter((name) => !hasClass(name));
    if (missing.length > 0) {
      console.log('FAIL ' + label + ' -> rendered without: ' + missing.join(', '));
      process.exitCode = 1;
      return;
    }
    const unexpected = (check.absent || []).filter((name) => hasClass(name));
    if (unexpected.length > 0) {
      console.log('FAIL ' + label + ' -> unexpectedly rendered: ' + unexpected.join(', '));
      process.exitCode = 1;
      return;
    }
    for (const [name, expected] of Object.entries(check.counts || {})) {
      const actual = countClass(name);
      if (actual !== expected) {
        console.log('FAIL ' + label + ' -> ' + name + ' count ' + actual + ', expected ' + expected);
        process.exitCode = 1;
        return;
      }
    }
    if (check.longEdges !== undefined) {
      const longEdges = React.seen.filter((entry) => typeof entry === 'string' && entry.startsWith('EDGE:'))
        .filter((entry) => (entry.slice(5).match(/L/g) || []).length >= 5).length;
      if (longEdges !== check.longEdges) {
        console.log('FAIL ' + label + ' -> gutter-routed edges ' + longEdges + ', expected ' + check.longEdges);
        process.exitCode = 1;
        return;
      }
    }
    console.log('OK   ' + label);
  } catch (error) {
    console.log('FAIL ' + label + ' -> ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : String(error)));
    process.exitCode = 1;
  }
}

function makeChain(visibleIds) {
  const s1 = { id: 'c1', title: '会话1', displayTitle: '会话1', cwd: 'D:\\proj', running: false, blank: false, updatedAt: Date.now(), projectionValues: { turnOutline: turns(5, 0, 1) } };
  const s2 = { id: 'c2', title: '会话2', displayTitle: '会话2', cwd: 'D:\\proj', running: false, blank: false, updatedAt: Date.now() - 1000, parentId: 'c1', projectionValues: { turnOutline: [...turns(5, 0, 1).slice(0, 3), ...turns(2, 13, 4)] } };
  const s3 = { id: 'c3', title: '会话3', displayTitle: '会话3', cwd: 'D:\\proj', running: false, blank: false, updatedAt: Date.now() - 2000, parentId: 'c2', projectionValues: { turnOutline: [...turns(5, 0, 1).slice(0, 3), ...turns(2, 13, 4).slice(0, 1), ...turns(2, 22, 5)] } };
  // The catalog (`byId`) carries every Session, including the filtered-out ones;
  // only `ids` expresses what the current filters show. Lineage reads `byId`.
  return { ids: visibleIds, byId: { c1: s1, c2: s2, c3: s3 } };
}

function makeLongFork() {
  const base = turns(6, 0, 1);
  const p = { id: 'L1', title: 'P', displayTitle: 'P', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 5000, projectionValues: { turnOutline: base } };
  const a = { id: 'L2', title: 'A', displayTitle: 'A', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 4000, parentId: 'L1', projectionValues: { turnOutline: [base[0], base[1], { turn: 3, seq: 13, prompt: 'a', response: 'a' }] } };
  const a2 = { id: 'L3', title: 'A2', displayTitle: 'A2', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 3000, parentId: 'L2', projectionValues: { turnOutline: [base[0], base[1], { turn: 3, seq: 13, prompt: 'a', response: 'a' }, { turn: 4, seq: 22, prompt: 'a2', response: 'a2' }] } };
  const b = { id: 'L4', title: 'B', displayTitle: 'B', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 2000, parentId: 'L1', projectionValues: { turnOutline: [base[0], base[1], { turn: 3, seq: 100, prompt: 'b', response: 'b' }] } };
  // P has two forked children; the second one sits below the first one's subtree, so its
  // connector must skip rows and therefore take the gutter route.
  return { ids: ['L1', 'L2', 'L3', 'L4'], byId: { L1: p, L2: a, L3: a2, L4: b } };
}

function makeEmptyFork() {
  const base = turns(3, 0, 1);
  const p = { id: 'E1', title: 'P', displayTitle: 'P', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 5000, projectionValues: { turnOutline: base } };
  // Fork was created but never continued: every turn is the parent prefix.
  const c = { id: 'E2', title: 'E', displayTitle: 'E', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 4000, parentId: 'E1', projectionValues: { turnOutline: base } };
  return { ids: ['E1', 'E2'], byId: { E1: p, E2: c } };
}

function makeSubagents() {
  const base = turns(4, 0, 1);
  const p = { id: 'A1', title: 'P', displayTitle: 'P', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 5000, projectionValues: { turnOutline: base } };
  // Seeded sub-agent: it forked the parent context and then did its own work.
  const s = { id: 'A2', title: 'S', displayTitle: 'S', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 4000, parentId: 'A1', origin: 'subagent', projectionValues: { turnOutline: [base[0], base[1], { turn: 3, seq: 30, prompt: 's', response: 's' }] } };
  // Fresh sub-agent: spawn only, no inherited prefix.
  const f = { id: 'A3', title: 'F', displayTitle: 'F', cwd: 'D:\\proj', running: false, blank: false, updatedAt: 3000, parentId: 'A1', origin: 'subagent', projectionValues: { turnOutline: [{ turn: 1, seq: 40, prompt: 'f1', response: 'f1' }, { turn: 2, seq: 44, prompt: 'f2', response: 'f2' }] } };
  return { ids: ['A1', 'A2', 'A3'], byId: { A1: p, A2: s, A3: f } };
}

renderScenario('subagent chain expanded', makeSubagents(), workspace, { 1: true }, {
  has: ['st-mini', 'st-edge-spawn', 'data-mini', 'MINILEFT:224px', 'MINILEFT:636px'],
  absent: ['st-edge-gap', 'st-card-spawn'],
  counts: { 'st-edge': 2, 'st-mini': 2, 'st-card': 4 },
});
renderScenario('subagent collapsed badge', makeSubagents(), workspace, undefined, {
  has: ['st-card-spawn'],
  absent: ['st-mini', 'st-edge-spawn', 'data-mini'],
  counts: { 'st-card': 4 },
});

renderScenario('normal tree', makeSessions(['s1', 's2']), workspace, undefined, {
  has: ['st-card', 'st-divider', 'st-label-fork', 'st-edge', 'st-rowsep'],
  counts: { 'st-edge': 1 },
});
renderScenario('compact empty fork', makeEmptyFork(), workspace, undefined, {
  has: ['data-compact', 'st-card', 'st-rowsep'],
  absent: ['st-edge'],
  counts: { 'st-card': 3 },
});
renderScenario('row separators in graph', makeSessions(['s1', 's2']), workspace, { 12: true }, {
  has: ['st-sep-line'],
});
renderScenario('long fork across a subtree', makeLongFork(), workspace, undefined, {
  has: ['st-card', 'st-edge'],
  counts: { 'st-edge': 3 },
  longEdges: 1,
});
renderScenario('archived parent', makeSessions(['s1', 's2']), { ...workspace, archivedSessionIds: ['s1'] }, undefined, {
  has: ['st-card', 'st-label-fork'],
  absent: ['st-edge'],
});
renderScenario('archived middle of chain', makeChain(['c1', 'c3']), { ...workspace, archivedSessionIds: ['c2'] }, undefined, {
  has: ['st-card', 'st-label-fork', 'st-edge', 'st-edge-gap'],
  counts: { 'st-edge': 1, 'st-card': 8 },
});
renderScenario('chain fully visible', makeChain(['c1', 'c2', 'c3']), workspace, undefined, {
  has: ['st-card', 'st-edge'],
  absent: ['st-edge-gap'],
  counts: { 'st-edge': 2 },
});
renderScenario('archived rows shown', makeSessions(['s1', 's2']), { ...workspace, archivedSessionIds: ['s1'] }, { 2: true }, {
  has: ['data-archived', 'st-edge'],
  counts: { 'st-edge': 1 },
});
renderScenario('menu open', makeSessions(['s1', 's2']), workspace, { 8: 's1' }, { has: ['st-menu-item', 'st-menu-shortcut'] });
renderScenario('settings open', makeSessions(['s1', 's2']), workspace, { 9: true }, { has: ['st-popover', 'st-color'] });
renderScenario('rename dialog', makeSessions(['s1', 's2']), workspace, { 11: { kind: 'rename', sessionId: 's1', title: '主会话' } }, { has: ['st-dialog', 'st-dialog-input'] });
renderScenario('archive dialog', makeSessions(['s1', 's2']), workspace, { 11: { kind: 'archive-running', sessionId: 's1', title: '主会话' } }, { has: ['st-dialog'] });
renderScenario('inherited shown', makeSessions(['s1', 's2']), workspace, { 0: true }, { has: ['st-card'] });
renderScenario('empty list', { ids: [], byId: {} }, { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }, undefined, { has: ['st-empty'] });
renderScenario('missing projections', { ids: ['s9'], byId: { s9: { id: 's9', displayTitle: 'no turns', cwd: 'D:\\proj', running: false, blank: false, updatedAt: Date.now() } } }, workspace, undefined, { has: ['st-label'] });
