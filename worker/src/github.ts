import { OWNER, PROJECT_NUMBER } from './config';
import type { PriorityWrite, StatusWrite } from './rules';
import { makeRef, parseRef, type BoardItem, type ItemDetail } from './types';

/** A single-select field of the board with its options. */
export interface BoardField {
	id: string;
	name: string;
	options: { id: string; name: string }[];
}

/** The whole board: what a write needs to resolve ids, plus the items. */
export interface Board {
	projectId: string;
	fields: BoardField[];
	items: BoardItem[];
}

const HEADERS = (token: string) => ({ Authorization: `Bearer ${token}`, 'User-Agent': 'attask-worker' });

/** GitHub refused a request or reported errors. The message is GitHub's reason and never holds the token. */
export class GithubError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GithubError';
	}
}

/** The board lacks a field or option the Worker needs, so a write was refused before it was sent. */
export class BoardShapeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BoardShapeError';
	}
}

/** Runs one GraphQL request against GitHub and returns its `data`. Throws a `GithubError` if the request fails or GitHub reports errors. */
async function graphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
	const res = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: HEADERS(token),
		body: JSON.stringify({ query, variables }),
	});
	const json: any = await res.json().catch(() => null);
	if (!res.ok) throw new GithubError(`github returned ${res.status}: ${json?.message ?? res.statusText}`);
	if (json?.errors) throw new GithubError(`github returned: ${json.errors.map((e: { message: string }) => e.message).join('; ')}`);
	return json.data;
}

/** Runs one REST request against GitHub. Throws a `GithubError` with GitHub's message if it refuses. */
async function rest(token: string, method: string, path: string, body?: object): Promise<any> {
	const res = await fetch(`https://api.github.com${path}`, { method, headers: HEADERS(token), body: body ? JSON.stringify(body) : undefined });
	const json: any = res.status === 204 ? null : await res.json().catch(() => null);
	if (!res.ok) throw new GithubError(`github returned ${res.status}: ${json?.message ?? res.statusText}`);
	return json;
}

const QUERY = `
query($cursor: String) {
	user(login: "${OWNER}") {
		projectV2(number: ${PROJECT_NUMBER}) {
			id
			fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
			items(first: 100, after: $cursor) {
				pageInfo { hasNextPage endCursor }
				nodes {
					id updatedAt
					fieldValues(first: 20) {
						nodes {
							... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
							... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
						}
					}
					content {
						... on Issue {
							number title url state
							repository { nameWithOwner viewerPermission }
							labels(first: 20) { nodes { name } }
							parent { number repository { nameWithOwner } }
							issueDependenciesSummary { blockedBy }
						}
					}
				}
			}
		}
	}
}`;

/**
 * Turns one page of the board query into items and fields.
 *
 * Args:
 * 	data: The query's `data`.
 *
 * Returns:
 * 	The project id, its single-select fields, the page's issues (drafts and pull requests skipped), and the cursor of the next page or null.
 */
export function parsePage(data: any): { projectId: string; fields: BoardField[]; items: BoardItem[]; cursor: string | null } {
	const project = data.user.projectV2;
	// non single-select fields come back as empty objects
	const fields: BoardField[] = project.fields.nodes.filter((f: any) => f.options).map((f: any) => ({ id: f.id, name: f.name, options: f.options }));

	const items: BoardItem[] = [];
	for (const node of project.items.nodes) {
		const issue = node.content;
		if (!issue?.number) continue; // drafts and prs have no issue number

		const values: Record<string, string> = {};
		for (const fv of node.fieldValues.nodes) {
			if (fv.field) values[fv.field.name] = fv.name ?? fv.date;
		}
		const labels: string[] = issue.labels.nodes.map((l: { name: string }) => l.name);
		const repo: string = issue.repository.nameWithOwner;

		items.push({
			id: node.id,
			repo,
			number: issue.number,
			ref: makeRef(repo, issue.number),
			title: issue.title,
			url: issue.url,
			open: issue.state === 'OPEN',
			isProject: labels.includes('project'),
			parent: issue.parent ? makeRef(issue.parent.repository.nameWithOwner, issue.parent.number) : null,
			status: values['Status'] ?? null,
			area: values['Area'] ?? null,
			priority: values['Priority'] ?? null,
			size: values['Size'] ?? null,
			lab: labels.includes('lab'),
			due: values['Due'] ?? null,
			updatedAt: node.updatedAt,
			blocked: issue.issueDependenciesSummary.blockedBy > 0, // counts open blockers only
			canDelete: issue.repository.viewerPermission === 'ADMIN',
		});
	}

	const info = project.items.pageInfo;
	return { projectId: project.id, fields, items, cursor: info.hasNextPage ? info.endCursor : null };
}

/**
 * Finds a field option's ids by name. Never guesses.
 *
 * Args:
 * 	fields: The board's single-select fields.
 * 	field: Field name, e.g. `Status`.
 * 	option: Option name, e.g. `Backlog`.
 *
 * Returns:
 * 	The field id and option id.
 *
 * Raises:
 * 	BoardShapeError `board has no <field> field` or `board has no <field> option "<option>"`.
 */
export function resolveOption(fields: BoardField[], field: string, option: string): { fieldId: string; optionId: string } {
	const f = fields.find((x) => x.name === field);
	if (!f) throw new BoardShapeError(`board has no ${field} field`);
	const o = f.options.find((x) => x.name === option);
	if (!o) throw new BoardShapeError(`board has no ${field} option "${option}"`);
	return { fieldId: f.id, optionId: o.id };
}

