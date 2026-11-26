# Inbox triage in the Worker: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Inbox page's "triage inbox" button asks the Worker for one triage proposal per Inbox task, shows them for review (apply, edit, skip, apply all), and writes only what the user approves.

**Architecture:** The Worker adds three routes. `POST /triage` reads the board, sends Claude the option lists, open projects and Inbox task titles, validates what comes back against the board, and returns proposals without writing anything. `POST /items/<id>/fields` (Area, Size) and `POST /items/<id>/parent` (add a sub-issue) are the two writes the app cannot make yet; Status and Priority keep their routes. Pure parts (rules, prompt building, validation, the app's row helpers) are separate from network calls so vitest covers them without the network.

**Tech Stack:** Cloudflare Workers + TypeScript + vitest (`@cloudflare/vitest-plugin`), `@anthropic-ai/sdk` 1.x + `zod` 4.x. Vite + Svelte 5 runes + TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-25-inbox-triage-design.md`

## Global Constraints

- The repo is public. Never commit tokens, keys or real task content. Fixtures and test data use invented titles and ids.
- Never put a token, app key or Anthropic key in a command that gets logged, a commit, or an issue comment. The owner sets `ANTHROPIC_API_KEY` with `npx wrangler secret put ANTHROPIC_API_KEY` at the hidden prompt; locally it goes in the git-ignored `worker/.dev.vars`.
- Test every write on a throwaway issue titled `attask test – delete me` in `st4eve/MyLife`, never on real items, then delete it after confirming with the user.
- Work on `spec/inbox-triage` (PR st4eve/attask#3). Run `gh repo set-default st4eve/attask` first and pass `--repo st4eve/attask` to gh. Never commit on or push to `main`, never merge, never push to or open PRs against `jewaniuk/attask`. Don't touch the MyLife lab-notebooks checkout.
- Field and option ids are resolved by name on each request, never hard-coded.
- Model `claude-opus-5-5`, `max_tokens: 16000`, no `thinking` field, `output_config: { effort: 'low', format: betaZodOutputFormat(TriageSchema) }`, through `client.beta.messages.parse` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`. The model id is one exported constant, `MODEL`, in `worker/src/triage.ts`.
- Claude receives option names, open projects as `{ ref, title, status, area }` and Inbox tasks as `{ id, ref, title, area, size, priority, lab }`. No bodies, comments or closed items.
- Errors: `GithubError`/`BoardShapeError` → 409; refusal, null `parsed_output` or an Anthropic API error → 502 with a short message; no `ANTHROPIC_API_KEY` → 500 `triage is not set up`; anything else → 500 `internal error`.
- `worker/src/types.ts` and `worker/src/config.ts` are imported by the app, so they hold no Worker-only code (no SDK or zod imports).
- Style: Worker uses tabs and single quotes. App uses 4-space indent and double quotes, except `app/src/lib/api.ts`, which uses 2 spaces. Inline comments lowercase. Every export gets a `/** */` doc with `Args:` / `Returns:` where they add something. No `any` except raw GraphQL/REST responses in `worker/src/github.ts`.
- Gate, all must pass before pushing: `cd app && npm run check`; `cd app && npx vitest run`; `cd worker && npm run cf-typegen && npx tsc --noEmit`; `cd worker && npx vitest run --passWithNoTests`.

## Refinements of the spec

The plan makes these decisions the spec leaves open or gets slightly wrong. Task 7 writes the first three into the spec so the two documents agree.

1. `POST /triage` returns `{ proposals, options }`, where `options` is `{ area: string[]; size: string[]; priority: string[] }` read from the board. The review list's edit menus need the board's Area options, and the app has no other way to get them (`GET /board` returns items only).
2. `planParent` treats a request for the parent an item already has as a no-op (`write: null`) rather than a refusal. It still refuses a *different* parent. Without this, a row whose parent write succeeded but whose later status write failed could never be retried (see Review Focus 3).
3. The spec says `planStatus` refuses a status that conflicts with a paused parent. It does not for an Inbox item: `allowedStatuses` lets an Inbox item take any task status. So the cascade rule is enforced where proposals are made: `validateProposals` (Task 3) on the Worker and `statusChoices`/`setParent` (Task 5) in the review list. `planStatus` is left unchanged, so moving Inbox items by hand behaves as before.
4. Signatures: `planFields` and `validateProposals` take the board's `fields: BoardField[]` instead of the whole `Board`, since that is all they read and it keeps the tests small. `addSubIssue` takes the planned `ParentWrite` (Task 2).

## Review Focus

1. **A proposal for an item that is not an open Inbox task** (a project issue, a task the user moved out of Inbox while triage ran, an id Claude made up) is dropped, never returned. Test: `validateProposals` "drops ids that are not open inbox tasks" in Task 3.
2. **Same issue number in two repos as the parent** (`st4eve/MyLife#1` and `QNLQueens/WickedIdeas#1`): the proposal and the write use the exact ref, and a paused project in one repo never changes the status for a parent in the other. Tests: `planParent` "matches the parent by full ref" in Task 1, `validateProposals` "uses the paused status of the right repo's project" in Task 3.
3. **Retrying a row after a partial apply** (parent linked, then the status write failed): the second press must go through, not stop at "already has a parent". Test: `planParent` "is a no-op for the parent the item already has" in Task 1.
4. **The user picks a paused project while editing a row**: the row's status follows the project (Backlog or Waiting) and the status menu offers only that; picking an active project or none brings back To do and Backlog. Tests: `setParent` and `statusChoices` in Task 5.
5. **Empty inbox**: `/triage` returns `{ proposals: [] }` without calling Claude, so pressing the button costs nothing. Test: `runTriage` "does not call Claude when the inbox is empty" in Task 4.

---

### Task 1: Board rules for fields and parent

**Files:**
- Modify: `worker/src/rules.ts` (append)
- Test: `worker/test/rules.test.ts` (append)

**Interfaces:**
- Consumes: `BoardItem` from `types.ts`; `BoardField` from `github.ts` (type-only import).
- Produces, in `rules.ts`:
  - `FieldWrite { id: string; ref: string; field: 'Area' | 'Size'; option: string }`
  - `FieldPlan = { ok: true; writes: FieldWrite[] } | { ok: false; reason: string }`
  - `planFields(items: BoardItem[], fields: BoardField[], id: string, change: { area?: string; size?: string }): FieldPlan`
  - `ParentWrite { id: string; ref: string; parent: string }`
  - `ParentPlan = { ok: true; write: ParentWrite | null } | { ok: false; reason: string }`
  - `planParent(items: BoardItem[], id: string, parent: string): ParentPlan`

- [ ] **Step 1: Write the failing tests**

Change the first import of `worker/test/rules.test.ts` to:

```ts
import { checkDelete, checkNotPlanned, planFields, planParent, planPriority, planStatus } from '../src/rules';
import type { BoardField } from '../src/github';
```

Append to `worker/test/rules.test.ts` (it reuses the file's `item` helper, `board`, `OTHER` and `id`):

```ts
const fields: BoardField[] = [
	{ id: 'F_area', name: 'Area', options: [{ id: 'o_res', name: 'Research' }, { id: 'o_per', name: 'Personal' }] },
	{ id: 'F_size', name: 'Size', options: [{ id: 'o_s', name: 'S' }, { id: 'o_m', name: 'M' }] },
];

describe('planFields', () => {
	const items = [item({ number: 30, status: 'Inbox', area: 'Research', size: null }), item({ number: 31, status: 'Inbox', open: false })];

	it('writes only the fields that change', () => {
		expect(planFields(items, fields, id('st4eve/MyLife', 30), { area: 'Research', size: 'M' })).toEqual({
			ok: true,
			writes: [{ id: id('st4eve/MyLife', 30), ref: 'st4eve/MyLife#30', field: 'Size', option: 'M' }],
		});
	});
	it('writes nothing when both already match', () => {
		expect(planFields(items, fields, id('st4eve/MyLife', 30), { area: 'Research' })).toEqual({ ok: true, writes: [] });
	});
	it('refuses a missing or closed item', () => {
		expect(planFields(items, fields, 'nope', { size: 'S' })).toEqual({ ok: false, reason: 'no such item' });
		expect(planFields(items, fields, id('st4eve/MyLife', 31), { size: 'S' })).toEqual({ ok: false, reason: 'st4eve/MyLife#31 is closed' });
	});
	it('refuses a value that is not an option of its field', () => {
		expect(planFields(items, fields, id('st4eve/MyLife', 30), { area: 'research' })).toEqual({ ok: false, reason: 'research is not an Area option' });
		expect(planFields(items, fields, id('st4eve/MyLife', 30), { size: 'XL' })).toEqual({ ok: false, reason: 'XL is not a Size option' });
	});
});

describe('planParent', () => {
	const items = [
		item({ number: 1, isProject: true, status: 'In progress' }),
		item({ number: 1, repo: OTHER, isProject: true, status: 'Waiting' }),
		item({ number: 2, isProject: true, status: 'Done', open: false }),
		item({ number: 40, status: 'Inbox' }),
		item({ number: 41, status: 'Inbox', parent: 'st4eve/MyLife#1' }),
		item({ number: 42, status: 'Inbox', open: false }),
	];
	const task = id('st4eve/MyLife', 40);

	it('plans the link to an open project', () => {
		expect(planParent(items, task, 'st4eve/MyLife#1')).toEqual({ ok: true, write: { id: task, ref: 'st4eve/MyLife#40', parent: 'st4eve/MyLife#1' } });
	});
	it('matches the parent by full ref', () => {
		expect(planParent(items, task, `${OTHER}#1`)).toEqual({ ok: true, write: { id: task, ref: 'st4eve/MyLife#40', parent: `${OTHER}#1` } });
		expect(planParent(items, task, 'st4eve/Other#1')).toEqual({ ok: false, reason: 'st4eve/Other#1 is not an open project on the board' });
	});
	it('is a no-op for the parent the item already has', () => {
		expect(planParent(items, id('st4eve/MyLife', 41), 'st4eve/MyLife#1')).toEqual({ ok: true, write: null });
	});
	it('refuses a different parent when one is set', () => {
		expect(planParent(items, id('st4eve/MyLife', 41), `${OTHER}#1`)).toEqual({ ok: false, reason: 'st4eve/MyLife#41 already has a parent' });
	});
	it('refuses a missing, closed or project item', () => {
		expect(planParent(items, 'nope', 'st4eve/MyLife#1')).toEqual({ ok: false, reason: 'no such item' });
		expect(planParent(items, id('st4eve/MyLife', 42), 'st4eve/MyLife#1')).toEqual({ ok: false, reason: 'st4eve/MyLife#42 is closed' });
		expect(planParent(items, id('st4eve/MyLife', 1), `${OTHER}#1`)).toEqual({ ok: false, reason: 'st4eve/MyLife#1 is a project' });
	});
	it('refuses a closed project or a plain task as the parent', () => {
		expect(planParent(items, task, 'st4eve/MyLife#2')).toEqual({ ok: false, reason: 'st4eve/MyLife#2 is not an open project on the board' });
		expect(planParent(items, task, 'st4eve/MyLife#41')).toEqual({ ok: false, reason: 'st4eve/MyLife#41 is not an open project on the board' });
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/rules.test.ts`
Expected: FAIL, `planFields` and `planParent` are not exported.

- [ ] **Step 3: Implement**

Add to the top of `worker/src/rules.ts`:

```ts
import type { BoardField } from './github';
```

Append to `worker/src/rules.ts`:

```ts
/** One Area or Size write the Worker must make on the board. */
export interface FieldWrite {
	/** project item id */
	id: string;
	ref: string;
	field: 'Area' | 'Size';
	/** option name, checked against the board */
	option: string;
}

/** What the Worker should do for a fields request: the writes (empty if nothing changes), or why it refuses. */
export type FieldPlan = { ok: true; writes: FieldWrite[] } | { ok: false; reason: string };

/**
 * Plans an Area and Size change for an open item.
 *
 * Args:
 * 	items: The whole board.
 * 	fields: The board's single-select fields, to check option names.
 * 	id: Project item id of the item to change.
 * 	change: The requested values; a missing key leaves that field alone.
 *
 * Returns:
 * 	The writes for the fields that differ, or a refusal with the reason.
 */
export function planFields(items: BoardItem[], fields: BoardField[], id: string, change: { area?: string; size?: string }): FieldPlan {
	const item = find(items, id);
	if (!item) return { ok: false, reason: 'no such item' };
	if (!item.open) return { ok: false, reason: `${item.ref} is closed` };

	const writes: FieldWrite[] = [];
	const wanted: ['Area' | 'Size', string | undefined, string | null][] = [
		['Area', change.area, item.area],
		['Size', change.size, item.size],
	];
	for (const [field, option, current] of wanted) {
		if (option === undefined) continue;
		const known = fields.find((f) => f.name === field)?.options.some((o) => o.name === option);
		if (!known) return { ok: false, reason: `${option} is not a ${field} option` };
		if (option !== current) writes.push({ id: item.id, ref: item.ref, field, option });
	}
	return { ok: true, writes };
}

/** The sub-issue link the Worker must add. */
export interface ParentWrite {
	/** project item id of the task */
	id: string;
	/** the task's ref */
	ref: string;
	/** the project's ref */
	parent: string;
}

/** What the Worker should do for a parent request: the write (null if the item already has that parent), or why it refuses. */
export type ParentPlan = { ok: true; write: ParentWrite | null } | { ok: false; reason: string };

/**
 * Plans adding a task as a sub-issue of a project. Changing or removing a parent is out of scope, so an item with a different parent is refused; asking again for the parent it already has is a no-op, so a half-applied triage row can be retried.
 *
 * Args:
 * 	items: The whole board.
 * 	id: Project item id of the task.
 * 	parent: Ref of the project, `owner/name#n`.
 *
 * Returns:
 * 	The write, null if nothing changes, or a refusal with the reason.
 */
export function planParent(items: BoardItem[], id: string, parent: string): ParentPlan {
	const item = find(items, id);
	if (!item) return { ok: false, reason: 'no such item' };
	if (!item.open) return { ok: false, reason: `${item.ref} is closed` };
	if (item.isProject) return { ok: false, reason: `${item.ref} is a project` };
	if (item.parent === parent) return { ok: true, write: null };
	if (item.parent !== null) return { ok: false, reason: `${item.ref} already has a parent` };
	if (!items.some((i) => i.isProject && i.open && i.ref === parent)) {
		return { ok: false, reason: `${parent} is not an open project on the board` };
	}
	return { ok: true, write: { id: item.id, ref: item.ref, parent } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/rules.test.ts`
Expected: PASS, all `rules.test.ts` tests including the old ones.

- [ ] **Step 5: Commit**

```bash
git add worker/src/rules.ts worker/test/rules.test.ts
git commit -m "feat(worker): board rules for area, size and parent writes"
```

---

### Task 2: GitHub writes and the two write routes

**Files:**
- Modify: `worker/src/github.ts` (add `issueNodeId`, `writeFields`, `addSubIssue`; make `deleteIssue` use `issueNodeId`)
- Modify: `worker/src/index.ts` (two routes)
- Test: `worker/test/github.test.ts` (append)

**Interfaces:**
- Consumes: `FieldWrite`, `ParentWrite`, `planFields`, `planParent` from Task 1.
- Produces:
  - `writeFields(token: string, board: Board, writes: FieldWrite[]): Promise<void>`
  - `addSubIssue(token: string, write: ParentWrite): Promise<void>`
  - `POST /items/<id>/fields`, body `{ area?: string; size?: string }`, answers `{ writes: FieldWrite[] }`
  - `POST /items/<id>/parent`, body `{ parent: string }`, answers `{ parent: string | null }` (null when nothing changed)

The spec names `addSubIssue(token, item, parent)`. Passing the planned `ParentWrite` carries the same two refs and keeps it shaped like `writePriority`.

- [ ] **Step 1: Write the failing tests**

Change the import line of `worker/test/github.test.ts` to:

```ts
import { GithubError, addSubIssue, fetchDetail, parsePage, resolveOption, writeFields, type Board } from '../src/github';
```

Append:

```ts
describe('writes', () => {
	afterEach(() => vi.unstubAllGlobals());

	// records each graphql body and answers with canned data in order
	function stub(answers: object[]): { query: string; variables: Record<string, unknown> }[] {
		const sent: { query: string; variables: Record<string, unknown> }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				sent.push(JSON.parse(String(init.body)));
				return Response.json({ data: answers[sent.length - 1] });
			}),
		);
		return sent;
	}

	const board: Board = {
		projectId: 'PVT_test',
		items: [],
		fields: [
			{ id: 'F_area', name: 'Area', options: [{ id: 'o_res', name: 'Research' }] },
			{ id: 'F_size', name: 'Size', options: [{ id: 'o_m', name: 'M' }] },
		],
	};

	it('sets area and size with the resolved ids, one request per field', async () => {
		const sent = stub([{}, {}]);
		await writeFields('placeholder', board, [
			{ id: 'I1', ref: 'a/b#1', field: 'Area', option: 'Research' },
			{ id: 'I1', ref: 'a/b#1', field: 'Size', option: 'M' },
		]);
		expect(sent).toHaveLength(2);
		expect(sent[0].query).toContain('fieldId: "F_area"');
		expect(sent[0].query).toContain('singleSelectOptionId: "o_res"');
		expect(sent[1].query).toContain('fieldId: "F_size"');
	});

	it('refuses an unknown option before sending anything', async () => {
		const sent = stub([]);
		await expect(writeFields('placeholder', board, [{ id: 'I1', ref: 'a/b#1', field: 'Size', option: 'XL' }])).rejects.toThrow('board has no Size option "XL"');
		expect(sent).toHaveLength(0);
	});

	it('links a sub-issue across repos by node id', async () => {
		const sent = stub([{ repository: { issue: { id: 'PARENT' } } }, { repository: { issue: { id: 'CHILD' } } }, { addSubIssue: { issue: { number: 1 } } }]);
		await addSubIssue('placeholder', { id: 'I1', ref: 'Shastri-Lab/polymerNN#7', parent: 'st4eve/MyLife#1' });
		expect(sent[0].variables).toEqual({ o: 'st4eve', r: 'MyLife', n: 1 });
		expect(sent[1].variables).toEqual({ o: 'Shastri-Lab', r: 'polymerNN', n: 7 });
		expect(sent[2].query).toContain('addSubIssue');
		expect(sent[2].variables).toEqual({ parent: 'PARENT', child: 'CHILD' });
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/github.test.ts`
Expected: FAIL, `writeFields` and `addSubIssue` are not exported.

- [ ] **Step 3: Implement in `github.ts`**

Change the rules import to:

```ts
import type { FieldWrite, ParentWrite, PriorityWrite, StatusWrite } from './rules';
```

Add after `writePriority`:

```ts
/**
 * Sets Area and Size on one item, one request per field.
 *
 * Args:
 * 	token: GitHub token.
 * 	board: The board, to resolve ids.
 * 	writes: The changes from `planFields`.
 */
export async function writeFields(token: string, board: Board, writes: FieldWrite[]): Promise<void> {
	for (const w of writes) resolveOption(board.fields, w.field, w.option); // refuse before writing anything
	for (const field of ['Area', 'Size'] as const) {
		await setOptions(token, board, field, writes.filter((w) => w.field === field).map((w) => ({ id: w.id, option: w.option })));
	}
}

// the GraphQL node id of an issue, which mutations take instead of owner/name#n
async function issueNodeId(token: string, ref: string): Promise<string> {
	const { repo, number } = parseRef(ref)!;
	const [owner, name] = repo.split('/');
	const found = await graphql(token, 'query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { issue(number: $n) { id } } }', {
		o: owner,
		r: name,
		n: number,
	});
	return found.repository.issue.id;
}

/**
 * Adds a task as a sub-issue of a project. GitHub allows the two to be in different repos of the same owner.
 *
 * Args:
 * 	token: GitHub token.
 * 	write: The link from `planParent`.
 */
export async function addSubIssue(token: string, write: ParentWrite): Promise<void> {
	const parent = await issueNodeId(token, write.parent);
	const child = await issueNodeId(token, write.ref);
	await graphql(token, 'mutation($parent: ID!, $child: ID!) { addSubIssue(input: { issueId: $parent, subIssueId: $child }) { issue { number } } }', {
		parent,
		child,
	});
}
```

Replace the body of `deleteIssue` with:

```ts
	const id = await issueNodeId(token, makeRef(repo, number));
	await graphql(token, 'mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }', { id });
```

`issueNodeId` must be declared before `deleteIssue` is called at runtime; function declarations are hoisted, so its position in the file does not matter.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/github.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the routes in `index.ts`**

Change the imports:

```ts
import { BoardShapeError, GithubError, addSubIssue, closeNotPlanned, createTask, deleteIssue, fetchBoard, fetchDetail, writeFields, writePriority, writeStatuses } from './github';
import { checkDelete, checkNotPlanned, planFields, planParent, planPriority, planStatus } from './rules';
```

Add after the priority route:

```ts
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
```

- [ ] **Step 6: Typecheck and run all Worker tests**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/github.ts worker/src/index.ts worker/test/github.test.ts
git commit -m "feat(worker): routes to set area, size and parent"
```

---

### Task 3: Proposal type, triage request and validation

**Files:**
- Modify: `worker/src/types.ts` (append `Proposal`, `TriageOptions`)
- Create: `worker/src/triage.ts` (pure parts only in this task)
- Create: `worker/test/triage.test.ts`
- Modify: `worker/package.json` (dependencies, via npm)

**Interfaces:**
- Consumes: `BoardItem`, `PAUSED_STATUSES` from `types.ts`; `BoardField` from `github.ts`.
- Produces, in `types.ts`:
  - `Proposal { id: string; ref: string; area: string | null; size: string | null; priority: string | null; status: 'To do' | 'Backlog' | 'Waiting'; parent: string | null; reason: string }`
  - `TriageOptions { area: string[]; size: string[]; priority: string[] }`
- Produces, in `triage.ts`:
  - `MODEL = 'claude-opus-5-5'`
  - `TriageSchema` (zod), `RawProposal = z.infer<typeof TriageSchema>['proposals'][number]`
  - `SYSTEM: string`
  - `TriageRequest { options: TriageOptions; projects: { ref; title; status; area }[]; tasks: { id; ref; title; area; size; priority; lab }[] }`
  - `boardOptions(fields: BoardField[]): TriageOptions`
  - `buildTriageRequest(items: BoardItem[], fields: BoardField[]): TriageRequest`
  - `validateProposals(raw: RawProposal[], items: BoardItem[], fields: BoardField[]): Proposal[]`

- [ ] **Step 1: Install the dependencies**

Run: `cd worker && npm install @anthropic-ai/sdk@^1.14.0 zod@^4.6.7`
Expected: both appear under `dependencies` in `worker/package.json`.

- [ ] **Step 2: Add the shared types**

Append to `worker/src/types.ts`:

```ts
/** One task's triage as Claude proposed it and the Worker checked it. Nothing is written until the user applies it. */
export interface Proposal {
	/** project item id */
	id: string;
	/** `owner/name#n`, taken from the board, not from Claude */
	ref: string;
	area: string | null;
	size: string | null;
	priority: string | null;
	/** `Waiting` only when the parent is a paused project in Waiting */
	status: 'To do' | 'Backlog' | 'Waiting';
	/** ref of an open `project` issue */
	parent: string | null;
	/** one short sentence for the user */
	reason: string;
}

/** The board's option names for the fields triage sets, so the review list can offer them. */
export interface TriageOptions {
	area: string[];
	size: string[];
	priority: string[];
}
```

- [ ] **Step 3: Write the failing tests**

Create `worker/test/triage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BoardField } from '../src/github';
import { buildTriageRequest, validateProposals, type RawProposal } from '../src/triage';
import { makeRef, type BoardItem } from '../src/types';

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
	const repo = over.repo ?? 'st4eve/MyLife';
	return {
		id: `id-${repo}-${over.number}`,
		repo,
		ref: makeRef(repo, over.number),
		title: `task ${over.number}`,
		url: '',
		open: true,
		isProject: false,
		parent: null,
		status: 'Inbox',
		area: null,
		priority: null,
		size: null,
		lab: false,
		due: null,
		updatedAt: '',
		blocked: false,
		canDelete: true,
		...over,
	};
}

const OTHER = 'QNLQueens/WickedIdeas';

const fields: BoardField[] = [
	{ id: 'F_status', name: 'Status', options: [{ id: 's1', name: 'Inbox' }] },
	{ id: 'F_area', name: 'Area', options: [{ id: 'a1', name: 'Research' }, { id: 'a2', name: 'Personal' }] },
	{ id: 'F_size', name: 'Size', options: [{ id: 'z1', name: 'S' }, { id: 'z2', name: 'M' }] },
	{ id: 'F_prio', name: 'Priority', options: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] },
];

const items: BoardItem[] = [
	item({ number: 1, isProject: true, status: 'In progress', area: 'Research', title: 'Thesis' }),
	item({ number: 1, repo: OTHER, isProject: true, status: 'Waiting', area: 'Research', title: 'Wafer map' }),
	item({ number: 2, isProject: true, status: 'Backlog', title: 'Garden' }),
	item({ number: 3, isProject: true, status: 'Done', open: false, title: 'Old project' }),
	item({ number: 10, title: 'Fix "the" plot', lab: true }),
	item({ number: 11, title: 'Buy soil' }),
	item({ number: 12, status: 'To do', title: 'Already triaged' }),
	item({ number: 13, open: false, title: 'Closed inbox task' }),
];

const raw = (over: Partial<RawProposal>): RawProposal => ({
	id: 'id-st4eve/MyLife-10',
	ref: 'ignored',
	area: null,
	size: null,
	priority: null,
	status: 'To do',
	parent: null,
	reason: 'r',
	...over,
});

describe('buildTriageRequest', () => {
	const req = buildTriageRequest(items, fields);

	it('sends the option names of area, size and priority', () => {
		expect(req.options).toEqual({ area: ['Research', 'Personal'], size: ['S', 'M'], priority: ['P1', 'P2'] });
	});
	it('sends open projects only', () => {
		expect(req.projects).toEqual([
			{ ref: 'st4eve/MyLife#1', title: 'Thesis', status: 'In progress', area: 'Research' },
			{ ref: `${OTHER}#1`, title: 'Wafer map', status: 'Waiting', area: 'Research' },
			{ ref: 'st4eve/MyLife#2', title: 'Garden', status: 'Backlog', area: null },
		]);
	});
	it('sends open inbox tasks only, with titles and no bodies', () => {
		expect(req.tasks).toEqual([
			{ id: 'id-st4eve/MyLife-10', ref: 'st4eve/MyLife#10', title: 'Fix "the" plot', area: null, size: null, priority: null, lab: true },
			{ id: 'id-st4eve/MyLife-11', ref: 'st4eve/MyLife#11', title: 'Buy soil', area: null, size: null, priority: null, lab: false },
		]);
		expect(JSON.stringify(req)).not.toContain('url');
	});
});

describe('validateProposals', () => {
	const check = (r: RawProposal[]) => validateProposals(r, items, fields);

	it('keeps a valid proposal and takes the ref from the board', () => {
		expect(check([raw({ area: 'Research', size: 'S', priority: 'P1', parent: 'st4eve/MyLife#1', reason: 'thesis figure' })])).toEqual([
			{ id: 'id-st4eve/MyLife-10', ref: 'st4eve/MyLife#10', area: 'Research', size: 'S', priority: 'P1', status: 'To do', parent: 'st4eve/MyLife#1', reason: 'thesis figure' },
		]);
	});
	it('drops ids that are not open inbox tasks', () => {
		const ids = ['made-up', 'id-st4eve/MyLife-1', 'id-st4eve/MyLife-12', 'id-st4eve/MyLife-13'];
		expect(check(ids.map((id) => raw({ id })))).toEqual([]);
	});
	it('keeps the first of duplicate ids', () => {
		expect(check([raw({ reason: 'first' }), raw({ reason: 'second' })]).map((p) => p.reason)).toEqual(['first']);
	});
	it('nulls values that are not current options', () => {
		const [p] = check([raw({ area: 'research', size: 'XL', priority: 'P0' })]);
		expect([p.area, p.size, p.priority]).toEqual([null, null, null]);
	});
	it('nulls a parent that is unknown, closed or not a project', () => {
		for (const parent of ['st4eve/Nope#1', 'st4eve/MyLife#3', 'st4eve/MyLife#11']) {
			expect(check([raw({ parent })])[0].parent).toBeNull();
		}
	});
	it('uses the paused status of the right repo\'s project', () => {
		expect(check([raw({ parent: `${OTHER}#1`, status: 'To do' })])[0].status).toBe('Waiting');
		expect(check([raw({ parent: 'st4eve/MyLife#1', status: 'To do' })])[0].status).toBe('To do');
		expect(check([raw({ parent: 'st4eve/MyLife#2', status: 'To do' })])[0].status).toBe('Backlog');
	});
	it('turns any other status into Backlog', () => {
		expect(check([raw({ status: 'Waiting' })])[0].status).toBe('Backlog');
		expect(check([raw({ status: 'In progress' })])[0].status).toBe('Backlog');
		expect(check([raw({ status: 'Backlog' })])[0].status).toBe('Backlog');
	});
	it('cuts the reason to 140 characters', () => {
		expect(check([raw({ reason: 'x'.repeat(300) })])[0].reason).toHaveLength(140);
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/triage.test.ts`
Expected: FAIL, `../src/triage` does not exist.

- [ ] **Step 5: Implement the pure parts of `triage.ts`**

Create `worker/src/triage.ts`:

```ts
import { z } from 'zod';
import type { BoardField } from './github';
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
		tasks: inboxTasks(items).map((t) => ({ id: t.id, ref: t.ref, title: t.title, area: t.area, size: t.size, priority: t.priority, lab: t.lab })),
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/triage.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/src/types.ts worker/src/triage.ts worker/test/triage.test.ts
git commit -m "feat(worker): build the triage request and validate proposals"
```

---

### Task 4: The Claude call and `POST /triage`

**Files:**
- Modify: `worker/src/triage.ts` (append `TriageError`, `Ask`, `claudeAsker`, `runTriage`)
- Modify: `worker/src/index.ts` (route and error mapping)
- Modify: `worker/.dev.vars.example`
- Test: `worker/test/triage.test.ts` (append)

**Interfaces:**
- Consumes: `buildTriageRequest`, `validateProposals`, `boardOptions`, `TriageSchema`, `SYSTEM`, `MODEL`, `TriageRequest`, `RawProposal` from Task 3; `Board` from `github.ts`.
- Produces:
  - `TriageError extends Error` (route answers 502 with its message)
  - `Ask = (request: TriageRequest) => Promise<{ refused: boolean; proposals: RawProposal[] | null }>`
  - `claudeAsker(apiKey: string): Ask`
  - `runTriage(board: Board, ask: Ask): Promise<{ proposals: Proposal[]; options: TriageOptions }>`
  - `POST /triage`, no body, answers `{ proposals: Proposal[]; options: TriageOptions }`

`runTriage` takes the call as a function (`Ask`) so tests pass a fake one and never reach the network.

- [ ] **Step 1: Write the failing tests**

Change the triage import in `worker/test/triage.test.ts` to:

```ts
import { TriageError, buildTriageRequest, runTriage, validateProposals, type Ask, type RawProposal } from '../src/triage';
import type { BoardField, Board } from '../src/github';
```

(and remove the earlier `import type { BoardField } from '../src/github';` line). Append:

```ts
describe('runTriage', () => {
	const board: Board = { projectId: 'PVT_test', fields, items };

	it('does not call Claude when the inbox is empty', async () => {
		const ask: Ask = async () => {
			throw new Error('should not be called');
		};
		const empty: Board = { ...board, items: items.filter((i) => i.status !== 'Inbox') };
		expect((await runTriage(empty, ask)).proposals).toEqual([]);
	});
	it('returns validated proposals and the options', async () => {
		const ask: Ask = async () => ({ refused: false, proposals: [raw({ area: 'Personal' }), raw({ id: 'made-up' })] });
		const out = await runTriage(board, ask);
		expect(out.proposals.map((p) => [p.ref, p.area])).toEqual([['st4eve/MyLife#10', 'Personal']]);
		expect(out.options.size).toEqual(['S', 'M']);
	});
	it('turns a refusal into a TriageError', async () => {
		const ask: Ask = async () => ({ refused: true, proposals: null });
		await expect(runTriage(board, ask)).rejects.toThrow(new TriageError('Claude declined to triage this inbox'));
	});
	it('turns an unparsed answer into a TriageError', async () => {
		const ask: Ask = async () => ({ refused: false, proposals: null });
		await expect(runTriage(board, ask)).rejects.toThrow(new TriageError("Claude's answer could not be read"));
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run test/triage.test.ts`
Expected: FAIL, `runTriage` and `TriageError` are not exported.

- [ ] **Step 3: Implement the call**

Add to the imports of `worker/src/triage.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Board } from './github';
```

(merge `Board` into the existing `import type { BoardField } from './github';` line). Append:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run test/triage.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the secret name and regenerate types**

Change `worker/.dev.vars.example` to:

```
GITHUB_TOKEN=
APP_KEY=
ALLOWED_ORIGINS=http://localhost:5173
ANTHROPIC_API_KEY=
```

Add the same `ANTHROPIC_API_KEY=` line to your local `worker/.dev.vars` (empty is fine for now; the owner fills it in before the live check). Then run `cd worker && npm run cf-typegen`.
Expected: `worker-configuration.d.ts` now lists `ANTHROPIC_API_KEY: string` in `Env`.

- [ ] **Step 6: Add the route and error mapping in `index.ts`**

Add imports:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { TriageError, claudeAsker, runTriage } from './triage';
```

Add before the `/tasks` route:

```ts
	if (request.method === 'POST' && url.pathname === '/triage') {
		if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'triage is not set up' }, { status: 500 });
		const board = await fetchBoard(env.GITHUB_TOKEN);
		return Response.json(await runTriage(board, claudeAsker(env.ANTHROPIC_API_KEY)));
	}
```

In the `catch` of the default export, before the `console.error` line, add:

```ts
						// claude declined, answered badly, or the api failed after the sdk's own retries
						if (e instanceof TriageError || e instanceof Anthropic.APIError) return Response.json({ error: e.message }, { status: 502 });
```

- [ ] **Step 7: Typecheck, test and check the bundle**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests PASS.

Run: `cd worker && npx wrangler deploy --dry-run --outdir /tmp/attask-dry`
Expected: the bundle builds. If it fails on a Node built-in (for example `node:stream`), add `"compatibility_flags": ["nodejs_compat"]` next to `compatibility_date` in `wrangler.jsonc` and run it again.

- [ ] **Step 8: Commit**

```bash
git add worker/src/triage.ts worker/src/index.ts worker/.dev.vars.example worker/worker-configuration.d.ts worker/test/triage.test.ts worker/wrangler.jsonc
git commit -m "feat(worker): POST /triage asks Claude for inbox proposals"
```

---

### Task 5: App API calls and review-row helpers

**Files:**
- Modify: `app/src/lib/api.ts` (three calls)
- Create: `app/src/lib/triage.ts`
- Create: `app/src/lib/triage.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `TriageOptions`, `PAUSED_STATUSES` from `worker/src/types.ts`; `BoardItem`; `postStatus`, `postPriority`.
- Produces, in `api.ts`:
  - `postTriage(): Promise<{ proposals: Proposal[]; options: TriageOptions }>`
  - `postFields(id: string, change: { area?: string; size?: string }): Promise<void>`
  - `postParent(id: string, parent: string): Promise<void>`
  - re-exports `type Proposal`, `type TriageOptions`
- Produces, in `triage.ts`:
  - `Row { proposal: Proposal; title: string; skipped: boolean; busy: boolean; error: string }`
  - `toRows(proposals: Proposal[], items: BoardItem[]): Row[]`
  - `statusChoices(proposal: Proposal, items: BoardItem[]): Proposal["status"][]`
  - `setParent(proposal: Proposal, parent: string | null, items: BoardItem[]): Proposal`
  - `applyProposal(proposal: Proposal): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/triage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem, type Proposal } from "../../../worker/src/types";
import { setParent, statusChoices, toRows } from "./triage";

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
    const repo = over.repo ?? "st4eve/MyLife";
    return {
        id: `id-${repo}-${over.number}`, repo, ref: makeRef(repo, over.number), title: `task ${over.number}`, url: "", open: true,
        isProject: false, parent: null, status: "Inbox", area: null, priority: null, size: null, lab: false, due: null,
        updatedAt: "", blocked: false, canDelete: true, ...over,
    };
}

const OTHER = "QNLQueens/WickedIdeas";
const items = [
    item({ number: 1, isProject: true, status: "In progress" }),
    item({ number: 1, repo: OTHER, isProject: true, status: "Waiting" }),
    item({ number: 10 }),
];
const base: Proposal = { id: "id-st4eve/MyLife-10", ref: "st4eve/MyLife#10", area: null, size: null, priority: null, status: "To do", parent: null, reason: "r" };

describe("toRows", () => {
    it("adds the title and skips rows with nothing but a status", () => {
        const rows = toRows([base, { ...base, area: "Research" }], items);
        expect(rows.map((r) => [r.title, r.skipped])).toEqual([["task 10", true], ["task 10", false]]);
    });
});

describe("statusChoices", () => {
    it("offers To do and Backlog without a paused parent", () => {
        expect(statusChoices(base, items)).toEqual(["To do", "Backlog"]);
        expect(statusChoices({ ...base, parent: "st4eve/MyLife#1" }, items)).toEqual(["To do", "Backlog"]);
    });
    it("offers only the paused project's status", () => {
        expect(statusChoices({ ...base, parent: `${OTHER}#1`, status: "Waiting" }, items)).toEqual(["Waiting"]);
    });
});

describe("setParent", () => {
    it("makes the status follow a paused project in the right repo", () => {
        expect(setParent(base, `${OTHER}#1`, items)).toMatchObject({ parent: `${OTHER}#1`, status: "Waiting" });
        expect(setParent(base, "st4eve/MyLife#1", items)).toMatchObject({ parent: "st4eve/MyLife#1", status: "To do" });
    });
    it("goes back to To do when leaving a paused project", () => {
        const paused = setParent(base, `${OTHER}#1`, items);
        expect(setParent(paused, null, items)).toMatchObject({ parent: null, status: "To do" });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/lib/triage.test.ts`
Expected: FAIL, `./triage` does not exist.

- [ ] **Step 3: Add the API calls**

In `app/src/lib/api.ts`, change the first two lines to:

```ts
import { parseRef, type BoardItem, type ItemDetail, type Proposal, type TriageOptions } from "../../../worker/src/types";
export type { BoardItem, ItemDetail, Proposal, TriageOptions };
```

Append:

```ts
/** Asks the Worker to triage the inbox with Claude. Nothing is written; returns one proposal per inbox task Claude answered for, plus the option names to offer when editing. */
export function postTriage(): Promise<{ proposals: Proposal[]; options: TriageOptions }> {
  return request("/triage", {});
}

/** Asks the Worker to set an item's Area and/or Size. Throws the board rule's reason if it refuses. */
export async function postFields(id: string, change: { area?: string; size?: string }): Promise<void> {
  await request(`/items/${id}/fields`, change);
}

/** Asks the Worker to add a task as a sub-issue of a project, given the project's ref. Throws the board rule's reason if it refuses. */
export async function postParent(id: string, parent: string): Promise<void> {
  await request(`/items/${id}/parent`, { parent });
}
```

- [ ] **Step 4: Write `app/src/lib/triage.ts`**

```ts
import { PAUSED_STATUSES, type BoardItem, type Proposal } from "../../../worker/src/types";
import { postFields, postParent, postPriority, postStatus } from "./api";

/** One line of the triage review list. */
export interface Row {
    proposal: Proposal;
    /** the task's title, from the board */
    title: string;
    /** left out of "apply all" */
    skipped: boolean;
    /** true while its writes are in flight */
    busy: boolean;
    /** why the last apply failed, empty if it didn't */
    error: string;
}

/** Turns proposals into rows. A row where Claude suggested nothing beyond a status starts skipped. */
export function toRows(proposals: Proposal[], items: BoardItem[]): Row[] {
    return proposals.map((p) => ({
        proposal: p,
        title: items.find((i) => i.id === p.id)?.title ?? p.ref,
        skipped: p.area === null && p.size === null && p.priority === null && p.parent === null,
        busy: false,
        error: "",
    }));
}

// the status a parent forces on its tasks, or null when it is active or there is none
function pausedStatus(parent: string | null, items: BoardItem[]): "Backlog" | "Waiting" | null {
    const project = items.find((i) => i.isProject && i.ref === parent);
    return project?.status && PAUSED_STATUSES.includes(project.status) ? (project.status as "Backlog" | "Waiting") : null;
}

/** The statuses a row may take: To do or Backlog, or only the project's status when its parent is paused. */
export function statusChoices(proposal: Proposal, items: BoardItem[]): Proposal["status"][] {
    const paused = pausedStatus(proposal.parent, items);
    return paused ? [paused] : ["To do", "Backlog"];
}

/** A copy of the proposal with a new parent. Its status follows a paused project, and goes back to To do when it leaves one. */
export function setParent(proposal: Proposal, parent: string | null, items: BoardItem[]): Proposal {
    const paused = pausedStatus(parent, items);
    const status = paused ?? (proposal.status === "Waiting" || pausedStatus(proposal.parent, items) ? "To do" : proposal.status);
    return { ...proposal, parent, status };
}

/**
 * Writes one proposal: parent, then Area and Size, then priority, then status. Status goes last because it moves the task out of Inbox, so if an earlier write fails the task stays in Inbox and the row can be retried.
 *
 * Args:
 *     proposal: The row's proposal as the user left it.
 */
export async function applyProposal(proposal: Proposal): Promise<void> {
    const { id, parent, area, size, priority, status } = proposal;
    if (parent) await postParent(id, parent);
    const change: { area?: string; size?: string } = {};
    if (area) change.area = area;
    if (size) change.size = size;
    if (change.area || change.size) await postFields(id, change);
    if (priority) await postPriority(id, priority);
    await postStatus(id, status);
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd app && npx vitest run && npm run check`
Expected: all tests PASS, svelte-check reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/api.ts app/src/lib/triage.ts app/src/lib/triage.test.ts
git commit -m "feat(app): triage api calls and review-row helpers"
```

---

### Task 6: Review list on the Inbox page

**Files:**
- Create: `app/src/components/TriageReview.svelte`
- Modify: `app/src/pages/Inbox.svelte`

**Interfaces:**
- Consumes: `Row`, `toRows`, `statusChoices`, `setParent`, `applyProposal` from Task 5; `postTriage`, `TriageOptions`; `board`, `loadBoard`, `openProjects` from `board.svelte.ts`; `Icon`, `Spinner`.
- Produces: `TriageReview` with props `{ rows: Row[]; options: TriageOptions; onclose: () => void }` (`rows` is `$bindable`).

- [ ] **Step 1: Write `TriageReview.svelte`**

Create `app/src/components/TriageReview.svelte`:

```svelte
<script lang="ts">
    import type { TriageOptions } from "../lib/api";
    import { board, loadBoard, openProjects } from "../lib/board.svelte";
    import { applyProposal, setParent, statusChoices, type Row } from "../lib/triage";
    import Icon from "./Icon.svelte";

    /** Claude's proposals for the inbox, one row each. Every chip is a menu; apply writes the row, skip leaves it out of "apply all". Applied rows disappear; closing discards the rest. */
    let { rows = $bindable(), options, onclose }: { rows: Row[]; options: TriageOptions; onclose: () => void } = $props();

    let projects = $derived(openProjects(board.items));
    let running = $state(false);

    /** Writes one row; on failure the row stays with the reason, and the task stays in Inbox. */
    async function apply(row: Row): Promise<boolean> {
        row.busy = true;
        row.error = "";
        try {
            await applyProposal(row.proposal);
            return true;
        } catch (e) {
            row.error = e instanceof Error ? e.message : String(e);
            return false;
        } finally {
            row.busy = false;
        }
    }

    /** Applies the given rows one after another, then reloads the board once and drops the rows that were written. */
    async function applyRows(chosen: Row[]): Promise<void> {
        running = true;
        const done = new Set<string>();
        for (const row of chosen) if (await apply(row)) done.add(row.proposal.id);
        rows = rows.filter((r) => !done.has(r.proposal.id));
        await loadBoard();
        running = false;
        if (rows.length === 0) onclose();
    }
</script>

<section class="review">
    <header>
        <h2>triage</h2>
        <button class="icon" aria-label="close triage" onclick={onclose}><Icon name="close" size={1.1} /></button>
    </header>

    {#each rows as row (row.proposal.id)}
        <div class="row" class:skipped={row.skipped}>
            <div class="title"><span class="ref">{row.proposal.ref}</span> {row.title}</div>
            <div class="chips">
                <!-- each chip is plain text with an invisible select on top, like the status pill -->
                <label class="chip">{row.proposal.area ?? "area"}
                    <select aria-label="area" value={row.proposal.area ?? ""} onchange={(e) => (row.proposal.area = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.area as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.size ?? "size"}
                    <select aria-label="size" value={row.proposal.size ?? ""} onchange={(e) => (row.proposal.size = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.size as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.priority ?? "priority"}
                    <select aria-label="priority" value={row.proposal.priority ?? ""} onchange={(e) => (row.proposal.priority = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.priority as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.status}
                    <select aria-label="status" value={row.proposal.status} onchange={(e) => (row.proposal.status = e.currentTarget.value as Row["proposal"]["status"])}>
                        {#each statusChoices(row.proposal, board.items) as s}<option value={s}>{s}</option>{/each}
                    </select>
                </label>
                <label class="chip">{projects.find((p) => p.ref === row.proposal.parent)?.title ?? "no project"}
                    <select aria-label="project" value={row.proposal.parent ?? ""} onchange={(e) => (row.proposal = setParent(row.proposal, e.currentTarget.value || null, board.items))}>
                        <option value="">no project</option>
                        {#each projects as p}<option value={p.ref}>{p.title}</option>{/each}
                    </select>
                </label>
            </div>
            <p class="reason">{row.proposal.reason}</p>
            {#if row.error}<p class="error">{row.error}</p>{/if}
            <div class="row-actions">
                <button class="pill" disabled={running || row.busy} onclick={() => applyRows([row])}><Icon name="check" size={1} />apply</button>
                <button class="pill" disabled={running} onclick={() => (row.skipped = !row.skipped)}>{row.skipped ? "unskip" : "skip"}</button>
            </div>
        </div>
    {/each}

    <button class="pill all" disabled={running || rows.every((r) => r.skipped)} onclick={() => applyRows(rows.filter((r) => !r.skipped))}>
        <Icon name="check" size={1.2} />apply all
    </button>
</section>

<style>
    .review {
        width: 100%;
        max-width: 36rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        margin-top: 1.2rem;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h2 {
        margin: 0;
        font-size: 1.1em;
    }
    .icon {
        display: inline-flex;
        padding: 0.3em;
        color: var(--muted);
        background: none;
        border: none;
    }
    .row {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.6rem 0.8rem;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 0.6rem;
    }
    .row.skipped {
        opacity: 0.55;
    }
    .ref {
        color: var(--muted);
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .chip {
        position: relative;
        padding: 0.05em 0.6em;
        font-size: 0.82em;
        font-weight: 500;
        border: 1px solid var(--border);
        border-radius: 999px;
        cursor: pointer;
    }
    .chip select {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
    .reason,
    .error {
        margin: 0;
        font-size: 0.85em;
        color: var(--muted);
    }
    .error {
        color: #d14343;
    }
    .row-actions {
        display: flex;
        gap: 0.5rem;
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        padding: 0.35em 0.9em;
        font: inherit;
        color: var(--text);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 999px;
    }
    .pill:disabled {
        opacity: 0.5;
    }
    .all {
        align-self: flex-start;
    }
</style>
```

- [ ] **Step 2: Wire it into `Inbox.svelte`**

In the `<script>` of `app/src/pages/Inbox.svelte`:
- Replace the import of `postTask` with `import { postTask, postTriage, type TriageOptions } from "../lib/api";` and add `import TriageReview from "../components/TriageReview.svelte";`, `import Spinner from "../components/Spinner.svelte";` and `import { toRows, type Row } from "../lib/triage";`.
- Delete the `prompt` constant.
- Change the component's doc comment to say the button asks the Worker to triage with Claude and opens a review list.
- Add:

```ts
    /** The open triage review, or null when none is showing. */
    let review: { rows: Row[]; options: TriageOptions } | null = $state(null);
    /** True while the Worker is asking Claude. */
    let triaging = $state(false);

    /** Asks the Worker for proposals and opens the review list; an empty answer or a failure goes to `board.error`. */
    async function triage(): Promise<void> {
        triaging = true;
        try {
            const { proposals, options } = await postTriage();
            board.error = proposals.length === 0 ? "nothing to triage" : "";
            review = proposals.length === 0 ? null : { rows: toRows(proposals, board.items), options };
        } catch (err) {
            board.error = err instanceof Error ? err.message : String(err);
        }
        triaging = false;
    }
```

Replace the triage `<a class="pill" …>…</a>` with:

```svelte
        <button class="pill triage" disabled={triaging || review !== null} onclick={triage}>
            {#if triaging}<Spinner />triaging…{:else}<Icon name="claude" size={1.3} />triage inbox{/if}
        </button>
```

After the closing `</div>` of `.actions`, add:

```svelte
{#if review}
    <TriageReview bind:rows={review.rows} options={review.options} onclose={() => (review = null)} />
{/if}
```

In the `<style>` block, change the selector `a.pill :global(svg)` to `.triage :global(svg)`, and add:

```css
    .pill:disabled {
        opacity: 0.6;
    }
```

- [ ] **Step 3: Type check and tests**

Run: `cd app && npm run check && npx vitest run`
Expected: 0 errors, all tests PASS.

- [ ] **Step 4: Look at it without Claude**

With `wrangler dev` and `npm run dev` running and `ANTHROPIC_API_KEY` still empty in `.dev.vars`, open the Inbox and press "triage inbox".
Expected: the button shows "triaging…", then the error line reads `triage is not set up` and the button comes back. Nothing is written.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/TriageReview.svelte app/src/pages/Inbox.svelte
git commit -m "feat(app): review Claude's inbox triage before applying it"
```

---

### Task 7: Docs, gate and live check

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/deploy.md`
- Modify: `docs/superpowers/specs/2026-11-25-inbox-triage-design.md`

**Interfaces:**
- Consumes: everything above. Produces nothing new in code.

- [ ] **Step 1: Update the docs**

`CLAUDE.md`:
- In "Run", change the secrets sentence to list `GITHUB_TOKEN`, `APP_KEY`, `ALLOWED_ORIGINS` and `ANTHROPIC_API_KEY` (for `/triage`; the owner sets it, never in a logged command).
- In "Gate", change the app test line to `(unit tests cover next.ts, route.ts, issuePath and triage.ts)` and the Worker test line to `(unit tests cover rules.ts, paths.ts, github.ts parsing and writes, and triage.ts)`.

`docs/deploy.md`, in "Cloudflare Worker" step 4, add a third secret:

```
   - `npx wrangler secret put ANTHROPIC_API_KEY` (a key from console.anthropic.com; used only by the inbox triage button. Each press is one request of a few thousand tokens.)
```

and change "Set the two secrets" to "Set the three secrets".

`docs/superpowers/specs/2026-11-25-inbox-triage-design.md`:
- Set `Status:` to `approved, implemented on spec/inbox-triage`.
- In section 1, change the `/triage` return to `{ proposals: Proposal[]; options: { area: string[]; size: string[]; priority: string[] } }` and add "`options` lists the board's option names so the review list's menus can offer them."
- In the `planParent` bullet, add "Asking for the parent the item already has is a no-op, so a row whose later writes failed can be applied again."
- Replace "and `planStatus` already enforces the rule, so a proposal that conflicts gets a 409 with the reason, not a silent wrong write" with "`planStatus` lets an Inbox item take any status, so the rule is enforced where proposals are made: `validateProposals` sets the status of a task under a paused project, and the review list offers only that status once such a project is chosen."

- [ ] **Step 2: Run the gate**

Run each, from the repo root:

```bash
cd app && npm run check && npx vitest run && cd ..
cd worker && npm run cf-typegen && npx tsc --noEmit && npx vitest run --passWithNoTests && cd ..
```

Expected: every command passes. `cf-typegen` leaves `worker-configuration.d.ts` unchanged (`git status` shows no diff there).

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md docs/deploy.md docs/superpowers/specs/2026-11-25-inbox-triage-design.md
git commit -m "docs: triage secret, tests and spec refinements"
git push origin spec/inbox-triage
```

- [ ] **Step 4: Live check (ask the user first)**

Ask the user to put their key in `worker/.dev.vars` as `ANTHROPIC_API_KEY=…` themselves and restart `wrangler dev`. Say a press costs a few cents and sends the titles of every Inbox task to Claude.

Then, with the user's go-ahead:
1. On the Inbox page, add a task titled `attask test – delete me` in `st4eve/MyLife`.
2. Press "triage inbox". Expect one row per Inbox task, each with chips and a reason.
3. Press **skip** on every row except the throwaway one. Do not press "apply all" unless it is the only unskipped row. Real tasks must not be written.
4. Set the throwaway row's project to an open project, then apply it. Expect the row to disappear and the task to leave Inbox with the chosen Area, Size, Priority, Status and parent (check on github.com).
5. Close the review list so the other proposals are discarded.
6. Ask the user to confirm, then delete the throwaway issue from its detail sheet (or `gh issue delete <n> --repo st4eve/MyLife` once the user says yes). It was a sub-issue, so check the project on GitHub no longer lists it.

- [ ] **Step 5: Update the PR**

Edit the body of st4eve/attask#3 (`gh pr edit 3 --repo st4eve/attask --body-file <file>`) so it says what was built, the two spec refinements, the live check result, and under "needs you": set `ANTHROPIC_API_KEY` with `npx wrangler secret put ANTHROPIC_API_KEY`, redeploy the Worker, and try triage on the phone. End the body with the Claude Code attribution line.
