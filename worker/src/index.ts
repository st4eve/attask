import Anthropic from '@anthropic-ai/sdk';
import { REPOS } from './config';
import {
	BoardShapeError,
	GithubError,
	addSubIssue,
	closeNotPlanned,
	createTask,
	deleteIssue,
	fetchBoard,
	fetchDetail,
	writeFields,
	writePriority,
	writeStatuses,
} from './github';
import { parseIssuePath } from './paths';
import { checkDelete, checkNotPlanned, planFields, planParent, planPriority, planStatus } from './rules';
import { TriageError, claudeAsker, runTriage } from './triage';
import { makeRef } from './types';

/**
 * Reads a request body as a JSON object.
 *
 * Args:
 * 	request: The incoming request.
 *
 * Returns:
 * 	The parsed object, or null if the body is not valid JSON or not a plain object.
 */
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body: unknown = await request.json();
		return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	// an unset key would make `Bearer undefined` a valid login
	if (!env.APP_KEY) return Response.json({ error: 'worker not configured' }, { status: 500 });
	if (request.headers.get('Authorization') !== `Bearer ${env.APP_KEY}`) {
		return new Response('unauthorized', { status: 401 });
	}

	if (request.method === 'GET' && url.pathname === '/board') {
		return Response.json((await fetchBoard(env.GITHUB_TOKEN)).items);
	}

	// only the three issue routes are served; anything else falls through to 404 without touching github
	const issue = parseIssuePath(url.pathname);
	const supported =
		(request.method === 'GET' && issue?.action === 'detail') ||
		(request.method === 'POST' && issue?.action === 'not-planned') ||
		(request.method === 'DELETE' && issue?.action === '');
	if (issue && supported) {
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const item = board.items.find((i) => i.ref === makeRef(issue.repo, issue.number));

		if (request.method === 'GET' && issue.action === 'detail') {
			if (!item) return Response.json({ error: 'not on the board' }, { status: 404 });
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
		const body = await readJson(request);
		if (!body) return Response.json({ error: 'body is not valid JSON' }, { status: 400 });
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planStatus(board.items, edit[1], String(body.status));
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		await writeStatuses(env.GITHUB_TOKEN, board, plan.writes);
		return Response.json({ writes: plan.writes });
	}

	const prio = url.pathname.match(/^\/items\/([\w-]+)\/priority$/);
	if (request.method === 'POST' && prio) {
		const body = await readJson(request);
		if (!body) return Response.json({ error: 'body is not valid JSON' }, { status: 400 });
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planPriority(board.items, prio[1], String(body.priority));
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		if (plan.write) await writePriority(env.GITHUB_TOKEN, board, plan.write);
		return Response.json({ priority: plan.write?.priority ?? null });
	}

	const fields = url.pathname.match(/^\/items\/([\w-]+)\/fields$/);
	if (request.method === 'POST' && fields) {
		const body = await readJson(request);
		if (!body) return Response.json({ error: 'body is not valid JSON' }, { status: 400 });
		// a key that is absent or not a string leaves that field alone
		const change = {
			area: typeof body.area === 'string' ? body.area : undefined,
			size: typeof body.size === 'string' ? body.size : undefined,
		};
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planFields(board.items, board.fields, fields[1], change);
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		await writeFields(env.GITHUB_TOKEN, board, plan.writes);
		return Response.json({ writes: plan.writes });
	}

	const link = url.pathname.match(/^\/items\/([\w-]+)\/parent$/);
	if (request.method === 'POST' && link) {
		const body = await readJson(request);
		if (!body) return Response.json({ error: 'body is not valid JSON' }, { status: 400 });
		const board = await fetchBoard(env.GITHUB_TOKEN);
		const plan = planParent(board.items, link[1], String(body.parent));
		if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });
		if (plan.write) await addSubIssue(env.GITHUB_TOKEN, plan.write);
		return Response.json({ parent: plan.write?.parent ?? null });
	}

	if (request.method === 'POST' && url.pathname === '/triage') {
		if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'triage is not set up' }, { status: 500 });
		const board = await fetchBoard(env.GITHUB_TOKEN);
		return Response.json(await runTriage(board, claudeAsker(env.ANTHROPIC_API_KEY)));
	}

	if (request.method === 'POST' && url.pathname === '/tasks') {
		const body = await readJson(request);
		if (!body) return Response.json({ error: 'body is not valid JSON' }, { status: 400 });
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
		// a missing board field or option, or github refusing a write, is a refusal the app shows; anything else is a fixed 500 so no detail leaks
		const res =
			request.method === 'OPTIONS'
				? new Response(null, { status: 204 })
				: await route(request, env).catch((e: unknown) => {
						if (e instanceof GithubError || e instanceof BoardShapeError) return Response.json({ error: e.message }, { status: 409 });
						// claude declined, answered badly, or the api failed after the sdk's own retries
						if (e instanceof TriageError || e instanceof Anthropic.APIError) return Response.json({ error: e.message }, { status: 502 });
						console.error('unhandled error', e instanceof Error ? e.name : 'unknown');
						return Response.json({ error: 'internal error' }, { status: 500 });
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