/**
 * Fetches the whole board, following pagination.
 *
 * Args:
 * 	token: GitHub token with the `repo` and `project` scopes.
 */
export async function fetchBoard(token: string): Promise<Board> {
	const items: BoardItem[] = [];
	let cursor: string | null = null;
	while (true) {
		const page = parsePage(await graphql(token, QUERY, { cursor }));
		items.push(...page.items);
		if (page.cursor === null) return { projectId: page.projectId, fields: page.fields, items };
		cursor = page.cursor;
	}
}

// sets one single-select field on several items in one request; every id is resolved before anything is sent
async function setOptions(token: string, board: Board, field: string, writes: { id: string; option: string }[]): Promise<void> {
	if (writes.length === 0) return;
	const resolved = writes.map((w) => ({ id: w.id, ...resolveOption(board.fields, field, w.option) }));
	const mutations = resolved.map(
		(w, i) => `m${i}: updateProjectV2ItemFieldValue(input: {
			projectId: "${board.projectId}", itemId: "${w.id}", fieldId: "${w.fieldId}",
			value: { singleSelectOptionId: "${w.optionId}" }
		}) { clientMutationId }`,
	);
	await graphql(token, `mutation { ${mutations.join('\n')} }`, {});
}

// closes an issue with a reason
async function closeIssue(token: string, ref: string, reason: 'completed' | 'not_planned'): Promise<void> {
	const { repo, number } = parseRef(ref)!;
	await rest(token, 'PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: reason });
}

/**
 * Sets the Status of several items in one request, then closes the issues set to `Done` as completed.
 *
 * Args:
 * 	token: GitHub token.
 * 	board: The board, to resolve ids.
 * 	writes: The changes from `planStatus`.
 */
export async function writeStatuses(token: string, board: Board, writes: StatusWrite[]): Promise<void> {
	await setOptions(token, board, 'Status', writes.map((w) => ({ id: w.id, option: w.status })));
	for (const w of writes) if (w.status === 'Done') await closeIssue(token, w.ref, 'completed');
}

/**
 * Sets the Priority of one item.
 *
 * Args:
 * 	token: GitHub token.
 * 	board: The board, to resolve ids.
 * 	write: The change from `planPriority`.
 */
export async function writePriority(token: string, board: Board, write: PriorityWrite): Promise<void> {
	await setOptions(token, board, 'Priority', [{ id: write.id, option: write.priority }]);
}

/**
 * Fetches an issue's body and comments, rendered to HTML by GitHub.
 *
 * Args:
 * 	token: GitHub token.
 * 	repo: `owner/name`.
 * 	number: Issue number.
 */
export async function fetchDetail(token: string, repo: string, number: number): Promise<ItemDetail> {
	const [owner, name] = repo.split('/');
	const query = `
	query($owner: String!, $name: String!, $n: Int!) {
		repository(owner: $owner, name: $name) {
			issue(number: $n) {
				bodyHTML
				comments(first: 50) { nodes { createdAt bodyHTML } }
			}
		}
	}`;
	const issue = (await graphql(token, query, { owner, name, n: number })).repository.issue;
	return { bodyHtml: issue.bodyHTML, comments: issue.comments.nodes.map((c: any) => ({ createdAt: c.createdAt, bodyHtml: c.bodyHTML })) };
}

/**
 * Creates an issue in a repo, adds it to the board and sets its Status to Inbox. Fails before creating anything if the board has no Inbox option.
 *
 * Args:
 * 	token: GitHub token.
 * 	board: The board, for its id and fields.
 * 	repo: `owner/name`, already checked against `REPOS`.
 * 	title: Issue title.
 *
 * Returns:
 * 	The new issue's number and address.
 */
export async function createTask(token: string, board: Board, repo: string, title: string): Promise<{ number: number; url: string }> {
	resolveOption(board.fields, 'Status', 'Inbox');
	const issue = await rest(token, 'POST', `/repos/${repo}/issues`, { title });
	const added = await graphql(
		token,
		'mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }',
		{ p: board.projectId, c: issue.node_id },
	);
	await setOptions(token, board, 'Status', [{ id: added.addProjectV2ItemById.item.id, option: 'Inbox' }]);
	return { number: issue.number, url: issue.html_url };
}

/**
 * Permanently deletes an issue with its comments. Unlike closing, this cannot be undone, and the board item goes with it.
 *
 * Args:
 * 	token: GitHub token, which must have admin rights on the repo.
 * 	repo: `owner/name`.
 * 	number: Issue number.
 */
export async function deleteIssue(token: string, repo: string, number: number): Promise<void> {
	const [owner, name] = repo.split('/');
	const found = await graphql(token, 'query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { issue(number: $n) { id } } }', {
		o: owner,
		r: name,
		n: number,
	});
	await graphql(token, 'mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }', { id: found.repository.issue.id });
}

/**
 * Closes an issue as "not planned" and sets its Status to Done, so it drops off the open lists whether or not the board has a closing workflow.
 *
 * Args:
 * 	token: GitHub token.
 * 	board: The board, to resolve ids.
 * 	item: The task, already checked by `checkNotPlanned`.
 */
export async function closeNotPlanned(token: string, board: Board, item: BoardItem): Promise<void> {
	resolveOption(board.fields, 'Status', 'Done');
	await closeIssue(token, item.ref, 'not_planned');
	await setOptions(token, board, 'Status', [{ id: item.id, option: 'Done' }]);
}
