import { REPOS } from './config';
import { closeNotPlanned, createTask, deleteIssue, fetchBoard, fetchDetail, writePriority, writeStatuses } from './github';
import { parseIssuePath } from './paths';
import { checkDelete, checkNotPlanned, planPriority, planStatus } from './rules';
import { makeRef } from './types';

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	if (request.headers.get('Authorization') !== `Bearer ${env.APP_KEY}`) {
		return new Response('unauthorized', { status: 401 });
	}

	if (request.method === 'GET' && url.pathname === '/board') {
		return Response.json((await fetchBoard(env.GITHUB_TOKEN)).items);
	}

	const issue = parseIssuePath(url.pathname);
	if (issue) {
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const item = board.items.find((i) => i.ref === makeRef(issue.repo, issue.number));

		if (request.method === 'GET' && issue.action === 'detail') {
			if (!item) return new Response('not found', { status: 404 });
			return Response.json(await fetchDetail(env.GITHUB_TOKEN, issue.repo, issue.number));
		}
		if (request.method === 'POST' && issue.action === 'not-planned') {
			const refusal = checkNotPlanned(item);
			if (refusal) return Response.json({ error: refusal }, { status: 409 });
			await closeNotPlanned(env.GITHUB_TOKEN, board, item!);
			return new Response(null, { status: 204 });
		}
		if (request.method === 'DELETE' && issue.action === '') {
			const refusal = checkDelete(item);
			if (refusal) return Response.json({ error: refusal }, { status: 409 });
			await deleteIssue(env.GITHUB_TOKEN, issue.repo, issue.number);
			return new Response(null, { status: 204 });
		}
	}

	const edit = url.pathname.match(/^\/items\/([\w-]+)\/status$/);
	if (request.method === 'POST' && edit) {
		const body: { status?: unknown } = await request.json();
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planStatus(board.items, edit[1], String(body.status));
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		await writeStatuses(env.GITHUB_TOKEN, board, plan.writes);
		return Response.json({ writes: plan.writes });
	}

	const prio = url.pathname.match(/^\/items\/([\w-]+)\/priority$/);
	if (request.method === 'POST' && prio) {
		const body: { priority?: unknown } = await request.json();
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planPriority(board.items, prio[1], String(body.priority));
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		if (plan.write) await writePriority(env.GITHUB_TOKEN, board, plan.write);
		return Response.json({ priority: plan.write?.priority ?? null });
	}

	if (request.method === 'POST' && url.pathname === '/tasks') {
		const body: { title?: unknown; repo?: unknown } = await request.json();
		const title = typeof body.title === 'string' ? body.title.trim() : '';
		if (!title) return Response.json({ error: 'title is empty' }, { status: 400 });
		const repo = String(body.repo);
		if (!REPOS.includes(repo)) return Response.json({ error: `${repo} is not in the repo list` }, { status: 400 });
		return Response.json(await createTask(env.GITHUB_TOKEN, await fetchBoard(env.GITHUB_TOKEN), repo, title));
	}

	return new Response('not found', { status: 404 });
}

export default {
	async fetch(request, env): Promise<Response> {
		const origin = request.headers.get('Origin') ?? '';
		const allowed = env.ALLOWED_ORIGINS.split(',').includes(origin);

		// the browser sends an OPTIONS "preflight" first because of the Authorization header
		// a missing board field or option, or github refusing a write, is a refusal the app shows, not a crash
		const res =
			request.method === 'OPTIONS'
				? new Response(null, { status: 204 })
				: await route(request, env).catch((e: unknown) => {
						const message = e instanceof Error ? e.message : String(e);
						if (message.startsWith('board has no') || message.startsWith('github returned')) {
							return Response.json({ error: message }, { status: 409 });
						}
						throw e;
					});

		const out = new Response(res.body, res); // copy so the headers can be changed
		if (allowed) {
			out.headers.set('Access-Control-Allow-Origin', origin);
			out.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
			out.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
		}
		return out;
	},
} satisfies ExportedHandler<Env>;
