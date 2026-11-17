/**
 * Host half of the Session Tree bundle.
 *
 * The Web client half draws the tree; this half answers one read-only question the
 * browser cannot answer from projections: the exact fork-inherited event count of each
 * Session, plus its creation time. Raw turn seqs are unique inside one Session log only,
 * so a client-side alignment fallback cannot tell a child's own turn from an inherited
 * one when both happen to share the same seq and content. `inheritedEventCount` is exact,
 * and since DSH 0.2.2 forks ordinary Sessions without a `parentSession`, the creation
 * time is what lets the client rank candidate fork sources.
 *
 * Reads stay cheap: a live Session exposes both facts directly, a persisted Session is
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
		const factsOf = async (sessionId) => {
			const cached = cache.get(sessionId);
			if (cached !== undefined) return cached;
			const live = inner.sessions.get(sessionId);
			if (live !== undefined) {
				const facts = {
					inherited: Number(live.inheritedEventCount) || 0,
					createdAt: Number(live.header.createdAt) || 0,
				};
				cache.set(sessionId, facts);
				return facts;
			}
			let handle;
			try {
				const stat = await inner.sessionPersistence.stat(sessionId);
				if (stat === undefined) {
					cache.set(sessionId, null);
					return null;
				}
				if (typeof stat.sizeBytes === 'number' && stat.sizeBytes > MAX_COLD_BYTES) {
					cache.set(sessionId, null);
					return null;
				}
				handle = await inner.sessionPersistence.open(sessionId, 'read');
				const facts = {
					inherited: Number(handle.inheritedEventCount) || 0,
					createdAt: Number(handle.header.createdAt) || Number(stat.header.createdAt) || 0,
				};
				cache.set(sessionId, facts);
				return facts;
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
				const sessions = {};
				for (const sessionId of ids) sessions[sessionId] = await factsOf(sessionId);
				return new Response(JSON.stringify({ sessions }), {
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
