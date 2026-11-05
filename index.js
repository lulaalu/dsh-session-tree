/**
 * Host half of the Session Tree bundle.
 *
 * The Web client half draws the tree; this half only answers one read-only question
 * the browser cannot answer from projections: the exact fork-inherited event count of
 * each Session. Raw turn seqs are unique inside one Session log only, so a client-side
 * alignment fallback cannot tell a child's own turn from an inherited one when both
 * happen to share the same seq and content. `inheritedEventCount` is exact.
 *
 * Reads stay cheap: a live Session exposes the count directly, a persisted Session is
 * opened read-only just far enough to read its header state, and every answer is cached
 * for the process lifetime because a fork's inherited prefix never changes.
 */
const INHERITANCE_PATH = '/api/session-tree/inherit';
const MAX_IDS = 400;
/** Persisted logs above this size are skipped: opening them costs more than the answer is worth. */
const MAX_COLD_BYTES = 1500000;

export function apply(ctx) {
	ctx.inject(['connection', 'sessions', 'sessionPersistence'], (inner) => {
		const cache = new Map();
		const countOf = async (sessionId) => {
			const cached = cache.get(sessionId);
			if (cached !== undefined) return cached;
			const live = inner.sessions.get(sessionId);
			if (live !== undefined) {
				const value = Number(live.inheritedEventCount) || 0;
				cache.set(sessionId, value);
				return value;
			}
			let handle;
			try {
				const stat = await inner.sessionPersistence.stat(sessionId);
				if (stat !== undefined && typeof stat.sizeBytes === 'number' && stat.sizeBytes > MAX_COLD_BYTES) {
					cache.set(sessionId, null);
					return null;
				}
				handle = await inner.sessionPersistence.open(sessionId, 'read');
				const value = Number(handle.inheritedEventCount) || 0;
				cache.set(sessionId, value);
				return value;
			} catch (error) {
				cache.set(sessionId, null);
				return null;
			} finally {
				if (handle !== undefined) {
					try {
						await handle.close();
					} catch (error) {
						/* a failed close cannot change the header answer */
					}
				}
			}
		};
		inner.effect(() => inner.connection.fetch.register({
			path: INHERITANCE_PATH,
			methods: ['GET'],
			requestBody: 'buffered',
			fetch: async (request) => {
				const url = new URL(request.url);
				const ids = String(url.searchParams.get('ids') === null ? '' : url.searchParams.get('ids'))
					.split(',')
					.map((value) => value.trim())
					.filter((value) => value !== '')
					.slice(0, MAX_IDS);
				const counts = {};
				for (const sessionId of ids) counts[sessionId] = await countOf(sessionId);
				return new Response(JSON.stringify({ counts }), {
					status: 200,
					headers: {
						'content-type': 'application/json; charset=utf-8',
						'cache-control': 'no-store',
					},
				});
			},
		}), 'session-tree: fork-inheritance route');
	});
}
