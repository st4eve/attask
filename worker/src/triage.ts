import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Board, BoardField } from './github';
import { PAUSED_STATUSES, type BoardItem, type Proposal, type TriageOptions } from './types';

/** The Claude model triage runs on. Sonnet 5.5 or Haiku 5.5 would also work; changing this line is enough. */
export const MODEL = 'claude-opus-5-5';

/** What Claude must answer. Fields are plain strings because Area options live on the board, so the Worker checks them afterwards. */
export const TriageSchema = z.object({
	proposals: z.array(
		z.object({
			id: z.string(),
			ref: z.string(),
			area: z.string().nullable(),
			size: z.string().nullable(),
			priority: z.string().nullable(),
			status: z.string(),
			parent: z.string().nullable(),
			reason: z.string(),
		}),
	),
});

/** One proposal as Claude sent it, before `validateProposals`. */
export type RawProposal = z.infer<typeof TriageSchema>['proposals'][number];

/** The board rules Claude triages by. */
export const SYSTEM = `You triage the inbox of a personal task board. For every task in "tasks", return one proposal with its "id" and "ref" copied exactly.
- area: the life area it belongs to, one of options.area.
- size: rough effort, one of options.size (XS is minutes, XL is days).
- priority: one of options.priority, P0 most urgent; most tasks are P1 or P2.
- status: "To do" if it should be done soon, "Backlog" if it can wait.
- parent: the ref of a project in "projects" the task clearly belongs to, else null. Only use listed refs. A task of a project in Backlog or Waiting takes that project's status.
- reason: one short sentence the owner reads, saying why.
Leave a value null when you are unsure. Tasks labelled lab are done at the lab.`;

/** What the Worker sends Claude as the user message, as JSON. */
export interface TriageRequest {
	options: TriageOptions;
	projects: { ref: string; title: string; status: string | null; area: string | null }[];
	tasks: { id: string; ref: string; title: string; area: string | null; size: string | null; priority: string | null; lab: boolean }[];
}

// open, non-project items still in the inbox
function inboxTasks(items: BoardItem[]): BoardItem[] {
	return items.filter((i) => i.open && !i.isProject && i.status === 'Inbox');
}

/**
 * The option names of the fields triage sets.
 *
 * Args:
 * 	fields: The board's single-select fields.
 *
 * Returns:
 * 	Area, Size and Priority option names in board order; an empty list for a field the board lacks.
 */
export function boardOptions(fields: BoardField[]): TriageOptions {
	const names = (field: string) => fields.find((f) => f.name === field)?.options.map((o) => o.name) ?? [];
	return { area: names('Area'), size: names('Size'), priority: names('Priority') };
}

/**
 * Builds what Claude sees: the options, open projects and open Inbox tasks. Titles only, no bodies or comments.
 *
 * Args:
 * 	items: The whole board.
 * 	fields: The board's single-select fields.
 */
export function buildTriageRequest(items: BoardItem[], fields: BoardField[]): TriageRequest {
	return {
		options: boardOptions(fields),
		projects: items.filter((i) => i.isProject && i.open).map((p) => ({ ref: p.ref, title: p.title, status: p.status, area: p.area })),
		tasks: inboxTasks(items).map((t) => ({
			id: t.id,
			ref: t.ref,
			title: t.title,
			area: t.area,
			size: t.size,
			priority: t.priority,
			lab: t.lab,
		})),
	};
}

/**
 * Checks Claude's proposals against the board so only safe ones reach the user.
 *
 * Args:
 * 	raw: Claude's proposals.
 * 	items: The whole board.
 * 	fields: The board's single-select fields.
 *
 * Returns:
 * 	One proposal per open Inbox task Claude answered for, first one wins: unknown options and parents nulled, status made to obey a paused parent, reason cut to 140 characters.
 */
export function validateProposals(raw: RawProposal[], items: BoardItem[], fields: BoardField[]): Proposal[] {
	const tasks = inboxTasks(items);
	const options = boardOptions(fields);
	const pick = (value: string | null, allowed: string[]) => (value !== null && allowed.includes(value) ? value : null);
	const seen = new Set<string>();
	const out: Proposal[] = [];

	for (const p of raw) {
		const task = tasks.find((t) => t.id === p.id);
		if (!task || seen.has(p.id)) continue;
		seen.add(p.id);

		const project = items.find((i) => i.isProject && i.open && i.ref === p.parent);
		let status: Proposal['status'] = p.status === 'To do' ? 'To do' : 'Backlog';
		// a paused project's tasks take its status, the only way Waiting appears
		if (project?.status && PAUSED_STATUSES.includes(project.status)) status = project.status as 'Backlog' | 'Waiting';

		out.push({
			id: task.id,
			ref: task.ref,
			area: pick(p.area, options.area),
			size: pick(p.size, options.size),
			priority: pick(p.priority, options.priority),
			status,
			parent: project ? project.ref : null,
			reason: p.reason.slice(0, 140),
		});
	}
	return out;
}

/** Claude declined or answered something unreadable. The route answers 502 with the message. */
export class TriageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TriageError';
	}
}

/** Asks Claude for proposals. `refused` is true when Claude declined; `proposals` is null when the answer did not match the schema. */
export type Ask = (request: TriageRequest) => Promise<{ refused: boolean; proposals: RawProposal[] | null }>;

/**
 * The real call to Claude, with server-side fallback so a capacity error or decline on the primary model is retried on a fallback model by Anthropic.
 *
 * Args:
 * 	apiKey: The Worker's `ANTHROPIC_API_KEY`.
 */
export function claudeAsker(apiKey: string): Ask {
	const client = new Anthropic({ apiKey });
	return async (request) => {
		const res = await client.beta.messages.parse({
			model: MODEL,
			max_tokens: 16000,
			betas: ['server-side-fallback-2026-07-01'],
			fallbacks: 'default',
			system: SYSTEM,
			messages: [{ role: 'user', content: JSON.stringify(request) }],
			output_config: { effort: 'low', format: betaZodOutputFormat(TriageSchema) },
		});
		return { refused: res.stop_reason === 'refusal', proposals: res.parsed_output?.proposals ?? null };
	};
}

/**
 * Triage of the whole inbox. Writes nothing.
 *
 * Args:
 * 	board: The board, freshly fetched.
 * 	ask: How to reach Claude, `claudeAsker` outside tests.
 *
 * Returns:
 * 	The checked proposals, plus the option names the review list offers.
 *
 * Raises:
 * 	TriageError when Claude declines or its answer can't be read.
 */
export async function runTriage(board: Board, ask: Ask): Promise<{ proposals: Proposal[]; options: TriageOptions }> {
	const request = buildTriageRequest(board.items, board.fields);
	if (request.tasks.length === 0) return { proposals: [], options: request.options };
	const answer = await ask(request);
	if (answer.refused) throw new TriageError('Claude declined to triage this inbox');
	if (!answer.proposals) throw new TriageError("Claude's answer could not be read");
	return { proposals: validateProposals(answer.proposals, board.items, board.fields), options: request.options };
}
