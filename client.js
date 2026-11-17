window.__ModuleLoader__.load({
	id: '@lulaalu/dsh-session-tree',
	factory: (require) => {
		const React = require('react');
		const h = React.createElement;
		const { useMemo, useState, useEffect, useRef } = React;

		//#region constants
		const PANEL_ID = 'session-tree';
		const NS = 'sessionTree';
		const COL_W = 180;
		const COL_GAP = 26;
		const CARD_H = 84;
		const ROW_H = 100;
		const COMPACT_ROW_H = 46;
		const MINI_ROW_H = 38;
		const MINI_H = 24;
		const MINI_TOP = 7;
		const ROW_GAP = 16;
		const LABEL_W = 240;
		const CARD_TOP = (ROW_H - CARD_H) / 2;
		const STEP = COL_W + COL_GAP;
		const TRACK_INSET = 18;
		const CONTENT_PAD_RIGHT = 56;
		/** A merged display node is only slightly larger than one turn card, and takes one column. */
		const MERGE_CARD_H = CARD_H + 12;
		const MERGE_ROW_EXTRA = MERGE_CARD_H - CARD_H;
		const MERGE_W_EXTRA = 20;
		const MERGE_W_BLEED = MERGE_W_EXTRA / 2;
		/** Vertical bounds of a row's node area: a turn card, or a chained sub-agent mini node. */
		const rowCardTop = (row) => (row.mini === true ? MINI_TOP : (row.cardTop === undefined ? CARD_TOP : row.cardTop));
		const rowNodeTop = (row) => row.top + rowCardTop(row);
		const rowNodeBottom = (row) => row.top + rowCardTop(row) + (row.mini === true ? MINI_H : CARD_H);
		/** Visual column of one turn index after merged ranges collapse into single columns. */
		const rowColumnOf = (row, index) => row.colOffset + (row.colOf === undefined ? index : (row.colOf[index] === undefined ? index : row.colOf[index]));
		const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null };
		/** Label column width survives panel switches (module-scoped, not persisted). */
		let labelWidthStored = LABEL_W;
		/** Default accent: DeepSeek brand blue, independent of the active theme. */
		const DEFAULT_ACCENT = '#4d6bfe';
		const THEME_ACCENT = 'theme';
		const ACCENT_KEY = 'session-tree:accent';
		let accentStored = DEFAULT_ACCENT;
		try {
			const savedAccent = typeof localStorage === 'undefined' ? null : localStorage.getItem(ACCENT_KEY);
			if (savedAccent === THEME_ACCENT) accentStored = THEME_ACCENT;
			else if (typeof savedAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(savedAccent)) accentStored = savedAccent;
		} catch (error) {
			accentStored = DEFAULT_ACCENT;
		}
		const persistAccent = (value) => {
			try {
				if (typeof localStorage === 'undefined') return;
				if (value === null) localStorage.removeItem(ACCENT_KEY);
				else localStorage.setItem(ACCENT_KEY, value);
			} catch (error) {
				/* storage is best effort */
			}
		};
		const MERGES_KEY = 'session-tree:merges';
		/**
		 * Display-only merged turn ranges per Session (`[[from, to], …]`, 0-based turn
		 * indices). Merging never touches the Session log: it only redraws one node
		 * spanning the range, and branch edges keep their original columns.
		 */
		let mergesStored = {};
		try {
			const savedMerges = typeof localStorage === 'undefined' ? null : localStorage.getItem(MERGES_KEY);
			if (typeof savedMerges === 'string' && savedMerges !== '') {
				const parsed = JSON.parse(savedMerges);
				if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
					for (const sessionId of Object.keys(parsed)) {
						const ranges = parsed[sessionId];
						if (!Array.isArray(ranges)) continue;
						const clean = ranges.filter((range) => Array.isArray(range) && range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] < range[1]);
						if (clean.length > 0) mergesStored[sessionId] = clean;
					}
				}
			}
		} catch (error) {
			mergesStored = {};
		}
		const persistMerges = (value) => {
			try {
				if (typeof localStorage === 'undefined') return;
				localStorage.setItem(MERGES_KEY, JSON.stringify(value));
			} catch (error) {
				/* storage is best effort */
			}
		};
		const normalizeRanges = (ranges) => {
			const sorted = ranges
				.filter((range) => Array.isArray(range) && range.length === 2 && range[0] < range[1])
				.map((range) => [range[0], range[1]])
				.sort((left, right) => left[0] - right[0]);
			const merged = [];
			for (const range of sorted) {
				const last = merged[merged.length - 1];
				// Only overlapping ranges combine: two separately merged neighbouring blocks
				// must stay two nodes, otherwise the second merge looks like it vanished.
				if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
				else merged.push([range[0], range[1]]);
			}
			return merged;
		};
		// Test-only seam: the smoke test drives pure helpers without a browser.
		if (typeof window !== 'undefined' && window.__SESSION_TREE_TEST__ === true) {
			window.__sessionTreeInternals = { normalizeRanges: normalizeRanges };
		}
		/**
		 * Exact fork-inherited turn counts per Session, fetched once per page load from
		 * the Host route. Raw turn seqs are only unique inside one Session log, so the
		 * client-side alignment fallback cannot separate an own turn from an inherited one
		 * when both share seq and content; the Host knows the exact prefix event count.
		 */
		let exactInheritanceStored = {};
		const INHERITANCE_ROUTE = 'api/session-tree/inherit';
		//#endregion

		//#region styles
		const CSS = [
			'.st-root{--st-label-w:240px;--st-accent:#4d6bfe;--st-card-border:var(--dsw-alias-border-l1);--st-line:var(--dsw-alias-border-l2);--st-label-bg:var(--dsw-alias-bg-base);position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
			'.st-root[data-outline="strong"]{--st-card-border:color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent);--st-line:color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent)}',
			'.st-head{flex:none;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:18px 24px 10px}',
			'.st-headtext{min-width:0}',
			'.st-title{margin:0;font-size:16px;font-weight:600;line-height:24px}',
			'.st-sub{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.st-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0}',
			'.st-select{height:28px;max-width:300px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
			'.st-toggle{height:28px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
			'.st-toggle:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);color:var(--dsw-alias-label-primary)}',
			'.st-toggle[data-on="true"]{border-color:var(--st-accent);color:var(--st-accent);background:color-mix(in srgb, var(--st-accent) 12%, transparent)}',
			'.st-toggle-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7}',
			'.st-toggle[data-tip]{position:relative}',
			'.st-toggle[data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 8px);right:0;z-index:80;box-sizing:border-box;max-width:320px;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;white-space:normal;text-align:left;box-shadow:0 6px 18px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);pointer-events:none}',
			'.st-hint{flex:none;padding:0 24px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
			'.st-error{flex:none;margin:0 24px 8px;padding:6px 10px;border-radius:6px;font-size:12px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}',
			'.st-body{flex:1;min-height:0;overflow:auto;position:relative;padding:4px 0 32px;isolation:isolate}',
			'.st-grid{position:relative;display:flex;flex-direction:column;width:max-content;min-width:100%}',
			'.st-edges{position:absolute;top:0;left:0;z-index:0;overflow:visible;pointer-events:none}',
			'.st-edges path{fill:none;stroke:var(--st-line);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
			'.st-edges path.st-edge-gap{stroke-dasharray:5 4}',
			'.st-edges path.st-sep-line{fill:none;stroke:color-mix(in srgb, var(--st-line) 40%, transparent);stroke-width:1}',
			'.st-edges path.st-edge-spawn{stroke:color-mix(in srgb, var(--st-line) 74%, transparent);stroke-width:1.2;stroke-dasharray:1.6 3.6}',
			'.st-edges circle.st-spawn-dot{fill:var(--dsw-alias-bg-base);stroke:color-mix(in srgb, var(--st-line) 90%, transparent);stroke-width:1.2}',
			'.st-row{position:relative;z-index:2;display:flex;align-items:stretch;flex:0 0 auto}',
			'.st-label{position:sticky;left:0;z-index:4;flex:0 0 auto;box-sizing:border-box;width:var(--st-label-w);height:100%;padding:0 14px 0 22px;display:flex;flex-direction:column;justify-content:center;gap:2px;background:var(--st-label-bg)}',
			'.st-label::after{content:"";position:absolute;left:0;right:0;top:100%;height:16px;background:var(--st-label-bg);pointer-events:none}',
			'.st-divider{position:absolute;top:0;bottom:-16px;right:-1px;width:1px;z-index:5;pointer-events:none;background:var(--st-card-border)}',
			'.st-resizer{position:absolute;top:0;bottom:-16px;right:-6px;width:12px;z-index:6;cursor:col-resize;touch-action:none;background:transparent}',
			'.st-menu-trigger{position:absolute;top:6px;right:9px;width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s}',
			'.st-row:hover .st-menu-trigger,.st-menu-trigger[data-open="true"],.st-menu-trigger:focus-visible{opacity:1}',
			'.st-menu-trigger:hover,.st-menu-trigger[data-open="true"]{background:color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);color:var(--dsw-alias-label-primary)}',
			'.st-menu{position:absolute;z-index:90;box-sizing:border-box;min-width:250px;padding:4px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent)}',
			'.st-menu-item{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;white-space:nowrap;cursor:pointer}',
			'.st-menu-item:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}',
			'.st-menu-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}',
			'.st-menu-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:currentColor;opacity:.8}',
			'.st-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
			'.st-menu-shortcut{flex:none;margin-left:14px;font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}',
			'.st-menu-sep{height:1px;margin:4px 6px;background:var(--st-card-border)}',
			'.st-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent)}',
			'.st-dialog{width:min(430px,calc(100vw - 48px));min-height:186px;box-sizing:border-box;padding:18px 20px 14px;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)}',
			'.st-dialog-title{margin:0 0 12px;font-size:14px;font-weight:600}',
			'.st-dialog-text{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
			'.st-dialog-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}',
			'.st-dialog-input:focus{border-color:var(--st-accent)}',
			'.st-dialog-note{flex:none;height:34px;margin-top:6px;overflow:hidden;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary)}',
			'.st-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:auto;padding-top:8px}',
			'.st-btn{height:28px;padding:0 14px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
			'.st-btn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}',
			'.st-btn[data-primary="true"]{border-color:var(--st-accent);background:var(--st-accent);color:var(--dsw-alias-bg-base)}',
			'.st-btn[data-primary="true"]:hover{background:color-mix(in srgb, var(--st-accent) 86%, var(--dsw-alias-label-primary))}',
			'.st-settings{position:relative;flex:none;display:inline-flex}',
			'.st-settings-trigger{width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.st-settings-trigger:hover,.st-settings-trigger[data-open="true"]{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);color:var(--dsw-alias-label-primary)}',
			'.st-popover{position:absolute;z-index:95;top:34px;right:0;width:250px;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent)}',
			'.st-popover-title{margin:0 0 10px;font-size:12px;font-weight:600}',
			'.st-color-row{display:flex;align-items:center;gap:10px}',
			'.st-color{width:40px;height:28px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;cursor:pointer}',
			'.st-popover-note{margin-top:10px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary)}',
			'.st-link-btn{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;cursor:pointer}',
			'.st-link-btn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}',
			'.st-link-btn[data-active="true"]{border-color:var(--st-accent);color:var(--st-accent);background:color-mix(in srgb, var(--st-accent) 10%, transparent)}',
			'.st-label-title{font-size:12.5px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.st-label-meta{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.st-label-fork{font-size:10.5px;color:var(--st-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.st-label-archived{display:flex;align-items:center;gap:6px}',
			'.st-chip{display:inline-flex;align-items:center;height:16px;padding:0 7px;border-radius:999px;border:1px solid var(--st-card-border);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;white-space:nowrap}',
			'.st-mini{position:absolute;box-sizing:border-box;width:180px;height:24px;padding:0 8px;display:flex;align-items:center;gap:6px;border-radius:12px;border:1px dashed color-mix(in srgb, var(--st-line) 80%, transparent);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;cursor:pointer}',
			'.st-mini:hover{border-color:var(--st-accent);color:var(--dsw-alias-label-primary)}',
			'.st-mini[data-running="true"]{border-color:var(--dsw-alias-state-success-primary)}',
			'.st-mini[data-archived="true"]{opacity:.7}',
			'.st-mini-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--dsw-alias-label-primary)}',
			'.st-mini-count{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
			'.st-card-spawn{position:absolute;right:5px;bottom:4px;display:inline-flex;align-items:center;gap:3px;height:14px;padding:0 5px;border-radius:7px;background:color-mix(in srgb, var(--st-accent) 12%, transparent);color:var(--st-accent);font-size:9.5px;line-height:14px;pointer-events:none}',
			'.st-card-spawn-count{font-variant-numeric:tabular-nums}',
			'.st-row[data-mini="true"] .st-label-title{font-size:12px}',
			'.st-body{cursor:grab}',
			'.st-body[data-panning="true"]{cursor:grabbing;user-select:none}',
			'.st-card[data-selected="true"]{border-color:var(--st-accent);box-shadow:0 0 0 2px color-mix(in srgb, var(--st-accent) 32%, transparent)}',
			'.st-merge-count{margin-left:auto;display:inline-flex;align-items:center;height:15px;padding:0 7px;border-radius:999px;background:color-mix(in srgb, var(--st-accent) 12%, transparent);color:var(--st-accent);font-size:9.5px;line-height:15px;font-variant-numeric:tabular-nums}',
			'.st-merge{padding:8px 12px;gap:2px;border-radius:12px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 80%, var(--st-accent) 5%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--st-accent) 55%, transparent)}',
			'.st-merge .st-card-prompt{-webkit-line-clamp:2;line-height:16px}',
			'.st-merge .st-card-reply{-webkit-line-clamp:2;line-height:14px}',
			'.st-merge-split{position:absolute;right:6px;bottom:5px;height:14px;padding:0 6px;border-radius:6px;border:1px solid var(--st-card-border);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:9.5px;line-height:12px;cursor:pointer;opacity:0;transition:opacity .12s}',
			'.st-merge:hover .st-merge-split,.st-merge-split:focus-visible{opacity:1}',
			'.st-toolbar{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:999px;border:1px solid var(--st-card-border);background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 16px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);z-index:40}',
			'.st-toolbar-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
			'.st-toolbar-btn{height:22px;padding:0 10px;border-radius:999px;border:1px solid var(--st-card-border);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}',
			'.st-toolbar-btn:hover{border-color:var(--st-accent)}',
			'.st-toolbar-primary{background:var(--st-accent);border-color:var(--st-accent);color:#fff}',
			'.st-rowsep{position:absolute;left:18%;right:18%;bottom:-8px;height:1px;z-index:2;pointer-events:none;background:linear-gradient(90deg, transparent 0%, var(--st-line) 24%, var(--st-line) 76%, transparent 100%)}',
			'.st-row[data-compact="true"] .st-label-title{font-size:12px}',
			'.st-row[data-subagent="true"] .st-label{border-left:2px dotted var(--st-card-border)}',
			'.st-chip[data-kind="subagent"]{border-style:dotted}',
			'.st-row[data-compact="true"] .st-label-meta{color:var(--dsw-alias-label-secondary)}',
			'.st-row[data-compact="true"] .st-divider{bottom:-16px}',
			'.st-row[data-archived="true"]{--st-label-bg:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base))}',
			'.st-row[data-archived="true"] .st-label-title{color:var(--dsw-alias-label-secondary);font-weight:500}',
			'.st-track{position:relative;flex:0 0 auto;height:100%}',
			'.st-card{position:absolute;box-sizing:border-box;width:180px;height:84px;padding:7px 9px;display:flex;flex-direction:column;gap:2px;border-radius:10px;border:1px solid var(--st-card-border);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;overflow:hidden;user-select:none}',
			'.st-root:where([data-outline="strong"]) .st-card{box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent)}',
			'.st-card:hover,.st-card:focus-visible{border-color:var(--st-accent);outline:none;box-shadow:0 0 0 1px color-mix(in srgb, var(--st-accent) 40%, transparent)}',
			'.st-card[data-archived="true"]{opacity:.72;background:color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1))}',
			'.st-card[data-inherited="true"]{opacity:.45;border-style:dashed}',
			'.st-card[data-running="true"]{border-color:var(--dsw-alias-state-success-primary)}',
			'.st-card-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:6px;padding-right:16px}',
			'.st-card-turn{font-size:10px;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}',
			'.st-card-prompt{font-size:12px;line-height:16px;font-weight:500;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
			'.st-card-reply{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}',
			'.st-fork{position:absolute;top:5px;right:5px;width:20px;height:20px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:color-mix(in srgb, var(--st-accent) 14%, transparent);color:var(--st-accent);cursor:pointer;opacity:0;transition:opacity .12s}',
			'.st-card:hover .st-fork,.st-fork:focus-visible{opacity:1}',
			'.st-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:56px 24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}',
			'.st-empty-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:550}',
			'@keyframes st-flash{from{outline:2px solid var(--st-accent);outline-offset:3px}to{outline:2px solid transparent;outline-offset:3px}}',
			'[data-session-tree-flash]{animation:st-flash 1.5s ease-out}',
		].join('');
		const CSS_TAG_ID = '@lulaalu/dsh-session-tree/panel.css';

		function installStyles() {
			if (typeof document === 'undefined') return () => {};
			if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {};
			const tag = document.createElement('style');
			tag.dataset.plugin = '@lulaalu/dsh-session-tree';
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region locales
		const ZH = {
			'panel.title': '会话树',
			'page.title': '会话树',
			'page.subtitle': '每个会话一行，每一轮对话一个节点；分叉从被切出的那一轮连到新行。',
			'group.label': '工作区',
			'group.none': '未归属工作区',
			'toggle.inherited': '显示继承历史',
			'toggle.subagents': '显示子会话',
			'toggle.archived': '显示归档',
			'toggle.links': '回合连线',
			'toggle.separators': '行分隔',
			'toggle.outline': '清晰边框',
			'hint': '点击节点：打开会话并定位到该轮 · 悬停节点右上角：从这一轮分叉',
			'unit.sessions': '条会话',
			'unit.turns': '轮',
			'unit.forks': '个分叉',
			'row.forked': '从第 {turn} 轮分叉',
			'row.forkedEmpty': '已分叉，尚无新对话',
			'row.forkedHidden': '父会话不在视图 · 已显示继承历史',
			'row.forkedVia': '从第 {turn} 轮分叉 · 中间会话已隐藏',
			'row.inheritedFrom': '继承自「{title}」第 {turn} 轮',
			'row.forkedCompact': '从第 {turn} 轮分叉 · 父会话尚无新对话',
			'row.archived': '已归档',
			'row.noOwnTurns': '尚无新对话',
			'row.subagent': '子会话',
			'row.spawnedAt': '由第 {turn} 轮调用',
			'row.spawned': '由父会话调用',
			'row.forkedEmptyHidden': '已分叉 · 父会话不在当前视图',
			'node.subagents': '使用 {count} 个子会话',
			'node.fork': '从这一轮分叉',
			'node.open': '打开并定位到这一轮',
			'node.inherited': '继承自上游会话的第 {turn} 轮',
			'empty.title': '这个工作区还没有会话',
			'empty.hint': '开始一段对话后，它会出现在这里。',
			'empty.filtered': '当前筛选下没有会话',
			'error.fork': '分叉失败，请重试',
			'resize.label': '拖动调整会话列宽',
			'menu.open': '会话操作',
			'menu.rename': '重命名',
			'menu.pin': '置顶',
			'menu.unpin': '取消置顶',
			'menu.archive': '归档',
			'menu.unarchive': '取消归档',
			'menu.copyId': '复制会话 ID',
			'menu.forkSession': '分叉会话',
			'menu.copied': '已复制会话 ID',
			'settings.open': '外观设置',
			'settings.accent': '强调色',
			'settings.theme': '跟随主题',
			'settings.default': '默认蓝色',
			'settings.accentNote': '用于连线高亮、节点悬停边框、分叉按钮和开关。默认是 DeepSeek 蓝，也可以选择跟随当前主题的品牌色。',
			'dialog.rename.title': '重命名会话',
			'dialog.rename.placeholder': '输入会话名称',
			'dialog.archive.title': '会话仍在运行',
			'dialog.archive.text': '这个会话还有正在进行的任务（回合、子会话或后台任务）。归档需要先停止这些任务，是否继续？',
			'dialog.archive.confirm': '停止并归档',
			'dialog.save': '保存',
			'dialog.cancel': '取消',
			'dialog.close': '关闭',
			'error.renameEmpty': '名称不能为空',
			'error.action': '操作失败：{code}',
			'error.archiveActive': '会话仍在运行，请先停止再归档',
			'toggle.select': '选择节点',
			'toggle.selectHint': '选择连续节点后可以合并为一个显示节点（也可以按住 Ctrl 临时选择）',
			'toggle.selectTip': '按住 Ctrl 临时进入选择模式，松开退出；Ctrl+Shift 点击选择范围',
			'select.hint': '点击节点开始选择，Shift 点击选择范围',
			'select.autoHint': '按住 Ctrl：点击节点选择，Ctrl+Shift 点击选择范围',
			'select.count': '已选 {count} 个节点',
			'select.merge': '合并',
			'select.exit': '退出选择',
			'merge.title': '{count} 轮合并节点',
			'merge.count': '合并 {count} 轮',
			'merge.split': '拆分',
		};
		const EN = {
			'panel.title': 'Session Tree',
			'page.title': 'Session Tree',
			'page.subtitle': 'One lane per Session, one node per turn; a fork links the turn it was cut from to the new lane.',
			'group.label': 'Workspace',
			'group.none': 'No workspace',
			'toggle.inherited': 'Show inherited history',
			'toggle.subagents': 'Show sub-sessions',
			'toggle.archived': 'Show archived',
			'toggle.links': 'Turn links',
			'toggle.separators': 'Row separators',
			'toggle.outline': 'Strong outlines',
			'hint': 'Click a node: open the Session and jump to that turn · Hover the corner: fork from that turn',
			'unit.sessions': 'sessions',
			'unit.turns': 'turns',
			'unit.forks': 'forks',
			'row.forked': 'Forked from turn {turn}',
			'row.forkedEmpty': 'Forked, no new turns yet',
			'row.forkedHidden': 'Parent not in view · inherited history shown',
			'row.forkedVia': 'Forked from turn {turn} · intermediate Session hidden',
			'row.inheritedFrom': 'Inherited "{title}" through turn {turn}',
			'row.forkedCompact': 'Forked from turn {turn} · parent Session has no new turns',
			'row.archived': 'Archived',
			'row.noOwnTurns': 'no new turns',
			'row.subagent': 'Sub-session',
			'row.spawnedAt': 'Called from turn {turn}',
			'row.spawned': 'Called by parent Session',
			'row.forkedEmptyHidden': 'Forked · parent not in view',
			'node.subagents': 'Uses {count} sub-sessions',
			'node.fork': 'Fork from this turn',
			'node.open': 'Open and jump to this turn',
			'node.inherited': 'Inherited turn {turn} from an upstream Session',
			'empty.title': 'No sessions in this workspace yet',
			'empty.hint': 'Start a conversation and it will land here.',
			'empty.filtered': 'No sessions match the current filters',
			'error.fork': 'Fork failed, please retry',
			'resize.label': 'Drag to resize the session column',
			'menu.open': 'Session actions',
			'menu.rename': 'Rename',
			'menu.pin': 'Pin',
			'menu.unpin': 'Unpin',
			'menu.archive': 'Archive',
			'menu.unarchive': 'Unarchive',
			'menu.copyId': 'Copy Session ID',
			'menu.forkSession': 'Fork session',
			'menu.copied': 'Session ID copied',
			'settings.open': 'Appearance',
			'settings.accent': 'Accent color',
			'settings.theme': 'Use theme',
			'settings.default': 'Default blue',
			'settings.accentNote': 'Used for highlighted links, card hover outlines, fork buttons and toggles. Defaults to DeepSeek blue; "Use theme" follows the current theme brand color.',
			'dialog.rename.title': 'Rename session',
			'dialog.rename.placeholder': 'Session name',
			'dialog.archive.title': 'Session is still running',
			'dialog.archive.text': 'This session still has running work (a turn, sub-sessions, or background tasks). Archiving stops that work first. Continue?',
			'dialog.archive.confirm': 'Stop and archive',
			'dialog.save': 'Save',
			'dialog.cancel': 'Cancel',
			'dialog.close': 'Close',
			'error.renameEmpty': 'Name cannot be empty',
			'error.action': 'Action failed: {code}',
			'error.archiveActive': 'Session is still running; stop it before archiving',
			'toggle.select': 'Select nodes',
			'toggle.selectHint': 'Merge a contiguous range of turns into one displayed node (hold Ctrl for a temporary mode)',
			'toggle.selectTip': 'Hold Ctrl to enter select mode temporarily and release to leave; Ctrl+Shift-click selects a range',
			'select.hint': 'Click a node to start selecting; Shift-click to extend the range',
			'select.autoHint': 'Hold Ctrl: click nodes to select, Ctrl+Shift-click for a range',
			'select.count': '{count} nodes selected',
			'select.merge': 'Merge',
			'select.exit': 'Done',
			'merge.title': 'Merged node of {count} turns',
			'merge.count': '{count} turns merged',
			'merge.split': 'Split',
		};
		//#endregion

		//#region helpers
		const PAD = (n) => (n < 10 ? '0' + String(n) : String(n));

		function isZh() {
			try {
				return String((navigator && navigator.language) || '').toLowerCase().indexOf('zh') === 0;
			} catch (error) {
				return false;
			}
		}

		function normPath(value) {
			return String(value == null ? '' : value).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
		}

		function baseName(value) {
			const text = String(value == null ? '' : value).replace(/[\\/]+$/, '');
			const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
			return cut >= 0 ? text.slice(cut + 1) : text;
		}

		function turnsOf(session) {
			const values = session && session.projectionValues;
			const outline = values && values.turnOutline;
			return Array.isArray(outline) ? outline : [];
		}

		function formatWhen(ms, zh) {
			if (!ms) return '';
			const diff = Math.max(0, Date.now() - ms);
			if (diff < 60000) return zh ? '刚刚' : 'just now';
			if (diff < 3600000) {
				const minutes = Math.floor(diff / 60000);
				return zh ? minutes + ' 分钟前' : minutes + 'm ago';
			}
			if (diff < 86400000) {
				const hours = Math.floor(diff / 3600000);
				return zh ? hours + ' 小时前' : hours + 'h ago';
			}
			if (diff < 604800000) {
				const days = Math.floor(diff / 86400000);
				return zh ? days + ' 天前' : days + 'd ago';
			}
			const date = new Date(ms);
			return String(date.getFullYear()) + '-' + PAD(date.getMonth() + 1) + '-' + PAD(date.getDate());
		}

		function formatTemplate(template, values) {
			return String(template).replace(/\{(\w+)\}/g, (whole, key) => (values[key] == null ? whole : String(values[key])));
		}
		//#endregion

		//#region model
		function buildModel(sessionsState, workspacesState, options) {
			const ids = (sessionsState && sessionsState.ids) || [];
			const byId = (sessionsState && sessionsState.byId) || {};
			const items = (workspacesState && workspacesState.items) || [];
			const archived = new Set((workspacesState && workspacesState.archivedSessionIds) || []);
			const workspaceOfSession = new Map();
			for (const workspace of items) {
				for (const sessionId of workspace.sessionIds || []) {
					if (!workspaceOfSession.has(sessionId)) workspaceOfSession.set(sessionId, workspace);
				}
			}
			const groups = new Map();
			const groupFor = (key) => {
				let group = groups.get(key);
				if (group === undefined) {
					group = { key: key, title: '', path: '', latest: 0, sessions: [] };
					groups.set(key, group);
				}
				return group;
			};
			for (const sessionId of ids) {
				const session = byId[sessionId];
				if (session === undefined) continue;
				if (session.blank) continue;
				if (!options.showArchived && archived.has(sessionId)) continue;
				let workspace = workspaceOfSession.get(sessionId);
				if (workspace === undefined && session.cwd) {
					for (const candidate of items) {
						if (candidate.path && normPath(candidate.path) === normPath(session.cwd)) {
							workspace = candidate;
							break;
						}
					}
				}
				let group;
				if (workspace !== undefined) {
					group = groupFor('ws:' + workspace.workspaceId);
					if (group.title === '') group.title = workspace.title || baseName(workspace.path) || String(workspace.workspaceId);
					if (group.path === '') group.path = workspace.path || '';
				} else if (session.cwd) {
					group = groupFor('cwd:' + normPath(session.cwd));
					if (group.title === '') group.title = baseName(session.cwd) || session.cwd;
					if (group.path === '') group.path = session.cwd;
				} else {
					group = groupFor('ws:none');
				}
				group.sessions.push(session);
				group.latest = Math.max(group.latest, session.updatedAt || 0);
			}
			const list = [];
			for (const group of groups.values()) list.push(group);
			list.sort((left, right) => right.latest - left.latest);
			const byKey = new Map();
			for (const group of list) byKey.set(group.key, group);
			return { groups: list, byKey: byKey };
		}

		function layoutGroup(group, options, allById) {
			const byId = new Map();
			for (const session of group.sessions) byId.set(session.id, session);
			const known = allById === undefined || allById === null ? byId : allById;
			const knownOf = (id) => {
				if (known === undefined || known === null) return undefined;
				if (typeof known.get === 'function') return known.get(id);
				return known[id];
			};
			/** Length of the leading turn-run two Session logs share, by inherited event seq. */
			const sameTurn = (left, right) => {
				if (left === undefined || right === undefined) return false;
				if (left.seq !== right.seq) return false;
				if (String(left.prompt || '') !== String(right.prompt || '')) return false;
				return String(left.response || '') === String(right.response || '');
			};
			const sharedPrefix = (left, right) => {
				if (right === undefined) return 0;
				const leftTurns = turnsOf(left);
				const rightTurns = turnsOf(right);
				let shared = 0;
				while (shared < leftTurns.length && shared < rightTurns.length && sameTurn(leftTurns[shared], rightTurns[shared])) shared += 1;
				return shared;
			};
			/** Exact fork facts fetched from the Host: inherited event count and creation time. */
			const exactInfoOf = (session) => {
				const table = options.exact;
				if (table === undefined || table === null) return undefined;
				const value = table[session.id];
				if (typeof value === 'number' && Number.isFinite(value)) return { inherited: value, createdAt: undefined };
				if (value !== null && typeof value === 'object' && typeof value.inherited === 'number' && Number.isFinite(value.inherited)) {
					return {
						inherited: value.inherited,
						createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : undefined,
					};
				}
				return undefined;
			};
			const createdAtOf = (session) => {
				const info = exactInfoOf(session);
				if (info !== undefined && info.createdAt !== undefined) return info.createdAt;
				return typeof session.createdAt === 'number' && Number.isFinite(session.createdAt) ? session.createdAt : undefined;
			};
			const inheritedTurnsOf = (session) => {
				const info = exactInfoOf(session);
				if (info === undefined) return undefined;
				const turns = turnsOf(session);
				let count = 0;
				while (count < turns.length && turns[count].seq < info.inherited) count += 1;
				return count;
			};
			/**
			 * Since DSH 0.2.2 an ordinary fork records no `parentSession`: the child keeps
			 * the parent's exact event prefix but no lineage. The source is the Session
			 * whose leading turns are that inherited prefix. Ranking prefers a candidate
			 * that ends exactly at the cut, then the shortest matching history, then the
			 * most recently created one: the fork chain should read as the nearest source.
			 *
			 * Hidden ancestors (archived, or blank forks the list filters out) need the same
			 * resolution, so inference walks the parent chain as well instead of stopping at
			 * the first filtered row; that is what lets a visible child re-attach to the
			 * nearest ancestor that actually renders cards.
			 */
			const inferredParentId = new Map();
			{
				let pool;
				const seenPool = new Set();
				const candidatePool = () => {
					if (pool !== undefined) return pool;
					pool = [];
					for (const session of group.sessions) {
						if (seenPool.has(session.id)) continue;
						seenPool.add(session.id);
						pool.push(session);
					}
					if (known !== undefined && known !== null) {
						const all = typeof known.values === 'function' ? [...known.values()] : Object.keys(known).map((id) => known[id]);
						for (const session of all) {
							if (session === undefined || session === null || seenPool.has(session.id)) continue;
							seenPool.add(session.id);
							pool.push(session);
						}
					}
					return pool;
				};
				const resolved = new Map();
				const inferParent = (child) => {
					if (resolved.has(child.id)) return resolved.get(child.id);
					resolved.set(child.id, undefined);
					const explicitParent = child.parentId;
					if (explicitParent !== undefined && explicitParent !== null && explicitParent !== '') return undefined;
					if (child.origin === 'subagent') return undefined;
					const info = exactInfoOf(child);
					if (info === undefined || info.inherited <= 0) return undefined;
					const k = inheritedTurnsOf(child);
					if (k === undefined || k <= 0) return undefined;
					const childTurns = turnsOf(child);
					const childCreated = createdAtOf(child);
					if (childCreated === undefined) return undefined;
					const childCwd = normPath(child.cwd || '');
					let best;
					let bestRank;
					for (const candidate of candidatePool()) {
						if (candidate.id === child.id || candidate.origin === 'subagent') continue;
						if (childCwd !== '' && normPath(candidate.cwd || '') !== childCwd) continue;
						const candidateTurns = turnsOf(candidate);
						if (candidateTurns.length < k) continue;
						const candidateCreated = createdAtOf(candidate);
						if (candidateCreated === undefined || candidateCreated >= childCreated) continue;
						let matches = true;
						for (let index = 0; index < k; index += 1) {
							if (!sameTurn(candidateTurns[index], childTurns[index])) {
								matches = false;
								break;
							}
						}
						if (!matches) continue;
						const forkLike = candidateTurns.length === k || Number(candidateTurns[k].seq) > info.inherited - 1;
						const rank = [forkLike ? 0 : 1, candidateTurns.length, -candidateCreated];
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
					if (parentId !== undefined) inferredParentId.set(child.id, parentId);
					return parentId;
				};
				const queue = group.sessions.slice();
				const processed = new Set();
				while (queue.length > 0 && processed.size < 500) {
					const child = queue.shift();
					if (child === undefined || processed.has(child.id)) continue;
					processed.add(child.id);
					const parentId = inferParent(child);
					if (parentId === undefined) continue;
					const parent = knownOf(parentId);
					if (parent !== undefined && !processed.has(parent.id)) queue.push(parent);
				}
			}
			/** Parent id for lineage purposes: the recorded one, else the inferred fork source. */
			const parentIdOf = (session) => {
				const inferred = inferredParentId.get(session.id);
				if (inferred !== undefined) return inferred;
				const explicit = session.parentId;
				return explicit === undefined || explicit === null || explicit === '' ? undefined : explicit;
			};
			/** Nearest ancestor that this view actually renders, skipping filtered-out Sessions. */
			const visibleAncestorOf = (session) => {
				let cursor = parentIdOf(session);
				const guard = new Set();
				let hops = 0;
				while (cursor !== undefined && cursor !== null && !guard.has(cursor) && hops < 200) {
					guard.add(cursor);
					hops += 1;
					const candidate = byId.get(cursor);
					if (candidate !== undefined) return candidate;
					const lineage = knownOf(cursor);
					if (lineage === undefined) return undefined;
					cursor = parentIdOf(lineage);
				}
				return undefined;
			};
			/**
			 * Whether a Session renders turn cards at all. A fork whose inherited prefix
			 * covers its whole log collapses into a slim row, so it can be neither a fork
			 * edge origin nor the anchor of a child's inherited history.
			 */
			const rendersCards = (session) => {
				const turns = turnsOf(session);
				if (turns.length === 0) return false;
				const exact = inheritedTurnsOf(session);
				if (exact !== undefined) return turns.length > exact;
				return true;
			};
			/**
			 * Nearest visible ancestor that renders cards, so a fork cut through an archived
			 * or fully-inherited ancestor still connects to a row that actually shows the
			 * fork turn instead of leaving the child's own turns floating.
			 */
			const cardAncestorOf = (session) => {
				let cursor = parentIdOf(session);
				const guard = new Set();
				let hops = 0;
				while (cursor !== undefined && cursor !== null && !guard.has(cursor) && hops < 200) {
					guard.add(cursor);
					hops += 1;
					const candidate = byId.get(cursor);
					if (candidate !== undefined) {
						if (candidate.origin === 'subagent' || rendersCards(candidate)) return candidate;
						cursor = parentIdOf(candidate);
						continue;
					}
					const lineage = knownOf(cursor);
					if (lineage === undefined) return undefined;
					cursor = parentIdOf(lineage);
				}
				return undefined;
			};

			const parentOf = new Map();
			const children = new Map();
			const roots = [];
			for (const session of group.sessions) {
				const nearest = visibleAncestorOf(session);
				// Ordinary Sessions prefer a card-bearing anchor; sub-agent chains keep the
				// nearest visible row because their mini nodes are the chain itself.
				const anchor = session.origin === 'subagent' ? undefined : cardAncestorOf(session);
				const ancestor = anchor !== undefined ? anchor : nearest;
				parentOf.set(session.id, ancestor);
				if (ancestor !== undefined) {
					let list = children.get(ancestor.id);
					if (list === undefined) {
						list = [];
						children.set(ancestor.id, list);
					}
					list.push(session);
				} else {
					roots.push(session);
				}
			}
			roots.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
			for (const list of children.values()) {
				list.sort((left, right) => {
					const leftSub = left.origin === 'subagent' ? 1 : 0;
					const rightSub = right.origin === 'subagent' ? 1 : 0;
					if (leftSub !== rightSub) return leftSub - rightSub;
					return (left.updatedAt || 0) - (right.updatedAt || 0);
				});
			}

			const rows = [];
			const rowBySession = new Map();
			const seen = new Set();
			const mergeTable = options.merges === undefined || options.merges === null ? {} : options.merges;
			const rangesOf = (sessionId) => {
				const ranges = mergeTable[sessionId];
				return Array.isArray(ranges) ? ranges : [];
			};
			/**
			 * Map turn indices to visual columns. A merged range collapses into one column
			 * and every later turn shifts left, so merging really frees horizontal space
			 * instead of just drawing a wider block.
			 */
			const buildColumns = (turns, ranges) => {
				const count = turns.length;
				const cols = new Array(count);
				for (let index = 0; index < count; index += 1) cols[index] = index;
				if (ranges.length === 0 || count === 0) return cols;
				const sorted = ranges
					.filter((range) => Array.isArray(range) && range[0] < range[1])
					.slice()
					.sort((left, right) => left[0] - right[0]);
				let cursor = 0;
				let shift = 0;
				for (const range of sorted) {
					const start = Math.max(0, range[0]);
					const end = Math.min(count - 1, range[1]);
					if (end < start) continue;
					while (cursor < start && cursor < count) {
						cols[cursor] = cursor - shift;
						cursor += 1;
					}
					if (cursor < start) continue;
					const column = start - shift;
					while (cursor <= end && cursor < count) {
						cols[cursor] = column;
						cursor += 1;
					}
					shift += end - start;
				}
				while (cursor < count) {
					cols[cursor] = cursor - shift;
					cursor += 1;
				}
				return cols;
			};
			// Exact prefix lengths come from the Host route (`inheritedEventCount`). Without
			// them, fall back to aligning turn content against the parent, because raw seqs
			// are only unique inside one Session log: a child's own first turn can reuse the
			// same seq number as the parent's next turn and be mistaken for an inherited one.
			const exactTurnsOf = (session) => inheritedTurnsOf(session);
			const walk = (session, depth) => {
				if (seen.has(session.id)) return;
				seen.add(session.id);
				const turns = turnsOf(session);
				const resolvedParentId = parentIdOf(session);
				const directParent = resolvedParentId !== undefined && resolvedParentId !== session.id ? knownOf(resolvedParentId) : undefined;
				const effectiveParent = parentOf.get(session.id);
				const exactInherited = exactTurnsOf(session);
				const directInherited = exactInherited === undefined ? sharedPrefix(session, directParent) : exactInherited;
				// Align to the anchor row, not blindly to the exact prefix: with a hidden or
				// compact intermediate fork the anchor may share fewer turns than the child's
				// own inherited prefix, and the extra ones must stay visible as faded turns.
				const anchorPrefix = effectiveParent === undefined ? 0 : sharedPrefix(session, effectiveParent);
				const anchorHasTurns = effectiveParent !== undefined && turnsOf(effectiveParent).length > 0;
				const effectiveInherited = exactInherited === undefined
					? anchorPrefix
					: (effectiveParent === undefined ? 0 : (anchorHasTurns ? Math.min(exactInherited, anchorPrefix) : exactInherited));
				const inherited = exactInherited === undefined ? Math.max(directInherited, effectiveInherited) : exactInherited;
				const rowCols = buildColumns(turns, rangesOf(session.id));
				const parentRowForOffset = effectiveParent === undefined ? undefined : rowBySession.get(effectiveParent.id);
				const isSubagent = session.origin === 'subagent';
				// A card-bearing anchor is what a fork edge can connect to. When the cut runs
				// through a hidden (archived) or fully-inherited (compact) ancestor, the edge
				// must originate from the nearest row that actually renders cards.
				const anchorRendersCards = parentRowForOffset !== undefined
					&& parentRowForOffset.mini !== true
					&& parentRowForOffset.visibleTo >= parentRowForOffset.visibleFrom;
				const hiddenGap = effectiveParent !== undefined && resolvedParentId !== undefined && effectiveParent.id !== resolvedParentId;
				const directParentVisible = resolvedParentId !== undefined && byId.has(resolvedParentId);
				const directParentTurns = directParent === undefined ? [] : turnsOf(directParent);
				// A "compact parent" is a visible fork that inherited its whole log and never
				// continued: it renders no cards, so the child shows the fork-point turn itself.
				const compactParent = hiddenGap && directParentVisible && directParentTurns.length > 0 && rendersCards(directParent) === false;
				if (isSubagent && options.showSubagents !== true) {
					// Collapsed: a sub-agent is not a lane of its own. Record it on the turn
					// that spawned it so the parent node can show a short marker instead.
					if (parentRowForOffset !== undefined) {
						if (parentRowForOffset.mini === true) {
							parentRowForOffset.spawnDeep = (parentRowForOffset.spawnDeep === undefined ? 0 : parentRowForOffset.spawnDeep) + 1;
						} else {
							const spawnIndex = effectiveInherited > 0 ? effectiveInherited - 1 : parentRowForOffset.visibleTo;
							const clamped = Math.min(Math.max(spawnIndex, parentRowForOffset.visibleFrom), parentRowForOffset.visibleTo);
							if (parentRowForOffset.spawns === undefined) parentRowForOffset.spawns = new Map();
							parentRowForOffset.spawns.set(clamped, (parentRowForOffset.spawns.get(clamped) === undefined ? 0 : parentRowForOffset.spawns.get(clamped)) + 1);
						}
					}
					return;
				}
				if (isSubagent) {
					// Expanded: one slim chain link per sub-agent, aligned under the node of
					// the parent turn that started it.
					const spawnIndex = parentRowForOffset === undefined
						? 0
						: (effectiveInherited > 0
							? effectiveInherited - 1
							: parentRowForOffset.visibleTo);
					const spawnColAbs = parentRowForOffset === undefined
						? 0
						: (parentRowForOffset.mini === true
							? parentRowForOffset.spawnColAbs
							: rowColumnOf(parentRowForOffset, Math.min(Math.max(spawnIndex, parentRowForOffset.visibleFrom), parentRowForOffset.visibleTo)));
					const miniRow = {
						session: session,
						depth: depth,
						turns: turns,
						parent: effectiveParent,
						directParent: directParent,
						inherited: inherited,
						hiddenGap: false,
						forkCol: -1,
						visibleFrom: 0,
						visibleTo: turns.length - 1,
						colOffset: 0,
						spawnColAbs: spawnColAbs,
						mini: true,
						parentRowIndex: -1,
						subagent: true,
						archived: options.archived !== undefined && options.archived !== null && options.archived.has(session.id),
					};
					rows.push(miniRow);
					rowBySession.set(session.id, miniRow);
					const miniKids = children.get(session.id);
					if (miniKids !== undefined) for (const kid of miniKids) walk(kid, depth + 1);
					return;
				}
				const freshSpawn = false;
				const inheritedCount = Math.min(effectiveInherited, turns.length);
				let colOffset = 0;
				if (parentRowForOffset !== undefined) {
					if (parentRowForOffset.mini === true) {
						const anchorIndex = Math.max(0, inheritedCount - 1);
						colOffset = parentRowForOffset.spawnColAbs - (rowCols[anchorIndex] === undefined ? 0 : rowCols[anchorIndex]);
					} else if (inheritedCount > 0) {
						const parentCol = rowColumnOf(parentRowForOffset, Math.min(inheritedCount - 1, parentRowForOffset.turns.length - 1));
						const ownCol = rowCols[inheritedCount - 1] === undefined ? 0 : rowCols[inheritedCount - 1];
						colOffset = parentCol - ownCol;
					} else {
						colOffset = parentRowForOffset.colOffset;
					}
				}
				// Default view hides inherited history. Rules:
				// - a card-bearing anchor: align to it; on a hidden/compact gap also show the
				//   fork-point turn faded so the branch never starts floating;
				// - no card-bearing anchor (all ancestors archived or absorbed): show the whole
				//   inherited prefix faded instead of dangling the first own turn.
				let visibleFrom;
				if (options.showInherited) visibleFrom = 0;
				else if (!anchorRendersCards) visibleFrom = 0;
				else if (hiddenGap) visibleFrom = Math.max(0, Math.min(effectiveInherited, inherited) - 1);
				else visibleFrom = effectiveInherited;
				// Never let a shifted row start left of column 0 (possible when the parent
				// compacted columns and this row shows its inherited prefix as well).
				const firstRelative = rowCols[visibleFrom] === undefined ? visibleFrom : rowCols[visibleFrom];
				if (colOffset + firstRelative < 0) colOffset = -firstRelative;
				const parentHiddenTitle = hiddenGap && !directParentVisible && directParent !== undefined
					? String(directParent.title || directParent.displayTitle || String(directParent.id).slice(0, 8))
					: '';
				const row = {
					session: session,
					depth: depth,
					turns: turns,
					parent: effectiveParent,
					directParent: directParent,
					inherited: inherited,
					hiddenGap: hiddenGap,
					compactParent: compactParent,
					parentHiddenTitle: parentHiddenTitle,
					forkCol: effectiveParent === undefined ? -1 : effectiveInherited - 1,
					visibleFrom: visibleFrom,
					visibleTo: turns.length - 1,
					colOffset: colOffset,
					colOf: rowCols,
					freshSpawn: freshSpawn,
					parentRowIndex: -1,
					subagent: false,
					archived: options.archived !== undefined && options.archived !== null && options.archived.has(session.id),
				};
				rows.push(row);
				rowBySession.set(session.id, row);
				const kids = children.get(session.id);
				if (kids !== undefined) for (const kid of kids) walk(kid, depth + 1);
			};
			for (const root of roots) walk(root, 0);
			for (const session of group.sessions) if (!seen.has(session.id)) walk(session, 0);

			const rowIndexOf = new Map();
			for (let index = 0; index < rows.length; index += 1) rowIndexOf.set(rows[index].session.id, index);
			for (const row of rows) {
				row.parentRowIndex = row.parent === undefined ? -1 : (rowIndexOf.has(row.parent.id) ? rowIndexOf.get(row.parent.id) : -1);
			}

			// A row whose every turn is inherited has no node of its own: collapse it to a
			// slim row so forks that were never continued stop wasting vertical space.
			// Sub-agent rows are always slim and carry exactly one chained mini node.
			const rowHasMerge = (row) => {
				if (row.mini === true || row.visibleTo < row.visibleFrom) return false;
				const ranges = mergeTable[row.session.id];
				if (!Array.isArray(ranges)) return false;
				for (const range of ranges) {
					if (range[1] < row.visibleFrom || range[0] > row.visibleTo) continue;
					return true;
				}
				return false;
			};
			let cursorTop = 0;
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				row.compact = row.mini === true ? false : row.visibleTo < row.visibleFrom;
				row.mergeRow = rowHasMerge(row);
				const baseHeight = row.mini === true ? MINI_ROW_H : (row.compact ? COMPACT_ROW_H : ROW_H);
				row.height = row.mergeRow ? baseHeight + MERGE_ROW_EXTRA : baseHeight;
				row.cardTop = row.mini === true ? MINI_TOP : (row.height - CARD_H) / 2;
				row.mergedTop = (row.height - MERGE_CARD_H) / 2;
				row.top = cursorTop;
				row.fromAbs = row.mini === true ? row.spawnColAbs : rowColumnOf(row, row.visibleFrom);
				row.toAbs = row.mini === true ? row.spawnColAbs : rowColumnOf(row, Math.max(row.visibleFrom, row.visibleTo));
				cursorTop += row.height + ROW_GAP;
			}
			const gridHeight = rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height;

			let maxCols = 0;
			let turnCount = 0;
			let forkCount = 0;
			for (const row of rows) {
				turnCount += row.mini === true ? 0 : row.turns.length;
				if (row.mini !== true && (row.inherited > 0 || row.parent !== undefined)) forkCount += 1;
				const high = Math.max(row.fromAbs, row.toAbs);
				if (high >= 0) maxCols = Math.max(maxCols, high + 1);
			}

			const edges = [];
			const chainTail = new Map();
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				if (row.mini === true) {
					if (row.parentRowIndex < 0) continue;
					const key = row.parentRowIndex + ':' + row.spawnColAbs;
					const previous = chainTail.get(key);
					if (previous === undefined && rows[row.parentRowIndex].compact === true) continue;
					chainTail.set(key, index);
					edges.push({
						fromRow: previous === undefined ? row.parentRowIndex : previous,
						fromCol: row.spawnColAbs,
						toRow: index,
						toCol: row.spawnColAbs,
						kind: 'spawn',
						ring: previous === undefined,
						gap: false,
					});
					continue;
				}
				if (row.parent === undefined || row.parentRowIndex < 0) continue;
				if (row.compact) continue;
				const parentRow = rows[row.parentRowIndex];
				if (parentRow.compact) continue;
				if (row.forkCol < 0) continue;
				const toIndex = options.showInherited && row.forkCol >= 0 ? row.forkCol : row.visibleFrom;
				if (toIndex < 0) continue;
				const parentForkIndex = Math.min(Math.max(row.forkCol, parentRow.visibleFrom), parentRow.visibleTo);
				const fromCol = rowColumnOf(parentRow, parentForkIndex);
				edges.push({
					fromRow: row.parentRowIndex,
					fromCol: fromCol,
					toRow: index,
					toCol: rowColumnOf(row, toIndex),
					gap: row.hiddenGap,
					kind: 'fork',
				});
			}

			// A fork whose child sits more than one row lower would otherwise run its
			// vertical through the rows in between and cross their cards. Route those
			// long forks down the gutter between columns instead, in stacked lanes so
			// two of them never share a line.
			const laneBands = new Map();
			for (const edge of edges) {
				edge.long = edge.toRow > edge.fromRow + 1;
				edge.lane = 0;
				if (!edge.long) continue;
				const top = rowNodeBottom(rows[edge.fromRow]);
				const bottom = rowNodeTop(rows[edge.toRow]);
				let bands = laneBands.get(edge.fromCol);
				if (bands === undefined) {
					bands = [];
					laneBands.set(edge.fromCol, bands);
				}
				let lane = 0;
				while (bands.some((band) => band.lane === lane && band.top < bottom && band.bottom > top)) lane += 1;
				bands.push({ lane: lane, top: top, bottom: bottom });
				edge.lane = lane;
			}

			const trackWidth = TRACK_INSET + maxCols * STEP + COL_W + CONTENT_PAD_RIGHT;
			return {
				rows: rows,
				edges: edges,
				separators: rows.slice(0, -1).map((row) => row.top + row.height + ROW_GAP / 2),
				maxCols: maxCols,
				trackWidth: trackWidth,
				gridHeight: gridHeight,
				sessions: rows.length,
				turns: turnCount,
				forks: forkCount,
			};
		}
		//#endregion

		//#region components
		const ICON_PATHS = {
			pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
			edit: ['M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z', 'm15 5 4 4'],
			branch: ['M6 3v12', 'M18 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6', 'M6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6', 'M18 9a9 9 0 0 1-9 9'],
			archive: ['M3 4h18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
			unarchive: ['M3 4h18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M12 21v-8', 'm9 16 3-3 3 3'],
			copy: ['M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
			settings: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M9 6a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 1 0 3.2 0', 'M15 12a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 1 0 3.2 0', 'M11 18a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 1 0 3.2 0'],
		};

		function Icon(props) {
			const paths = ICON_PATHS[props.name] === undefined ? [] : ICON_PATHS[props.name];
			const size = props.size === undefined ? 14 : props.size;
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: props.strokeWidth === undefined ? 1.8 : props.strokeWidth,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
					focusable: false,
				},
				paths.map((d, index) => h('path', { key: 'p' + index, d: d })),
			);
		}

		function ForkGlyph() {
			return h(
				'svg',
				{ viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true, focusable: false },
				h('path', { d: 'M4 3v5a3 3 0 0 0 3 3h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
				h('path', { d: 'M8.6 8.4 11.2 11 8.6 13.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
				h('circle', { cx: 4, cy: 3, r: 1.5, fill: 'currentColor' }),
			);
		}

		function TreePanelIcon(props) {
			const size = props && props.size ? props.size : 18;
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: false },
				h('path', { d: 'M7 4v16', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
				h('path', { d: 'M7 12h6.5a2.5 2.5 0 0 1 2.5 2.5V18', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
				h('circle', { cx: 7, cy: 4, r: 2, fill: 'currentColor' }),
				h('circle', { cx: 7, cy: 12, r: 2, fill: 'currentColor' }),
				h('circle', { cx: 7, cy: 20, r: 2, fill: 'currentColor' }),
				h('circle', { cx: 16, cy: 20, r: 2, fill: 'currentColor' }),
			);
		}

		function Toggle(props) {
			const hasTip = props.tip !== undefined && props.tip !== null && props.tip !== '';
			const attrs = {
				type: 'button',
				className: 'st-toggle',
				'data-on': props.on ? 'true' : 'false',
				'aria-pressed': props.on ? 'true' : 'false',
				onClick: props.onToggle,
				// A custom tooltip replaces the native one so the hint is not shown twice.
				title: hasTip ? undefined : (props.hint || props.label),
			};
			if (hasTip) attrs['data-tip'] = props.tip;
			return h(
				'button',
				attrs,
				props.on ? h('span', { className: 'st-toggle-dot', 'aria-hidden': true }) : null,
				props.label,
			);
		}

		function TurnCard(props) {
			const turn = props.turn;
			const turnNumber = turn.turn;
			const prompt = String(turn.prompt || '').trim();
			const response = String(turn.response || '').trim();
			const openLabel = formatTemplate(props.tr('node.open'), { turn: turnNumber });
			const title = (prompt || '#' + turnNumber) + (response ? '\n\n' + response : '');
			const left = TRACK_INSET + props.col * STEP;
			const top = props.top === undefined ? CARD_TOP : props.top;
			const spawnCount = props.spawnCount === undefined ? 0 : props.spawnCount;
			return h(
				'div',
				{
					className: 'st-card',
					role: 'button',
					tabIndex: 0,
					'data-inherited': props.inherited ? 'true' : 'false',
					'data-running': props.running ? 'true' : 'false',
					'data-archived': props.archived ? 'true' : 'false',
					'data-selected': props.selected ? 'true' : 'false',
					'data-selectable': props.selectable ? 'true' : 'false',
					style: { left: left + 'px', top: top + 'px' },
					title: title,
					'aria-label': openLabel,
					onClick: props.onActivate,
					onKeyDown: (event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							props.onActivate(event);
						}
					},
				},
				h(
					'div',
					{ className: 'st-card-head' },
					h('span', { className: 'st-card-turn' }, '#' + turnNumber),
				),
				h('div', { className: 'st-card-prompt' }, prompt || '…'),
				response ? h('div', { className: 'st-card-reply' }, response) : null,
				props.inherited || props.selectable
					? null
					: h(
						'button',
						{
							className: 'st-fork',
							type: 'button',
							title: formatTemplate(props.tr('node.fork'), { turn: turnNumber }),
							'aria-label': formatTemplate(props.tr('node.fork'), { turn: turnNumber }),
							onClick: (event) => {
								event.stopPropagation();
								props.onFork();
							},
						},
						h(ForkGlyph),
					),
				spawnCount > 0
					? h(
						'span',
						{
							className: 'st-card-spawn',
							key: 'spawn-badge',
							title: formatTemplate(props.tr('node.subagents'), { count: spawnCount }),
							'aria-label': formatTemplate(props.tr('node.subagents'), { count: spawnCount }),
						},
						h(Icon, { name: 'branch', size: 11 }),
						h('span', { className: 'st-card-spawn-count' }, String(spawnCount)),
					)
					: null,
			);
		}

		function MergedCard(props) {
			const turns = props.turns;
			const count = props.to - props.from + 1;
			const first = turns[0];
			const last = turns[turns.length - 1];
			const prompt = String((first && first.prompt) || '').trim();
			const response = String((last && last.response) || '').trim();
			const left = TRACK_INSET + props.col * STEP - MERGE_W_BLEED;
			const width = COL_W + MERGE_W_EXTRA;
			const top = props.top === undefined ? CARD_TOP : props.top;
			const height = props.height === undefined ? MERGE_CARD_H : props.height;
			const title = turns.map((turn) => '#' + turn.turn + ': ' + String(turn.prompt || '').trim()).join('\n');
			const label = formatTemplate(props.tr('merge.title'), { count: count });
			return h(
				'div',
				{
					className: 'st-card st-merge',
					role: 'button',
					tabIndex: 0,
					'data-inherited': props.inherited ? 'true' : 'false',
					'data-archived': props.archived ? 'true' : 'false',
					'data-selected': props.selected ? 'true' : 'false',
					'data-selectable': props.selectable ? 'true' : 'false',
					style: { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' },
					title: title,
					'aria-label': label,
					onClick: (event) => props.onActivate(event),
					onKeyDown: (event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							props.onActivate(event);
						}
					},
				},
				h(
					'div',
					{ className: 'st-card-head' },
					h('span', { className: 'st-card-turn' }, '#' + first.turn + '–#' + last.turn),
					h('span', { className: 'st-merge-count' }, formatTemplate(props.tr('merge.count'), { count: count })),
				),
				h('div', { className: 'st-card-prompt' }, prompt || '…'),
				response === '' ? null : h('div', { className: 'st-card-reply' }, response),
				props.selectable
					? null
					: h(
						'button',
						{
							className: 'st-merge-split',
							type: 'button',
							title: props.tr('merge.split'),
							'aria-label': props.tr('merge.split'),
							onClick: (event) => {
								event.stopPropagation();
								props.onSplit();
							},
						},
						props.tr('merge.split'),
					),
			);
		}

		function EdgeLayer(props) {
			const rows = props.rows;
			const spans = props.spans;
			const paths = [];
			const spanAt = (rowIndex, col) => {
				const rowSpans = spans === undefined ? undefined : spans[rowIndex];
				if (rowSpans === undefined) return undefined;
				for (const span of rowSpans) {
					if (col >= span.from && col <= span.to) return span;
				}
				return undefined;
			};
			const anchorBottom = (rowIndex, col) => {
				const span = spanAt(rowIndex, col);
				return span === undefined ? rowNodeBottom(rows[rowIndex]) : span.bottom;
			};
			const anchorTop = (rowIndex, col) => {
				const span = spanAt(rowIndex, col);
				return span === undefined ? rowNodeTop(rows[rowIndex]) : span.top;
			};
			if (props.links !== false) {
				for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
					const row = rows[rowIndex];
					if (row.mini === true) continue;
					if (row.visibleTo <= row.visibleFrom) continue;
					const y = row.top + row.height / 2;
					const rowSpans = spans === undefined ? undefined : spans[rowIndex];
					if (rowSpans !== undefined) {
						for (let spanIndex = 0; spanIndex + 1 < rowSpans.length; spanIndex += 1) {
							const leftSpan = rowSpans[spanIndex];
							const rightSpan = rowSpans[spanIndex + 1];
							const x1 = leftSpan.right - 3;
							const x2 = rightSpan.left + 3;
							paths.push(h('path', {
								key: 'link-' + rowIndex + '-span-' + spanIndex,
								className: 'st-link',
								d: 'M' + x1 + ' ' + y + 'L' + x2 + ' ' + y,
							}));
						}
						continue;
					}
				}
			}
			for (let index = 0; index < props.edges.length; index += 1) {
				const edge = props.edges[index];
				const y1 = anchorBottom(edge.fromRow, edge.fromCol);
				const y2 = anchorTop(edge.toRow, edge.toCol);
				let d;
				if (edge.long === true) {
					const startX = TRACK_INSET + edge.fromCol * STEP + COL_W / 2;
					const gutterX = TRACK_INSET + edge.fromCol * STEP + COL_W + COL_GAP / 2 + (edge.lane % 3) * 6;
					const endX = TRACK_INSET + edge.toCol * STEP + COL_W / 2;
					const dropY = y1 + 4;
					const approachY = y2 - 10;
					d = 'M' + startX + ' ' + y1
						+ 'L' + startX + ' ' + dropY
						+ 'L' + gutterX + ' ' + dropY
						+ 'L' + gutterX + ' ' + approachY
						+ 'L' + endX + ' ' + approachY
						+ 'L' + endX + ' ' + y2;
				} else {
					const x1 = TRACK_INSET + edge.fromCol * STEP + COL_W / 2;
					const x2 = TRACK_INSET + edge.toCol * STEP + COL_W / 2;
					if (Math.abs(x1 - x2) < 1) {
						d = 'M' + x1 + ' ' + y1 + 'L' + x1 + ' ' + y2;
					} else {
						const mid = Math.max(y1 + 10, y2 - 20);
						d = 'M' + x1 + ' ' + y1 + 'L' + x1 + ' ' + mid + 'L' + x2 + ' ' + mid + 'L' + x2 + ' ' + y2;
					}
				}
				paths.push(h('path', {
					key: 'edge-' + index,
					className: edge.kind === 'spawn'
						? 'st-edge st-edge-spawn'
						: (edge.gap ? 'st-edge st-edge-gap' : 'st-edge'),
					d: d,
				}));
				if (edge.kind === 'spawn' && edge.ring !== false) {
					const anchorX = TRACK_INSET + edge.fromCol * STEP + COL_W / 2;
					const anchorY = anchorBottom(edge.fromRow, edge.fromCol);
					paths.push(h('circle', {
						key: 'spawn-' + index,
						className: 'st-spawn-dot',
						cx: anchorX,
						cy: anchorY,
						r: 2.4,
					}));
				}
			}
			if (props.separators === true) {
				const bars = props.separatorY === undefined ? [] : props.separatorY;
				for (let index = 0; index < bars.length; index += 1) {
					const y = bars[index];
					paths.push(h('path', {
						key: 'rowsep-' + index,
						className: 'st-sep-line',
						d: 'M0 ' + y + 'L' + props.width + ' ' + y,
					}));
				}
			}
			return h(
				'svg',
				{
					className: 'st-edges',
					width: props.width,
					height: props.height,
					style: { left: 'var(--st-label-w)' },
					'aria-hidden': true,
					focusable: false,
				},
				paths,
			);
		}

		function SessionDialog(props) {
			const dialog = props.dialog;
			const isRename = dialog.kind === 'rename';
			const [draft, setDraft] = useState(isRename ? String(dialog.title || '') : '');
			const [note, setNote] = useState('');
			const [busy, setBusy] = useState(false);
			const submit = async () => {
				if (busy) return;
				if (isRename) {
					const title = draft.trim();
					if (title === '') {
						setNote(props.tr('error.renameEmpty'));
						return;
					}
					setBusy(true);
					const failure = await props.onSubmit(title);
					setBusy(false);
					if (failure === null) props.onClose();
					else setNote(failure);
					return;
				}
				setBusy(true);
				const failure = await props.onSubmit();
				setBusy(false);
				if (failure === null) props.onClose();
				else setNote(failure);
			};
			return h(
				'div',
				{
					className: 'st-modal',
					onPointerDown: (event) => {
						if (event.target === event.currentTarget && !busy) props.onClose();
					},
				},
				h(
					'div',
					{
						className: 'st-dialog',
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': props.tr(isRename ? 'dialog.rename.title' : 'dialog.archive.title'),
					},
					h('h2', { className: 'st-dialog-title' }, props.tr(isRename ? 'dialog.rename.title' : 'dialog.archive.title')),
					isRename
						? h('input', {
							className: 'st-dialog-input',
							type: 'text',
							value: draft,
							placeholder: props.tr('dialog.rename.placeholder'),
							autoFocus: true,
							onChange: (event) => {
								setDraft(event.target.value);
								if (note !== '') setNote('');
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									submit();
								}
							},
						})
						: h('p', { className: 'st-dialog-text' }, props.tr('dialog.archive.text')),
					h('div', { className: 'st-dialog-note' }, note),
					h(
						'div',
						{ className: 'st-dialog-actions' },
						h('button', { className: 'st-btn', type: 'button', disabled: busy, onClick: () => props.onClose() }, props.tr('dialog.cancel')),
						h('button', { className: 'st-btn', type: 'button', 'data-primary': 'true', disabled: busy, onClick: submit }, props.tr(isRename ? 'dialog.save' : 'dialog.archive.confirm')),
					),
				),
			);
		}

		function SessionTreeInner(props) {
			const useSessions = props.useSessions;
			const useWorkspaces = typeof props.useWorkspaces === 'function'
				? props.useWorkspaces
				: (selector) => selector(EMPTY_WORKSPACES);
			const zh = isZh();
			const dict = zh ? ZH : EN;
			const tr = (key, values) => {
				let text;
				if (typeof props.t === 'function') {
					try {
						const translated = props.t(key);
						if (typeof translated === 'string' && translated !== '' && translated !== key) text = translated;
					} catch (error) {
						text = undefined;
					}
				}
				if (text === undefined) text = dict[key] !== undefined ? dict[key] : key;
				return values === undefined ? text : formatTemplate(text, values);
			};

			const sessionsState = useSessions((state) => state);
			const workspacesState = useWorkspaces((state) => state);
			const [showInherited, setShowInherited] = useState(false);
			const [showSubagents, setShowSubagents] = useState(false);
			const [showArchived, setShowArchived] = useState(false);
			const [showLinks, setShowLinks] = useState(true);
			const [strongOutline, setStrongOutline] = useState(true);
			const [groupKey, setGroupKey] = useState(null);
			const [error, setError] = useState(null);
			const [labelWidth, setLabelWidth] = useState(labelWidthStored);
			const [menuFor, setMenuFor] = useState(null);
			const [showSettings, setShowSettings] = useState(false);
			const [accent, setAccent] = useState(accentStored);
			const [dialog, setDialog] = useState(null);
			const [showRowSeps, setShowRowSeps] = useState(false);
			const [exactInheritance, setExactInheritance] = useState(exactInheritanceStored);
			const [selectMode, setSelectMode] = useState(false);
			const [autoSelect, setAutoSelect] = useState(false);
			const [selection, setSelection] = useState(null);
			const [merges, setMerges] = useState(mergesStored);
			const [panning, setPanning] = useState(false);
			const exactPending = useRef({});
			const bodyRef = useRef(null);
			const panRef = useRef(null);
			const panStopRef = useRef(null);
			const selectModeRef = useRef(false);
			const autoSelectRef = useRef(false);
			const dialogRef = useRef(null);
			selectModeRef.current = selectMode;
			autoSelectRef.current = autoSelect;
			dialogRef.current = dialog;
			const requested = useRef({});
			const dragRef = useRef(false);
			const rootRef = useRef(null);
			const actions = props.sessionActions === undefined ? {} : props.sessionActions;
			const pinnedSet = useMemo(() => new Set((workspacesState && workspacesState.pinnedSessionIds) || []), [workspacesState]);
			const archivedSet = useMemo(() => new Set((workspacesState && workspacesState.archivedSessionIds) || []), [workspacesState]);

			// Display-only merge state: turn ranges per Session, never written to the log.
			const selectionRange = selection === null
				? null
				: {
					sessionId: selection.sessionId,
					from: Math.min(selection.anchor, selection.focus),
					to: Math.max(selection.anchor, selection.focus),
				};
			const turnSelected = (sessionId, index) => selectionRange !== null && selectionRange.sessionId === sessionId && index >= selectionRange.from && index <= selectionRange.to;
			const mergedRangesFor = (sessionId) => (Array.isArray(merges[sessionId]) ? merges[sessionId] : []);
			const rowUnits = (row) => {
				const units = [];
				if (row.mini === true || row.visibleTo < row.visibleFrom) return units;
				let cursor = row.visibleFrom;
				for (const range of mergedRangesFor(row.session.id)) {
					const from = Math.max(range[0], row.visibleFrom);
					const to = Math.min(range[1], row.visibleTo);
					if (to < from) continue;
					while (cursor < from) {
						units.push({ kind: 'card', index: cursor });
						cursor += 1;
					}
					units.push({ kind: 'merge', from: from, to: to });
					cursor = to + 1;
				}
				while (cursor <= row.visibleTo) {
					units.push({ kind: 'card', index: cursor });
					cursor += 1;
				}
				return units;
			};

			const model = useMemo(
				() => buildModel(sessionsState, workspacesState, { showSubagents: showSubagents, showArchived: showArchived }),
				[sessionsState, workspacesState, showSubagents, showArchived],
			);
			const groups = model.groups;
			let activeGroup = groupKey === null ? undefined : model.byKey.get(groupKey);
			if (activeGroup === undefined && groups.length > 0) activeGroup = groups[0];
			const layout = useMemo(
				() => (activeGroup === undefined
					? null
					: layoutGroup(
						activeGroup,
						{ showInherited: showInherited, showSubagents: showSubagents, exact: exactInheritance, merges: merges, archived: archivedSet },
						sessionsState === undefined ? undefined : sessionsState.byId,
					)),
				[activeGroup, showInherited, showSubagents, exactInheritance, merges, sessionsState, archivedSet],
			);
			// Pixel geometry of every row's displayed nodes (turn cards and merged blocks),
			// used for the horizontal turn links and for edge anchors. Merged ranges take a
			// single column, so later nodes really shift left.
			const unitGeometry = useMemo(
				() => (layout === null
					? []
					: layout.rows.map((row) => {
						if (row.mini === true || row.visibleTo < row.visibleFrom) return [];
						const geometry = [];
						for (const unit of rowUnits(row)) {
							const turnIndex = unit.kind === 'merge' ? unit.from : unit.index;
							const column = rowColumnOf(row, turnIndex);
							if (unit.kind === 'merge') {
								const left = TRACK_INSET + column * STEP - MERGE_W_BLEED;
								geometry.push({
									from: column,
									to: column,
									left: left,
									right: left + COL_W + MERGE_W_EXTRA,
									top: row.top + row.mergedTop,
									bottom: row.top + row.mergedTop + MERGE_CARD_H,
								});
								continue;
							}
							const left = TRACK_INSET + column * STEP;
							geometry.push({
								from: column,
								to: column,
								left: left,
								right: left + COL_W,
								top: row.top + row.cardTop,
								bottom: row.top + row.cardTop + CARD_H,
							});
						}
						return geometry;
					})),
				[layout, merges],
			);

			useEffect(() => {
				if (activeGroup === undefined || typeof props.refreshProjections !== 'function') return;
				for (const session of activeGroup.sessions) {
					if (requested.current[session.id]) continue;
					const values = session.projectionValues;
					if (values !== undefined && Array.isArray(values.turnOutline)) continue;
					requested.current[session.id] = true;
					try {
						props.refreshProjections(session.id);
					} catch (error) {
						/* projection refresh is best effort */
					}
				}
			}, [activeGroup, props.refreshProjections]);

			useEffect(() => {
				if (activeGroup === undefined) return undefined;
				if (typeof document === 'undefined' || typeof document.baseURI !== 'string' || typeof fetch !== 'function') return undefined;
				const ids = [];
				const pendingId = new Set();
				const addId = (sessionId) => {
					if (pendingId.has(sessionId)) return;
					if (Object.prototype.hasOwnProperty.call(exactInheritanceStored, sessionId)) return;
					if (exactPending.current[sessionId] === true) return;
					pendingId.add(sessionId);
					ids.push(sessionId);
				};
				for (const session of activeGroup.sessions) {
					// Every Session is queried: since DSH 0.2.2 an ordinary fork keeps no
					// parentSession, so a seeded Session can only be recognized by its exact
					// inherited prefix (plus createdAt for ranking candidate sources).
					addId(session.id);
				}
				// Blank and archived Sessions never render, but they can still be the direct
				// fork source; their facts (createdAt, inherited count) feed the source ranking
				// so the visible child connects to the nearest visible ancestor instead.
				const groupPath = activeGroup.path === undefined || activeGroup.path === null ? '' : normPath(activeGroup.path);
				const allById = sessionsState === undefined || sessionsState.byId === undefined || sessionsState.byId === null ? undefined : sessionsState.byId;
				if (groupPath !== '' && allById !== undefined) {
					const entries = typeof allById.values === 'function' ? [...allById.values()] : Object.keys(allById).map((id) => allById[id]);
					for (const session of entries) {
						if (session === undefined || session === null || session.cwd === undefined) continue;
						if (normPath(session.cwd) !== groupPath) continue;
						addId(session.id);
					}
				}
				if (ids.length === 0) return undefined;
				let cancelled = false;
				const resolveChunk = async (chunk) => {
					for (const sessionId of chunk) exactPending.current[sessionId] = true;
					let table = null;
					try {
						const url = new URL(INHERITANCE_ROUTE + '?ids=' + encodeURIComponent(chunk.join(',')), document.baseURI);
						const response = await fetch(url.href, { credentials: 'same-origin' });
						if (response !== undefined && response !== null && response.ok === true) {
							const payload = await response.json();
							if (payload !== null && typeof payload === 'object') {
								if (payload.sessions !== undefined && payload.sessions !== null && typeof payload.sessions === 'object') table = payload.sessions;
								else if (payload.counts !== undefined && payload.counts !== null && typeof payload.counts === 'object') table = payload.counts;
								else table = payload;
							}
						}
					} catch (error) {
						table = null;
					}
					for (const sessionId of chunk) {
						const raw = table === null || typeof table !== 'object' ? undefined : table[sessionId];
						let inherited;
						let createdAt;
						if (typeof raw === 'number') {
							inherited = raw;
						} else if (raw !== null && typeof raw === 'object') {
							inherited = raw.inherited;
							createdAt = raw.createdAt;
						}
						exactInheritanceStored[sessionId] = typeof inherited === 'number' && Number.isFinite(inherited)
							? { inherited: inherited, createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : undefined }
							: null;
					}
				};
				const run = async () => {
					for (let offset = 0; offset < ids.length && cancelled === false; offset += 20) {
						await resolveChunk(ids.slice(offset, offset + 20));
						if (cancelled === false) setExactInheritance(Object.assign({}, exactInheritanceStored));
					}
				};
				Promise.resolve().then(run);
				return () => {
					cancelled = true;
				};
			}, [activeGroup]);

			useEffect(() => {
				if (menuFor === null && !showSettings) return undefined;
				const onPointerDown = (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					if (target.closest('.st-menu') !== null || target.closest('.st-menu-trigger') !== null) return;
					if (target.closest('.st-popover') !== null || target.closest('.st-settings-trigger') !== null) return;
					setMenuFor(null);
					setShowSettings(false);
				};
				document.addEventListener('pointerdown', onPointerDown, true);
				return () => document.removeEventListener('pointerdown', onPointerDown, true);
			}, [menuFor, showSettings]);

			useEffect(() => {
				if (dialog === null) return undefined;
				const onKeyDown = (event) => {
					if (event.key === 'Escape') setDialog(null);
				};
				document.addEventListener('keydown', onKeyDown);
				return () => document.removeEventListener('keydown', onKeyDown);
			}, [dialog]);

			useEffect(() => () => {
				if (panStopRef.current !== null) {
					panStopRef.current();
					panStopRef.current = null;
				}
			}, []);

			// Ctrl is a transient shortcut for select mode: hold to select (Ctrl+click
			// toggles a node, Ctrl+Shift+click extends). Releasing keeps the current
			// selection so the merge toolbar stays actionable; the header toggle is the
			// sticky alternative.
			useEffect(() => {
				if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
				const editing = () => {
					if (typeof document === 'undefined' || document.activeElement === null || document.activeElement === undefined) return false;
					const tag = String(document.activeElement.tagName || '');
					return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
				};
				const down = (event) => {
					const key = event.key;
					if (key !== 'Control' && key !== 'Ctrl') return;
					if (dialogRef.current !== null || editing() === true) return;
					if (selectModeRef.current === true) return;
					autoSelectRef.current = true;
					setAutoSelect(true);
					setSelectMode(true);
				};
				const leave = () => {
					if (autoSelectRef.current !== true) return;
					autoSelectRef.current = false;
					setAutoSelect(false);
					setSelectMode(false);
				};
				const up = (event) => {
					const key = event.key;
					if (key !== 'Control' && key !== 'Ctrl') return;
					leave();
				};
				window.addEventListener('keydown', down);
				window.addEventListener('keyup', up);
				window.addEventListener('blur', leave);
				return () => {
					window.removeEventListener('keydown', down);
					window.removeEventListener('keyup', up);
					window.removeEventListener('blur', leave);
				};
			}, []);

			/** Drag the canvas itself: the tree scrolls horizontally/vertically like a map. */
			const PAN_IGNORE = '.st-card, .st-mini, .st-label, .st-menu, .st-menu-trigger, .st-settings-trigger, .st-popover, .st-resizer, .st-toolbar, button, input, select, textarea, a';
			const startPan = (event) => {
				if (event.button !== 0 || event.defaultPrevented === true) return;
				const target = event.target;
				if (target instanceof Element && target.closest(PAN_IGNORE) !== null) return;
				const body = bodyRef.current;
				if (body === null) return;
				const pan = { x: event.clientX, y: event.clientY, left: body.scrollLeft, top: body.scrollTop, moved: false };
				panRef.current = pan;
				setPanning(true);
				const move = (moveEvent) => {
					if (panRef.current !== pan) return;
					const dx = moveEvent.clientX - pan.x;
					const dy = moveEvent.clientY - pan.y;
					if (pan.moved !== true && Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
					if (pan.moved === true) {
						body.scrollLeft = pan.left - dx;
						body.scrollTop = pan.top - dy;
					}
				};
				const stop = () => {
					panStopRef.current = null;
					setPanning(false);
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', stop);
					window.removeEventListener('pointercancel', stop);
					setTimeout(() => {
						if (panRef.current === pan) panRef.current = null;
					}, 0);
				};
				panStopRef.current = stop;
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', stop);
				window.addEventListener('pointercancel', stop);
			};
			const suppressPanClick = (event) => {
				const pan = panRef.current;
				if (pan === null || pan.moved !== true) return;
				event.preventDefault();
				event.stopPropagation();
			};

			const reportError = (key) => {
				setError(tr(key));
				setTimeout(() => setError(null), 5000);
			};
			const describeFailure = (failure) => {
				const rpc = failure !== null && failure !== undefined && failure.rpcError !== undefined ? failure.rpcError : undefined;
				const code = rpc !== null && rpc !== undefined && rpc.code !== undefined
					? String(rpc.code)
					: (failure !== null && failure !== undefined && failure.code !== undefined ? String(failure.code) : 'unknown');
				const message = rpc !== null && rpc !== undefined && rpc.message !== undefined
					? String(rpc.message)
					: (failure !== null && failure !== undefined && failure.message !== undefined ? String(failure.message) : '');
				if (code === 'workspace/session-active' || message.indexOf('workspace/session-active') >= 0) return tr('error.archiveActive');
				const detail = message === '' ? '' : '：' + (message.length > 90 ? message.slice(0, 90) + '…' : message);
				return formatTemplate(tr('error.action'), { code: code + detail });
			};
			const runAction = (promise) => Promise.resolve(promise).then(
				(value) => ({ ok: true, value: value }),
				(failure) => ({ ok: false, failure: failure }),
			);

			const startResize = (event) => {
				if (event.button !== undefined && event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				const handle = event.currentTarget;
				const startX = event.clientX;
				const startWidth = labelWidth;
				let applied = startWidth;
				dragRef.current = true;
				const applyWidth = (next) => {
					applied = next;
					if (rootRef.current !== null) rootRef.current.style.setProperty('--st-label-w', next + 'px');
				};
				const move = (moveEvent) => {
					if (dragRef.current !== true) return;
					applyWidth(Math.max(170, Math.min(560, startWidth + (moveEvent.clientX - startX))));
				};
				const stop = () => {
					dragRef.current = false;
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', stop);
					if (applied !== startWidth) {
						labelWidthStored = applied;
						setLabelWidth(applied);
					}
				};
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', stop);
			};

			const doPin = async (session, pinned) => {
				if (typeof actions.pin !== 'function') return;
				const outcome = await runAction(actions.pin(session.id, pinned));
				if (outcome.ok !== true) reportError(describeFailure(outcome.failure));
			};
			const doCopy = (session) => {
				if (typeof actions.copyId !== 'function') return;
				Promise.resolve(actions.copyId(session.id)).catch(() => undefined);
			};
			const doUnarchive = async (session) => {
				if (typeof actions.unarchive !== 'function') return;
				const outcome = await runAction(actions.unarchive(session.id));
				if (outcome.ok !== true) reportError(describeFailure(outcome.failure));
			};
			const doArchive = async (session) => {
				if (typeof actions.archive !== 'function') return;
				const outcome = await runAction(actions.archive(session.id, false));
				if (outcome.ok === true) return;
				const code = outcome.failure && outcome.failure.code !== undefined ? String(outcome.failure.code) : '';
				if (code === 'workspace/session-active') {
					setDialog({ kind: 'archive-running', sessionId: session.id, title: session.title || session.displayTitle || '' });
					return;
				}
				reportError(describeFailure(outcome.failure));
			};
			const doForkSession = async (session) => {
				if (typeof actions.fork !== 'function') return;
				const outcome = await runAction(actions.fork(session.id));
				if (outcome.ok !== true) reportError(describeFailure(outcome.failure));
			};
			const shortcutLabel = (id) => {
				try {
					if (typeof props.shortcutLabel !== 'function') return '';
					return String(props.shortcutLabel(id) || '');
				} catch (error) {
					return '';
				}
			};
			const menuItems = (session) => {
				const pinned = pinnedSet.has(session.id);
				const archived = archivedSet.has(session.id);
				return [
					{
						key: 'pin',
						icon: 'pin',
						label: pinned ? tr('menu.unpin') : tr('menu.pin'),
						shortcut: shortcutLabel('session.pin'),
						run: () => {
							setMenuFor(null);
							doPin(session, !pinned);
						},
					},
					{
						key: 'rename',
						icon: 'edit',
						label: tr('menu.rename'),
						shortcut: shortcutLabel('session.rename'),
						run: () => {
							setMenuFor(null);
							setDialog({ kind: 'rename', sessionId: session.id, title: session.title || session.displayTitle || '' });
						},
					},
					{
						key: 'fork',
						icon: 'branch',
						label: tr('menu.forkSession'),
						shortcut: shortcutLabel('session.fork'),
						run: () => {
							setMenuFor(null);
							doForkSession(session);
						},
					},
					{
						key: 'archive',
						icon: archived ? 'unarchive' : 'archive',
						label: archived ? tr('menu.unarchive') : tr('menu.archive'),
						shortcut: archived ? '' : shortcutLabel('session.archive'),
						tone: archived ? undefined : 'danger',
						run: () => {
							setMenuFor(null);
							if (archived) doUnarchive(session);
							else doArchive(session);
						},
					},
					{ key: 'sep', separator: true },
					{
						key: 'copy',
						icon: 'copy',
						label: tr('menu.copyId'),
						run: () => {
							setMenuFor(null);
							doCopy(session);
						},
					},
				];
			};
			const openTurn = (row, turn) => {
				if (typeof props.locateTurn !== 'function') return;
				Promise.resolve(props.locateTurn(row.session.id, turn.turn, turn.seq)).catch(() => {});
			};
			const forkTurn = (row, turn, index) => {
				if (typeof props.forkTurn !== 'function') return;
				Promise.resolve(props.forkTurn(row.session.id, row.turns, index)).catch(() => reportError('error.fork'));
			};
			const openMini = (row) => {
				if (typeof props.openSession !== 'function') return;
				try {
					props.openSession(row.session.id);
				} catch (error) {
					/* navigation is best effort */
				}
			};
			const selectTurn = (sessionId, index, extend) => {
				if (selectMode !== true) return;
				const current = selection;
				if (current === null || current.sessionId !== sessionId || extend !== true) {
					setSelection({ sessionId: sessionId, anchor: index, focus: index });
					return;
				}
				setSelection({ sessionId: sessionId, anchor: current.anchor, focus: index });
			};
			const selectBlock = (sessionId, from, to, extend) => {
				if (selectMode !== true) return;
				const current = selection;
				if (current === null || current.sessionId !== sessionId || extend !== true) {
					setSelection({ sessionId: sessionId, anchor: from, focus: to });
					return;
				}
				setSelection({ sessionId: sessionId, anchor: current.anchor, focus: to });
			};
			const applyMerge = () => {
				const range = selectionRange;
				if (range === null || range.to - range.from + 1 < 2) return;
				const next = Object.assign({}, merges);
				next[range.sessionId] = normalizeRanges(mergedRangesFor(range.sessionId).concat([[range.from, range.to]]));
				mergesStored = next;
				persistMerges(next);
				setMerges(next);
				setSelection(null);
				autoSelectRef.current = false;
				setAutoSelect(false);
				setSelectMode(false);
			};
			const splitMerge = (sessionId, from, to) => {
				const keep = mergedRangesFor(sessionId).filter((range) => !(range[0] <= from && range[1] >= to));
				const next = Object.assign({}, merges);
				if (keep.length === 0) delete next[sessionId];
				else next[sessionId] = normalizeRanges(keep);
				mergesStored = next;
				persistMerges(next);
				setMerges(next);
			};
			const exitSelect = () => {
				autoSelectRef.current = false;
				setAutoSelect(false);
				setSelection(null);
				setSelectMode(false);
			};

			const headerStats = layout === null
				? ''
				: [
					layout.sessions + ' ' + tr('unit.sessions'),
					layout.turns + ' ' + tr('unit.turns'),
					layout.forks + ' ' + tr('unit.forks'),
				].join(' · ');

			const renderRow = (row, index) => {
				const session = row.session;
				const mini = row.mini === true;
				const compact = row.compact === true;
				const title = session.title || session.displayTitle || String(session.id).slice(0, 8);
				const forkText = mini
					? ''
					: (row.subagent
						? (row.forkCol >= 0
							? formatTemplate(tr('row.spawnedAt'), { turn: row.forkCol + 1 })
							: tr('row.spawned'))
						: (row.parentHiddenTitle !== undefined && row.parentHiddenTitle !== '' && row.inherited > 0
							? formatTemplate(tr('row.inheritedFrom'), { title: row.parentHiddenTitle, turn: Math.max(1, row.inherited) })
							: (row.parent !== undefined && row.forkCol >= 0
								? formatTemplate(tr(row.compactParent ? 'row.forkedCompact' : (row.hiddenGap ? 'row.forkedVia' : 'row.forked')), { turn: row.forkCol + 1 })
								: (row.directParent !== undefined && row.inherited > 0 ? tr('row.forkedHidden') : ''))));
				const metaText = [
					row.turns.length + ' ' + tr('unit.turns'),
					formatWhen(session.updatedAt, zh),
				].filter((part) => part !== '').join(' · ');
				const labelChildren = mini
					? [
						h('div', { className: 'st-label-title', key: 'title', title: title }, (row.depth > 1 ? '↳ ' : '') + title),
						h(
							'div',
							{ className: 'st-label-meta', key: 'meta' },
							[
								tr('row.subagent'),
								row.turns.length + ' ' + tr('unit.turns'),
								row.archived ? tr('row.archived') : '',
							].filter((part) => part !== '').join(' · '),
						),
					]
					: compact
						? [
							h('div', { className: 'st-label-title', key: 'title', title: title }, (row.depth > 0 ? '↳ ' : '') + title),
							h(
								'div',
								{ className: 'st-label-meta', key: 'meta' },
								[
									row.subagent ? tr('row.subagent') : '',
									forkText === '' ? '' : forkText,
									tr('row.noOwnTurns'),
									row.archived ? tr('row.archived') : '',
								].filter((part) => part !== '').join(' · '),
							),
						]
						: [
							h('div', { className: 'st-label-title', key: 'title', title: title }, (row.depth > 0 ? '↳ ' : '') + title),
							h('div', { className: 'st-label-meta', key: 'meta' }, metaText),
						];
				if (!compact && !mini) {
					if (forkText !== '') {
						labelChildren.push(h('div', { className: 'st-label-fork', key: 'fork' }, forkText));
					}
					const chips = [];
					if (row.subagent) {
						chips.push(h('span', { className: 'st-chip', key: 'sub', 'data-kind': 'subagent' }, tr('row.subagent')));
					}
					if (row.archived) {
						chips.push(h('span', { className: 'st-chip', key: 'archived' }, tr('row.archived')));
					}
					if (chips.length > 0) {
						labelChildren.push(h('div', { className: 'st-label-archived', key: 'chips' }, chips));
					}
				}
				if (index < layout.rows.length - 1) {
					labelChildren.push(h('div', { className: 'st-rowsep', key: 'rowsep', 'aria-hidden': true }));
				}
				labelChildren.push(h('div', { className: 'st-divider', key: 'divider', 'aria-hidden': true }));
				labelChildren.push(
					h('div', {
						className: 'st-resizer',
						key: 'resizer',
						role: 'separator',
						'aria-orientation': 'vertical',
						'aria-label': tr('resize.label'),
						'aria-valuemin': 170,
						'aria-valuemax': 560,
						'aria-valuenow': labelWidth,
						onPointerDown: startResize,
					}),
				);
				labelChildren.push(
					h(
						'button',
						{
							className: 'st-menu-trigger',
							key: 'menu-trigger',
							type: 'button',
							'data-open': menuFor === session.id ? 'true' : 'false',
							'aria-label': tr('menu.open'),
							title: tr('menu.open'),
							'aria-haspopup': 'menu',
							'aria-expanded': menuFor === session.id ? 'true' : 'false',
							onClick: (event) => {
								event.stopPropagation();
								setMenuFor(menuFor === session.id ? null : session.id);
							},
						},
						'⋯',
					),
				);
				if (menuFor === session.id) {
					const flip = index >= Math.ceil(layout.rows.length / 2);
					labelChildren.push(
						h(
							'div',
							{
								className: 'st-menu',
								key: 'menu',
								role: 'menu',
								style: flip ? { bottom: '32px', left: 'calc(100% - 26px)' } : { top: '32px', left: 'calc(100% - 26px)' },
							},
							menuItems(session).map((item) => {
								if (item.separator === true) return h('div', { className: 'st-menu-sep', key: item.key, role: 'separator' });
								return h(
									'button',
									{
										key: item.key,
										type: 'button',
										role: 'menuitem',
										className: 'st-menu-item',
										'data-tone': item.tone,
										onClick: item.run,
									},
									h('span', { className: 'st-menu-icon' }, h(Icon, { name: item.icon, size: 15 })),
									h('span', { className: 'st-menu-label' }, item.label),
									item.shortcut === undefined || item.shortcut === '' ? null : h('span', { className: 'st-menu-shortcut' }, item.shortcut),
								);
							}),
						),
					);
				}
				const trackChildren = [];
				if (mini) {
					trackChildren.push(h(
						'div',
						{
							className: 'st-mini',
							key: 'mini',
							role: 'button',
							tabIndex: 0,
							'data-running': session.running === true ? 'true' : 'false',
							'data-archived': row.archived ? 'true' : 'false',
							title: title,
							'aria-label': title,
							style: { left: (TRACK_INSET + row.spawnColAbs * STEP) + 'px', top: MINI_TOP + 'px' },
							onClick: () => openMini(row),
							onKeyDown: (event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									openMini(row);
								}
							},
						},
						h(Icon, { name: 'branch', size: 12 }),
						h('span', { className: 'st-mini-label' }, title),
						h('span', { className: 'st-mini-count' }, String(row.turns.length)),
					));
				} else {
					for (const unit of rowUnits(row)) {
						if (unit.kind === 'merge') {
							const mergedTurns = row.turns.slice(unit.from, unit.to + 1).filter((turn) => turn !== undefined);
							if (mergedTurns.length === 0) continue;
							trackChildren.push(
								h(MergedCard, {
									key: session.id + '-merge-' + unit.from,
									turns: mergedTurns,
									from: unit.from,
									to: unit.to,
									col: rowColumnOf(row, unit.from),
									top: row.mergedTop,
									height: MERGE_CARD_H,
									inherited: unit.from < row.inherited,
									archived: row.archived,
									selectable: selectMode,
									selected: turnSelected(session.id, unit.from),
									tr: tr,
									onActivate: (event) => {
										if (selectMode) selectBlock(session.id, unit.from, unit.to, event !== undefined && event.shiftKey === true);
										else openTurn(row, mergedTurns[0]);
									},
									onSplit: () => splitMerge(session.id, unit.from, unit.to),
								}),
							);
							continue;
						}
						const turnIndex = unit.index;
						const turn = row.turns[turnIndex];
						if (turn === undefined) continue;
						trackChildren.push(
							h(TurnCard, {
								key: session.id + '-turn-' + turnIndex,
								turn: turn,
								col: rowColumnOf(row, turnIndex),
								top: row.cardTop,
								inherited: turnIndex < row.inherited,
								running: session.running === true && turnIndex === row.visibleTo,
								archived: row.archived,
								spawnCount: row.spawns === undefined ? 0 : (row.spawns.get(turnIndex) === undefined ? 0 : row.spawns.get(turnIndex)),
								selectable: selectMode,
								selected: turnSelected(session.id, turnIndex),
								tr: tr,
								onActivate: (event) => {
									if (selectMode) selectTurn(session.id, turnIndex, event !== undefined && event.shiftKey === true);
									else openTurn(row, turn);
								},
								onFork: () => forkTurn(row, turn, turnIndex),
							}),
						);
					}
				}
				return h(
					'div',
					{
						className: 'st-row',
						key: session.id,
						'data-archived': row.archived ? 'true' : 'false',
						'data-compact': compact ? 'true' : 'false',
						'data-subagent': row.subagent ? 'true' : 'false',
						'data-mini': mini ? 'true' : 'false',
						style: { height: row.height + 'px', marginBottom: index < layout.rows.length - 1 ? ROW_GAP + 'px' : '0', zIndex: menuFor === session.id ? 30 : 2 },
					},
					h(
						'div',
						{ className: 'st-label', style: { paddingLeft: 22 + Math.min(row.depth, 6) * 14 + 'px' } },
						labelChildren,
					),
					h('div', { className: 'st-track', style: { width: layout.trackWidth + 'px' } }, trackChildren),
				);
			};

			const dialogView = dialog === null ? null : h(SessionDialog, {
				key: dialog.kind + ':' + dialog.sessionId,
				dialog: dialog,
				tr: tr,
				onClose: () => setDialog(null),
				onSubmit: (title) => {
					const invocation = dialog.kind === 'rename'
						? (typeof actions.rename === 'function' ? actions.rename(dialog.sessionId, title) : Promise.reject({ code: 'unavailable' }))
						: (typeof actions.archive === 'function' ? actions.archive(dialog.sessionId, true) : Promise.reject({ code: 'unavailable' }));
					return runAction(invocation).then((outcome) => (outcome.ok === true ? null : describeFailure(outcome.failure)));
				},
			});

			const selectionCount = selectionRange === null ? 0 : selectionRange.to - selectionRange.from + 1;
			const toolbarView = selectMode !== true && selectionRange === null
				? null
				: h(
					'div',
					{ className: 'st-toolbar', role: 'toolbar', 'aria-label': tr('toggle.select') },
					h(
						'span',
						{ className: 'st-toolbar-text' },
						selectionCount > 0
							? formatTemplate(tr('select.count'), { count: selectionCount })
							: (autoSelect === true ? tr('select.autoHint') : tr('select.hint')),
					),
					selectionCount > 1
						? h(
							'button',
							{ className: 'st-toolbar-btn st-toolbar-primary', type: 'button', onClick: applyMerge },
							tr('select.merge'),
						)
						: null,
					h('button', { className: 'st-toolbar-btn', type: 'button', onClick: exitSelect }, tr('select.exit')),
				);

			const body = layout === null || layout.rows.length === 0
				? h(
					'div',
					{ className: 'st-empty' },
					h('div', { className: 'st-empty-title' }, tr(groups.length === 0 ? 'empty.title' : 'empty.filtered')),
					h('div', {}, tr('empty.hint')),
				)
				: h(
					'div',
					{
						className: 'st-body',
						ref: bodyRef,
						onPointerDown: startPan,
						onClickCapture: suppressPanClick,
						'data-panning': panning ? 'true' : 'false',
					},
					h(
						'div',
						{ className: 'st-grid', style: { minHeight: layout.gridHeight + 'px' } },
						h(EdgeLayer, {
							key: 'edges',
							rows: layout.rows,
							edges: layout.edges,
							spans: unitGeometry,
							links: showLinks,
							separators: showRowSeps,
							separatorY: layout.separators,
							width: layout.trackWidth,
							height: layout.gridHeight,
						}),
						layout.rows.map(renderRow),
					),
				);

			return h(
				'div',
				{
					className: 'st-root',
					role: 'region',
					'aria-label': tr('page.title'),
					'data-outline': strongOutline ? 'strong' : 'soft',
					style: {
						'--st-label-w': labelWidth + 'px',
						'--st-accent': accent === THEME_ACCENT ? 'var(--dsw-alias-brand-primary)' : accent,
					},
					ref: rootRef,
				},
				h(
					'div',
					{ className: 'st-head' },
					h(
						'div',
						{ className: 'st-headtext' },
						h('h1', { className: 'st-title' }, tr('page.title')),
						h('div', { className: 'st-sub' }, headerStats || tr('page.subtitle')),
					),
					h(
						'div',
						{ className: 'st-controls' },
						groups.length > 1
							? h(
								'select',
								{
									className: 'st-select',
									value: activeGroup === undefined ? '' : activeGroup.key,
									'aria-label': tr('group.label'),
									onChange: (event) => setGroupKey(event.target.value),
								},
								groups.map((group) => h('option', { key: group.key, value: group.key }, group.title || tr('group.none'))),
							)
							: null,
						h(Toggle, {
							label: tr('toggle.links'),
							hint: tr('toggle.links'),
							on: showLinks,
							onToggle: () => setShowLinks(!showLinks),
						}),
						h(Toggle, {
							label: tr('toggle.outline'),
							hint: tr('toggle.outline'),
							on: strongOutline,
							onToggle: () => setStrongOutline(!strongOutline),
						}),
						h(Toggle, {
							label: tr('toggle.inherited'),
							hint: tr('toggle.inherited'),
							on: showInherited,
							onToggle: () => setShowInherited(!showInherited),
						}),
						h(Toggle, {
							label: tr('toggle.subagents'),
							hint: tr('toggle.subagents'),
							on: showSubagents,
							onToggle: () => setShowSubagents(!showSubagents),
						}),
						h(Toggle, {
							label: tr('toggle.separators'),
							hint: tr('toggle.separators'),
							on: showRowSeps,
							onToggle: () => setShowRowSeps(!showRowSeps),
						}),
						h(Toggle, {
							label: tr('toggle.archived'),
							hint: tr('toggle.archived'),
							on: showArchived,
							onToggle: () => setShowArchived(!showArchived),
						}),
						h(Toggle, {
							label: tr('toggle.select'),
							hint: tr('toggle.selectHint'),
							tip: tr('toggle.selectTip'),
							on: selectMode,
							onToggle: () => {
								if (selectMode) exitSelect();
								else setSelectMode(true);
							},
						}),
						h(
							'div',
							{ className: 'st-settings', key: 'settings' },
							h(
								'button',
								{
									className: 'st-settings-trigger',
									type: 'button',
									'data-open': showSettings ? 'true' : 'false',
									'aria-label': tr('settings.open'),
									title: tr('settings.open'),
									'aria-expanded': showSettings ? 'true' : 'false',
									onClick: (event) => {
										event.stopPropagation();
										setShowSettings(!showSettings);
									},
								},
								h(Icon, { name: 'settings', size: 15 }),
							),
							showSettings
								? h(
									'div',
									{ className: 'st-popover', role: 'dialog', 'aria-label': tr('settings.open') },
									h('div', { className: 'st-popover-title' }, tr('settings.accent')),
									h(
										'div',
										{ className: 'st-color-row' },
										h('input', {
											className: 'st-color',
											type: 'color',
											value: accent === THEME_ACCENT ? DEFAULT_ACCENT : accent,
											'aria-label': tr('settings.accent'),
											onChange: (event) => {
												const next = event.target.value;
												accentStored = next;
												persistAccent(next);
												setAccent(next);
											},
										}),
										h(
											'button',
											{
												className: 'st-link-btn',
												type: 'button',
												'data-active': accent === DEFAULT_ACCENT ? 'true' : 'false',
												onClick: () => {
													accentStored = DEFAULT_ACCENT;
													persistAccent(DEFAULT_ACCENT);
													setAccent(DEFAULT_ACCENT);
												},
											},
											tr('settings.default'),
										),
										h(
											'button',
											{
												className: 'st-link-btn',
												type: 'button',
												'data-active': accent === THEME_ACCENT ? 'true' : 'false',
												onClick: () => {
													accentStored = THEME_ACCENT;
													persistAccent(THEME_ACCENT);
													setAccent(THEME_ACCENT);
												},
											},
											tr('settings.theme'),
										),
									),
									h('div', { className: 'st-popover-note' }, tr('settings.accentNote')),
								)
								: null,
						),
					),
				),
				h('div', { className: 'st-hint' }, tr('hint')),
				error === null ? null : h('div', { className: 'st-error' }, error),
				body,
				toolbarView,
				dialogView,
			);
		}

		function SessionTreePage(props) {
			if (typeof props.useSessions !== 'function') {
				return h('div', { className: 'st-root' }, h('div', { className: 'st-empty' }, 'Session list unavailable'));
			}
			return h(SessionTreeInner, props);
		}
		//#endregion

		//#region apply
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		function install(ctx) {
			ctx.effect(() => installStyles(), 'session-tree: panel styles');
			ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'session-tree: dictionaries');
			const t = ctx.locale.bind(NS);

			const selectConversation = () => {
				try {
					ctx.layout.selectPanel(null);
				} catch (error) {
					/* panel selection is best effort */
				}
			};

			const openSession = (sessionId) => {
				try {
					ctx.uiWorkspace.openSession(sessionId);
				} catch (error) {
					return false;
				}
				selectConversation();
				return true;
			};

			const locateTurn = async (sessionId, turnNumber, turnStartSeq) => {
				openSession(sessionId);
				let face;
				for (let attempt = 0; attempt < 80; attempt += 1) {
					let binding;
					try {
						binding = ctx.sessions.binding(sessionId);
					} catch (error) {
						binding = undefined;
					}
					if (binding !== undefined && binding.session !== undefined) {
						face = binding.session;
						break;
					}
					await sleep(50);
				}
				if (face !== undefined && typeof face.loadThrough === 'function' && typeof turnStartSeq === 'number') {
					try {
						await face.loadThrough(turnStartSeq);
					} catch (error) {
						/* history paging is best effort */
					}
				}
				const exact = '[data-chat-turn="' + String(turnNumber) + '"][data-chat-flow-kind="user"]';
				const loose = '[data-chat-turn="' + String(turnNumber) + '"]';
				for (let attempt = 0; attempt < 40; attempt += 1) {
					const element = document.querySelector(exact) || document.querySelector(loose);
					if (element !== null) {
						try {
							element.scrollIntoView({ block: 'center', behavior: 'smooth' });
						} catch (error) {
							try {
								element.scrollIntoView();
							} catch (nested) {
								/* ignore */
							}
						}
						element.setAttribute('data-session-tree-flash', '');
						setTimeout(() => {
							try {
								element.removeAttribute('data-session-tree-flash');
							} catch (error) {
								/* element may be gone */
							}
						}, 1600);
						return true;
					}
					await sleep(80);
				}
				return false;
			};

			const forkTurn = (sessionId, turns, turnIndex) => {
				const next = Array.isArray(turns) ? turns[turnIndex + 1] : undefined;
				const options = {
					sessionId: sessionId,
					increaseTitle: true,
					onCreated: (childId) => {
						openSession(childId);
					},
				};
				if (next !== undefined && typeof next.seq === 'number' && next.seq > 0) options.atSeq = next.seq - 1;
				return Promise.resolve(ctx.sessions.fork(options)).then(
					(childId) => childId,
					(error) => Promise.reject(error),
				);
			};

			const failureOf = (code, message) => {
				const error = new Error(message === undefined ? String(code) : String(message));
				error.code = String(code);
				return error;
			};
			const expectOk = (result) => {
				if (result !== null && result !== undefined && result.ok === true) return result.value;
				const failure = result !== null && result !== undefined && result.error !== undefined ? result.error : undefined;
				throw failureOf(
					failure !== undefined && failure.code !== undefined ? failure.code : 'unknown',
					failure === undefined ? undefined : failure.message,
				);
			};
			const KEY_LABELS = {
				KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J',
				KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T',
				KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y', KeyZ: 'Z',
				Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
				Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
				Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc',
				ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
			};
			const modifierLabel = (modifier, isMac) => {
				if (modifier === 'primary') return isMac ? 'Cmd' : 'Ctrl';
				if (modifier === 'meta') return isMac ? 'Cmd' : 'Win';
				if (modifier === 'control') return 'Ctrl';
				if (modifier === 'alt') return isMac ? 'Option' : 'Alt';
				if (modifier === 'shift') return 'Shift';
				return String(modifier);
			};
			const isMacPlatform = (() => {
				try {
					return /mac/i.test(String((navigator && navigator.platform) || ''));
				} catch (error) {
					return false;
				}
			})();
			const shortcutLabel = (id) => {
				try {
					const shortcuts = ctx.get('shortcuts');
					if (shortcuts === undefined || shortcuts === null) return '';
					const catalog = shortcuts.catalog;
					if (catalog === undefined) return '';
					const rows = catalog.getSnapshot();
					const row = Array.isArray(rows) ? rows.find((entry) => entry.id === id) : undefined;
					const binding = row === undefined ? undefined : row.binding;
					if (binding === undefined || binding === null || binding.code === undefined) return '';
					const parts = [];
					for (const modifier of Array.isArray(binding.modifiers) ? binding.modifiers : []) parts.push(modifierLabel(modifier, isMacPlatform));
					const code = String(binding.code);
					parts.push(KEY_LABELS[code] === undefined ? code.replace(/^Key/, '') : KEY_LABELS[code]);
					return parts.join(' + ');
				} catch (error) {
					return '';
				}
			};

			const sessionActions = {
				rename: async (sessionId, title) => {
					const result = await ctx.sessions.using(sessionId, { source: 'workspaceOperation' }, (reference) => reference.binding.session.rename(title));
					return expectOk(result);
				},
				archive: async (sessionId, stopActivity) => ctx.uiWorkspace.archiveSession(sessionId, stopActivity === true ? { stopActivity: true } : undefined),
				unarchive: async (sessionId) => ctx.uiWorkspace.unarchiveSession(sessionId),
				pin: async (sessionId, pinned) => (pinned ? ctx.workspaces.pinSession(sessionId) : ctx.workspaces.unpinSession(sessionId)),
				fork: async (sessionId) => ctx.uiWorkspace.forkSession(sessionId, (childId) => {
					openSession(childId);
				}),
				copyId: async (sessionId) => {
					if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
					await navigator.clipboard.writeText(String(sessionId));
					return true;
				},
			};

			ctx.slots.inject('main', () => ctx.slots.register({
				name: 'main',
				key: PANEL_ID,
				locale: NS,
				inject: () => ({
					locateTurn: locateTurn,
					forkTurn: forkTurn,
					openSession: openSession,
					sessionActions: sessionActions,
					shortcutLabel: shortcutLabel,
					refreshProjections: (sessionId) => {
						try {
							return Promise.resolve(ctx.sessions.refreshProjections(sessionId)).catch(() => undefined);
						} catch (error) {
							return Promise.resolve(undefined);
						}
					},
				}),
			}, SessionTreePage));

			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
				name: 'sidebar.panellist',
				id: PANEL_ID,
				order: 24,
				locale: NS,
				label: () => t('panel.title'),
				inject: () => ({}),
			}, TreePanelIcon));
		}

		return {
			inject: ['slots', 'locale', 'layout', 'sessions', 'workspaces', 'uiWorkspace'],
			apply: install,
		};
		//#endregion
	},
});
