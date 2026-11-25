# attask on the task_planner board: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point this fork of attask at GitHub Project `st4eve` #2 ("task_planner"). The board holds issues from several repos, so items are keyed by `owner/name#n` refs. attask adopts the board's vocabulary, then the Worker and the app are deployed.

**Architecture:** The Cloudflare Worker reads the board in one paginated GraphQL query that also returns the project's fields and options. It resolves every field and option ID by name on each request and applies the board rules from `rules.ts`. The Svelte app keys items by ref everywhere (state, routes, API paths). Owner-specific values live in `worker/src/config.ts`, which the app imports as well.

**Tech Stack:** Cloudflare Workers + TypeScript + vitest (`@cloudflare/vitest-plugin`). Vite + Svelte 5 runes + TypeScript, hash router, GitHub Pages under `/attask/`.

**Spec:** `docs/superpowers/specs/2026-11-25-task-planner-board-design.md`

## Global Constraints

- The repo is public. Never commit tokens, keys or real task content. Fixtures and test data use invented titles and IDs.
- Never put a token or app key in a command that gets logged, a commit, or an issue comment. The owner sets secrets with `wrangler secret put` at the hidden prompt.
- Test every write on a throwaway issue titled `attask test – delete me` in `st4eve/MyLife`, then delete it. Never test writes on real items.
- Work on branch `spec/task-planner-board` (or a branch cut from it), land by PR into the fork's `main`, and run `gh repo set-default st4eve/attask` before any PR. Never push to or open PRs against `jewaniuk/attask`. Never commit on `main` and never merge.
- Field and option IDs are never hard-coded. A missing name fails with `board has no <Field> field` or `board has no <Field> option "<Option>"`, and nothing is written.
- Status names are the board's exact option names: `Inbox`, `Backlog`, `To do`, `In progress`, `Waiting`, `Done`. Priority: `P0`, `P1`, `P2`. Size: `XS`, `S`, `M`, `L`, `XL`. Area options are read from the board.
- `worker/src/types.ts` and `worker/src/config.ts` are imported by the app, so they must hold no Worker-only code.
- Style: Worker uses tabs and single quotes. App uses 4-space indent and double quotes, except `app/src/lib/api.ts`, which uses 2 spaces. Inline comments are lowercase. Every export gets a `/** */` doc with `Args:` / `Returns:` where they add something. No `any` except raw GraphQL/REST responses in `worker/src/github.ts`.
- Gate, all must pass before the PR: `cd app && npm run check`; `cd app && npx vitest run`; `cd worker && npm run cf-typegen && npx tsc --noEmit`; `cd worker && npx vitest run --passWithNoTests`.

## Review Focus

1. **Missing Backlog option.** Until the owner adds it, any write that needs `Backlog` must fail with `board has no Status option "Backlog"` and write nothing. Test: `resolveOption` in Task 2.
2. **Same issue number in two repos.** `st4eve/MyLife#3` and `QNLQueens/WickedIdeas#3` must never be confused when pausing a project, ordering Next or routing. Tests: the cascade test in Task 1 and the Next test in Task 4.
3. **Delete in a repo the viewer doesn't admin.** It must be refused with a clear reason and nothing deleted. Test: `checkDelete` in Task 1.
4. **Repo names with dots or dashes** (`Shastri-Lab/polymerNN`, `QNL-Wafer-Database`) must round-trip through API paths and hash routes. Tests: `parseIssuePath` in Task 3, `issuePath` and `parseRoute` in Task 5.
5. **Unsized tasks.** They appear only under the `any` time filter. Test: the time-filter test in Task 4.

---

### Task 1: Shared types and board rules on refs

**Files:**
- Modify: `worker/src/types.ts` (whole file)
- Modify: `worker/src/rules.ts` (whole file)
- Test: `worker/test/rules.test.ts` (whole file)

**Interfaces:**
- Produces, in `types.ts`:
  - `BoardItem { id, repo, number, ref, title, url, open, isProject, parent: string | null, status, area, priority, size, lab: boolean, due, updatedAt, blocked, canDelete: boolean }`
  - `PRIORITIES`, `priorityRank(p)`, `SIZES`, `PROJECT_STATUSES`, `TASK_STATUSES`, `PAUSED_STATUSES`
  - `makeRef(repo, number): string`, `parseRef(ref): { repo: string; number: number } | null`, `statusSlug(status): string`
  - `projectOf(items, item): BoardItem | undefined`, `allowedStatuses(item, items)`
- Produces, in `rules.ts`:
  - `StatusWrite { id, ref, status }`, `PriorityWrite { id, ref, priority }`
  - `planStatus(items, id, status): Plan`, `planPriority(items, id, priority): PriorityPlan`
  - `checkDelete(item | undefined): string | null`, `checkNotPlanned(item | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

Replace `worker/test/rules.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { checkDelete, checkNotPlanned, planPriority, planStatus } from '../src/rules';
import { allowedStatuses, makeRef, parseRef, statusSlug, type BoardItem } from '../src/types';

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
	const repo = over.repo ?? 'st4eve/MyLife';
	return {
		id: `id-${repo}-${over.number}`,
		repo,
		ref: makeRef(repo, over.number),
		title: 't',
		url: '',
		open: true,
		isProject: false,
		parent: null,
		status: null,
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

// a project in each repo, both numbered 1, and tasks numbered 10 in each
const board: BoardItem[] = [
	item({ number: 1, isProject: true, status: 'In progress' }),
	item({ number: 1, repo: OTHER, isProject: true, status: 'In progress' }),
	item({ number: 10, parent: 'st4eve/MyLife#1', status: 'To do' }),
	item({ number: 11, parent: 'st4eve/MyLife#1', status: 'In progress' }),
	item({ number: 12, parent: 'st4eve/MyLife#1', status: 'Done', open: false }),
	item({ number: 10, repo: OTHER, parent: `${OTHER}#1`, status: 'To do' }),
	item({ number: 20, status: 'Inbox' }),
	item({ number: 21, status: 'To do' }),
	item({ number: 22, repo: OTHER, status: 'Inbox', canDelete: false }),
];
const id = (repo: string, n: number) => `id-${repo}-${n}`;
const refs = (p: ReturnType<typeof planStatus>) => (p.ok ? p.writes.map((w) => w.ref) : []);

describe('refs', () => {
	it('round-trips repos with dots and dashes', () => {
		expect(parseRef('Shastri-Lab/polymerNN#7')).toEqual({ repo: 'Shastri-Lab/polymerNN', number: 7 });
		expect(parseRef('a.b/c-d.e#12')).toEqual({ repo: 'a.b/c-d.e', number: 12 });
		expect(parseRef('no-hash')).toBeNull();
	});
	it('slugs status names for css', () => {
		expect(statusSlug('In progress')).toBe('in-progress');
		expect(statusSlug('To do')).toBe('to-do');
	});
});

describe('allowedStatuses', () => {
	it('keeps inbox items in the inbox', () => {
		expect(allowedStatuses(board[6], board)).toEqual(['Inbox']);
	});
	it('lets a flat task take any status but Inbox', () => {
		expect(allowedStatuses(board[7], board)).toEqual(['Backlog', 'To do', 'In progress', 'Waiting', 'Done']);
	});
});

describe('planStatus', () => {
	it('changes one task', () => {
		expect(planStatus(board, id('st4eve/MyLife', 10), 'In progress')).toEqual({
			ok: true,
			writes: [{ id: id('st4eve/MyLife', 10), ref: 'st4eve/MyLife#10', status: 'In progress' }],
		});
	});
	it('does nothing when the status is the same', () => {
		expect(planStatus(board, id('st4eve/MyLife', 10), 'To do')).toEqual({ ok: true, writes: [] });
	});
	it('pauses only the open tasks of that project, not a same-numbered project in another repo', () => {
		expect(refs(planStatus(board, id('st4eve/MyLife', 1), 'Waiting'))).toEqual([
			'st4eve/MyLife#1',
			'st4eve/MyLife#10',
			'st4eve/MyLife#11',
		]);
	});
	it('refuses moving a task back to Inbox, naming it by ref', () => {
		expect(planStatus(board, id('st4eve/MyLife', 21), 'Inbox')).toEqual({ ok: false, reason: "st4eve/MyLife#21 can't be Inbox here" });
	});
	it('refuses a task status other than the paused project status or Done', () => {
		const paused = board.map((i) => (i.ref === 'st4eve/MyLife#1' ? { ...i, status: 'Backlog' } : i));
		expect(planStatus(paused, id('st4eve/MyLife', 10), 'In progress').ok).toBe(false);
		expect(planStatus(paused, id('st4eve/MyLife', 10), 'Done').ok).toBe(true);
	});
});

describe('planPriority', () => {
	it('sets a task priority too', () => {
		expect(planPriority(board, id('st4eve/MyLife', 21), 'P1')).toEqual({
			ok: true,
			write: { id: id('st4eve/MyLife', 21), ref: 'st4eve/MyLife#21', priority: 'P1' },
		});
	});
	it('refuses an unknown priority', () => {
		expect(planPriority(board, id('st4eve/MyLife', 21), '!!!')).toEqual({ ok: false, reason: '!!! is not a priority' });
	});
});

describe('checkDelete', () => {
	it('allows an inbox task in a repo the viewer admins', () => {
		expect(checkDelete(board[6])).toBeNull();
	});
	it('refuses an inbox task in a repo the viewer does not admin', () => {
		expect(checkDelete(board[8])).toBe('only inbox tasks in repos you admin can be deleted');
	});
	it('refuses a triaged task and a missing one', () => {
		expect(checkDelete(board[7])).toBe('only inbox tasks in repos you admin can be deleted');
		expect(checkDelete(undefined)).toBe('only inbox tasks in repos you admin can be deleted');
	});
});

describe('checkNotPlanned', () => {
	it('allows an open, triaged task and refuses inbox items and projects', () => {
		expect(checkNotPlanned(board[7])).toBeNull();
		expect(checkNotPlanned(board[6])).toBe('only open, triaged tasks can be closed as not planned');
		expect(checkNotPlanned(board[0])).toBe('only open, triaged tasks can be closed as not planned');
	});
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd worker && npx vitest run test/rules.test.ts`
Expected: FAIL. `makeRef`, `checkDelete` and the rest are not exported.

- [ ] **Step 3: Rewrite `worker/src/types.ts`**

```ts
/** One issue on the task_planner board with its field values flattened. */
export interface BoardItem {
	/** project item id, needed when editing fields */
	id: string;
	/** repository as `owner/name` */
	repo: string;
	number: number;
	/** `owner/name#n`, unique across repos */
	ref: string;
	title: string;
	url: string;
	/** false once the issue is closed */
	open: boolean;
	/** true when the issue has the `project` label */
	isProject: boolean;
	/** ref of the parent issue, null when it has none */
	parent: string | null;
	status: string | null;
	area: string | null;
	priority: string | null;
	size: string | null;
	/** true when the issue has the `lab` label, hidden on the Next page at home */
	lab: boolean;
	/** YYYY-MM-DD */
	due: string | null;
	/** when the project item last changed (any field, ISO 8601), to sort `In progress` tasks by recency */
	updatedAt: string;
	/** true while any issue this one is blocked by is still open */
	blocked: boolean;
	/** true when the token has admin rights on the repo, so the issue may be deleted */
	canDelete: boolean;
}

/** An issue's body and comments, as HTML rendered (and sanitized) by GitHub. */
export interface ItemDetail {
	bodyHtml: string;
	comments: { createdAt: string; bodyHtml: string }[];
}

/** Priorities an item may have, highest first. */
export const PRIORITIES: string[] = ['P0', 'P1', 'P2'];

/** Position of a priority in `PRIORITIES`, highest first; items without one go last. */
export function priorityRank(priority: string | null): number {
	const at = priority === null ? -1 : PRIORITIES.indexOf(priority);
	return at === -1 ? PRIORITIES.length : at;
}

/** Sizes a task may have, smallest first. */
export const SIZES: string[] = ['XS', 'S', 'M', 'L', 'XL'];

/** Statuses a project may have. */
export const PROJECT_STATUSES: string[] = ['Backlog', 'In progress', 'Waiting', 'Done'];

/** Statuses a task may have. */
export const TASK_STATUSES: string[] = ['Inbox', 'Backlog', 'To do', 'In progress', 'Waiting', 'Done'];

/** Statuses that pause a task or, for a project, pause its tasks. */
export const PAUSED_STATUSES: string[] = ['Backlog', 'Waiting'];

/**
 * Builds an item's ref.
 *
 * Args:
 * 	repo: Repository as `owner/name`.
 * 	number: Issue number.
 *
 * Returns:
 * 	`owner/name#n`.
 */
export function makeRef(repo: string, number: number): string {
	return `${repo}#${number}`;
}

/**
 * Splits a ref into its repo and number.
 *
 * Args:
 * 	ref: `owner/name#n`; owner and name may hold letters, digits, `.`, `_` and `-`.
 *
 * Returns:
 * 	The parts, or null if the ref is malformed.
 */
export function parseRef(ref: string): { repo: string; number: number } | null {
	const m = ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
	return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** A status name as a css-safe slug, e.g. `In progress` → `in-progress`, for `--st-<slug>` variables. */
export function statusSlug(status: string): string {
	return status.toLowerCase().replace(/\s+/g, '-');
}

/**
 * The project an item belongs to.
 *
 * Args:
 * 	items: The whole board.
 * 	item: A task.
 *
 * Returns:
 * 	Its parent when the parent is a `project`-labelled issue on the board, else undefined (the task is flat).
 */
export function projectOf(items: BoardItem[], item: BoardItem): BoardItem | undefined {
	return item.parent === null ? undefined : items.find((i) => i.isProject && i.ref === item.parent);
}

/**
 * The statuses an item may be set to, given the board rules: a project takes any project status; an inbox item stays in the inbox (triage happens in the planner); a task of a paused project can only match it or be done; any other task takes any task status but Inbox.
 *
 * Args:
 * 	item: The item to change.
 * 	items: The whole board, to find the item's project.
 */
export function allowedStatuses(item: BoardItem, items: BoardItem[]): string[] {
	if (item.isProject) return PROJECT_STATUSES;
	if (item.status === 'Inbox') return ['Inbox'];
	const project = projectOf(items, item);
	if (project?.status && PAUSED_STATUSES.includes(project.status)) return [project.status, 'Done'];
	return TASK_STATUSES.filter((s) => s !== 'Inbox');
}
```

- [ ] **Step 4: Rewrite `worker/src/rules.ts`**

```ts
import { PAUSED_STATUSES as PAUSED, PRIORITIES, allowedStatuses, type BoardItem } from './types';

/** One Status write the Worker must make on the board. */
export interface StatusWrite {
	/** project item id */
	id: string;
	/** `owner/name#n`, for messages and for closing the issue when the status is `Done` */
	ref: string;
	status: string;
}

/** What the Worker should do for a request, or why it refuses. */
export type Plan = { ok: true; writes: StatusWrite[] } | { ok: false; reason: string };

/** The Priority write the Worker must make on the board. */
export interface PriorityWrite {
	/** project item id */
	id: string;
	ref: string;
	priority: string;
}

/** What the Worker should do for a priority request: the write (null if nothing changes), or why it refuses. */
export type PriorityPlan = { ok: true; write: PriorityWrite | null } | { ok: false; reason: string };

function find(items: BoardItem[], id: string): BoardItem | undefined {
	return items.find((i) => i.id === id);
}

/**
 * Plans a Status change, applying the board rules.
 *
 * Args:
 * 	items: The whole board.
 * 	id: Project item id of the item to change.
 * 	status: The requested status, a board option name.
 *
 * Returns:
 * 	The writes to make (the item itself, plus its open tasks when a project is paused), empty if nothing changes; or a refusal with the reason.
 */
export function planStatus(items: BoardItem[], id: string, status: string): Plan {
	const item = find(items, id);
	if (!item) return { ok: false, reason: 'no such item' };

	if (!allowedStatuses(item, items).includes(status)) {
		return { ok: false, reason: `${item.ref} can't be ${status} here` };
	}

	const writes: StatusWrite[] = [];
	if (item.status !== status) writes.push({ id: item.id, ref: item.ref, status });

	if (item.isProject && PAUSED.includes(status)) {
		for (const task of items) {
			if (task.open && !task.isProject && task.parent === item.ref && task.status !== status) {
				writes.push({ id: task.id, ref: task.ref, status });
			}
		}
	}
	return { ok: true, writes };
}

/**
 * Plans a Priority change, for a project or a task.
 *
 * Args:
 * 	items: The whole board.
 * 	id: Project item id of the item to change.
 * 	priority: The requested priority, one of `PRIORITIES`.
 *
 * Returns:
 * 	The write to make, null if the item already has that priority; or a refusal with the reason.
 */
export function planPriority(items: BoardItem[], id: string, priority: string): PriorityPlan {
	const item = find(items, id);
	if (!item) return { ok: false, reason: 'no such item' };
	if (!PRIORITIES.includes(priority)) return { ok: false, reason: `${priority} is not a priority` };
	if (item.priority === priority) return { ok: true, write: null };
	return { ok: true, write: { id: item.id, ref: item.ref, priority } };
}

/**
 * Checks that an issue may be permanently deleted: an inbox task in a repo the token admins.
 *
 * Args:
 * 	item: The board item, undefined if the issue is not on the board.
 *
 * Returns:
 * 	null if allowed, else the reason to refuse.
 */
export function checkDelete(item: BoardItem | undefined): string | null {
	if (!item || item.isProject || item.status !== 'Inbox' || !item.canDelete) {
		return 'only inbox tasks in repos you admin can be deleted';
	}
	return null;
}

/**
 * Checks that an issue may be closed as not planned: an open, triaged task (inbox tasks are deleted instead, projects are never dropped from attask).
 *
 * Args:
 * 	item: The board item, undefined if the issue is not on the board.
 *
 * Returns:
 * 	null if allowed, else the reason to refuse.
 */
export function checkNotPlanned(item: BoardItem | undefined): string | null {
	if (!item || !item.open || item.isProject || item.status === 'Inbox') {
		return 'only open, triaged tasks can be closed as not planned';
	}
	return null;
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `cd worker && npx vitest run test/rules.test.ts`
Expected: PASS. `tsc` will still fail in `github.ts` and `index.ts`; Tasks 2 and 3 fix that.

- [ ] **Step 6: Commit**

```bash
git add worker/src/types.ts worker/src/rules.ts worker/test/rules.test.ts
git commit -m "worker: key board items by ref and adopt task_planner vocabulary"
```

---

### Task 2: Owner config and the board query with fields resolved by name

**Files:**
- Create: `worker/src/config.ts`
- Modify: `worker/src/github.ts` (whole file)
- Create: `worker/test/fixtures/board-page.json` (anonymised)
- Test: `worker/test/github.test.ts`

**Interfaces:**
- Consumes: `BoardItem`, `makeRef`, `StatusWrite`, `PriorityWrite` from Task 1.
- Produces, in `config.ts`: `OWNER = 'st4eve'`, `PROJECT_NUMBER = 2`, `HOME_REPO = 'st4eve/MyLife'`, `REPOS: string[]`.
- Produces, in `github.ts`:
  - `BoardField { id: string; name: string; options: { id: string; name: string }[] }`
  - `Board { projectId: string; fields: BoardField[]; items: BoardItem[] }`
  - `parsePage(data: any): { projectId: string; fields: BoardField[]; items: BoardItem[]; cursor: string | null }`
  - `resolveOption(fields, field, option): { fieldId: string; optionId: string }`, which throws a named error
  - `fetchBoard(token): Promise<Board>`
  - `writeStatuses(token, board, writes)`, `writePriority(token, board, write)`
  - `fetchDetail(token, repo, number)`
  - `createTask(token, board, repo, title): Promise<{ number: number; url: string }>`
  - `deleteIssue(token, repo, number)`, `closeNotPlanned(token, board, item)`

- [ ] **Step 1: Create `worker/src/config.ts`**

```ts
/** GitHub user who owns the board. */
export const OWNER = 'st4eve';

/** The board's project number under `OWNER` ("task_planner"). */
export const PROJECT_NUMBER = 2;

/** Default repo for new tasks, and the repo whose chip is hidden on cards. */
export const HOME_REPO = 'st4eve/MyLife';

/** Repos offered when adding a task, home first. The Worker refuses any other. */
export const REPOS: string[] = [
	HOME_REPO,
	'QNLQueens/QNL-Wafer-Database',
	'QNLQueens/WickedIdeas',
	'Shastri-Lab/polymerNN',
	'st4eve/Hybrid_CV_Networks',
];
```

- [ ] **Step 2: Write the anonymised fixture**

Create `worker/test/fixtures/board-page.json`. It mirrors the query shape with invented IDs and titles: one project, one sub-task in another repo with the same number, one flat inbox item, and one draft item that must be skipped.

```json
{
	"user": {
		"projectV2": {
			"id": "PVT_test",
			"fields": {
				"nodes": [
					{ "id": "F_title", "name": "Title" },
					{
						"id": "F_status",
						"name": "Status",
						"options": [
							{ "id": "o_inbox", "name": "Inbox" },
							{ "id": "o_todo", "name": "To do" },
							{ "id": "o_prog", "name": "In progress" },
							{ "id": "o_wait", "name": "Waiting" },
							{ "id": "o_done", "name": "Done" }
						]
					},
					{ "id": "F_prio", "name": "Priority", "options": [{ "id": "o_p0", "name": "P0" }, { "id": "o_p1", "name": "P1" }, { "id": "o_p2", "name": "P2" }] },
					{ "id": "F_area", "name": "Area", "options": [{ "id": "o_res", "name": "Research" }] }
				]
			},
			"items": {
				"pageInfo": { "hasNextPage": true, "endCursor": "CUR1" },
				"nodes": [
					{
						"id": "PVTI_a",
						"updatedAt": "2026-11-01T00:00:00Z",
						"fieldValues": { "nodes": [
							{ "name": "In progress", "field": { "name": "Status" } },
							{ "name": "Research", "field": { "name": "Area" } },
							{ "name": "P1", "field": { "name": "Priority" } },
							{}
						] },
						"content": {
							"number": 3, "title": "example project", "url": "https://github.com/st4eve/MyLife/issues/3", "state": "OPEN",
							"repository": { "nameWithOwner": "st4eve/MyLife", "viewerPermission": "ADMIN" },
							"labels": { "nodes": [{ "name": "project" }] },
							"parent": null,
							"issueDependenciesSummary": { "blockedBy": 0 }
						}
					},
					{
						"id": "PVTI_b",
						"updatedAt": "2026-11-02T00:00:00Z",
						"fieldValues": { "nodes": [
							{ "name": "To do", "field": { "name": "Status" } },
							{ "name": "S", "field": { "name": "Size" } },
							{ "date": "2026-12-01", "field": { "name": "Due" } }
						] },
						"content": {
							"number": 3, "title": "example task", "url": "https://github.com/Shastri-Lab/polymerNN/issues/3", "state": "OPEN",
							"repository": { "nameWithOwner": "Shastri-Lab/polymerNN", "viewerPermission": "WRITE" },
							"labels": { "nodes": [{ "name": "lab" }] },
							"parent": { "number": 3, "repository": { "nameWithOwner": "st4eve/MyLife" } },
							"issueDependenciesSummary": { "blockedBy": 1 }
						}
					},
					{
						"id": "PVTI_c",
						"updatedAt": "2026-11-03T00:00:00Z",
						"fieldValues": { "nodes": [{ "name": "Inbox", "field": { "name": "Status" } }] },
						"content": {
							"number": 9, "title": "example inbox item", "url": "https://github.com/st4eve/MyLife/issues/9", "state": "OPEN",
							"repository": { "nameWithOwner": "st4eve/MyLife", "viewerPermission": "ADMIN" },
							"labels": { "nodes": [] },
							"parent": null,
							"issueDependenciesSummary": { "blockedBy": 0 }
						}
					},
					{ "id": "PVTI_draft", "updatedAt": "2026-11-04T00:00:00Z", "fieldValues": { "nodes": [] }, "content": {} }
				]
			}
		}
	}
}
```

- [ ] **Step 3: Write the failing tests**

Create `worker/test/github.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import page from './fixtures/board-page.json';
import { parsePage, resolveOption } from '../src/github';

describe('parsePage', () => {
	const parsed = parsePage(page);

	it('reads the project id, the single-select fields and the cursor', () => {
		expect(parsed.projectId).toBe('PVT_test');
		expect(parsed.fields.map((f) => f.name)).toEqual(['Status', 'Priority', 'Area']);
		expect(parsed.cursor).toBe('CUR1');
	});

	it('flattens issues across repos and skips drafts', () => {
		expect(parsed.items.map((i) => i.ref)).toEqual(['st4eve/MyLife#3', 'Shastri-Lab/polymerNN#3', 'st4eve/MyLife#9']);
	});

	it('reads parent refs, labels, fields and admin rights', () => {
		const task = parsed.items[1];
		expect(task).toMatchObject({
			repo: 'Shastri-Lab/polymerNN',
			number: 3,
			parent: 'st4eve/MyLife#3',
			status: 'To do',
			size: 'S',
			due: '2026-12-01',
			lab: true,
			blocked: true,
			canDelete: false,
			isProject: false,
		});
		expect(parsed.items[0]).toMatchObject({ isProject: true, area: 'Research', priority: 'P1', canDelete: true, parent: null });
	});
});

describe('resolveOption', () => {
	const { fields } = parsePage(page);

	it('finds ids by name', () => {
		expect(resolveOption(fields, 'Status', 'To do')).toEqual({ fieldId: 'F_status', optionId: 'o_todo' });
	});

	it('names a missing option, such as Backlog before the owner adds it', () => {
		expect(() => resolveOption(fields, 'Status', 'Backlog')).toThrow('board has no Status option "Backlog"');
	});

	it('names a missing field', () => {
		expect(() => resolveOption(fields, 'Size', 'XS')).toThrow('board has no Size field');
	});
});
```

If `tsc` complains about importing JSON, add `"resolveJsonModule": true` to `compilerOptions` in `worker/test/tsconfig.json`.

- [ ] **Step 4: Run the tests and see them fail**

Run: `cd worker && npx vitest run test/github.test.ts`
Expected: FAIL. `parsePage` and `resolveOption` are not exported.

- [ ] **Step 5: Rewrite `worker/src/github.ts`**

```ts
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

/** Runs one GraphQL request against GitHub and returns its `data`. Throws if GitHub reports errors. */
async function graphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
	const res = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: HEADERS(token),
		body: JSON.stringify({ query, variables }),
	});
	const json: any = await res.json();
	if (json.errors) throw new Error(JSON.stringify(json.errors));
	return json.data;
}

/** Runs one REST request against GitHub. Throws GitHub's message if it refuses. */
async function rest(token: string, method: string, path: string, body?: object): Promise<any> {
	const res = await fetch(`https://api.github.com${path}`, { method, headers: HEADERS(token), body: body ? JSON.stringify(body) : undefined });
	const json: any = res.status === 204 ? null : await res.json();
	if (!res.ok) throw new Error(`github returned ${res.status}: ${json?.message ?? ''}`);
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
 * 	Error `board has no <field> field` or `board has no <field> option "<option>"`.
 */
export function resolveOption(fields: BoardField[], field: string, option: string): { fieldId: string; optionId: string } {
	const f = fields.find((x) => x.name === field);
	if (!f) throw new Error(`board has no ${field} field`);
	const o = f.options.find((x) => x.name === option);
	if (!o) throw new Error(`board has no ${field} option "${option}"`);
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
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `cd worker && npx vitest run test/github.test.ts test/rules.test.ts`
Expected: PASS. `index.ts` still fails typecheck until Task 3.

- [ ] **Step 7: Commit**

```bash
git add worker/src/config.ts worker/src/github.ts worker/test/github.test.ts worker/test/fixtures/board-page.json worker/test/tsconfig.json
git commit -m "worker: read the task_planner board and resolve field ids by name"
```

---

### Task 3: Worker routes on owner/repo paths

**Files:**
- Create: `worker/src/paths.ts`
- Modify: `worker/src/index.ts` (the `route` function)
- Modify: `worker/wrangler.jsonc:15`
- Test: `worker/test/paths.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `checkDelete`, `checkNotPlanned`, `planStatus`, `planPriority` from Task 1; `REPOS` from config.
- Produces: `parseIssuePath(pathname): { repo: string; number: number; action: '' | 'detail' | 'not-planned' } | null`.
- HTTP contract, used by Task 5:
  - `GET /board` → `BoardItem[]`
  - `GET /issues/:owner/:repo/:n/detail` → `ItemDetail`
  - `POST /issues/:owner/:repo/:n/not-planned` → 204
  - `DELETE /issues/:owner/:repo/:n` → 204
  - `POST /items/:id/status {status}` → `{writes: StatusWrite[]}`
  - `POST /items/:id/priority {priority}` → `{priority}`
  - `POST /tasks {title, repo}` → `{number, url}`
  - A refusal is 409 `{error}`. A missing field or option is 409 with its named error. A bad request is 400 `{error}`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseIssuePath } from '../src/paths';

describe('parseIssuePath', () => {
	it('reads repos with dots and dashes', () => {
		expect(parseIssuePath('/issues/Shastri-Lab/polymerNN/3/detail')).toEqual({ repo: 'Shastri-Lab/polymerNN', number: 3, action: 'detail' });
		expect(parseIssuePath('/issues/QNLQueens/QNL-Wafer-Database/12/not-planned')).toEqual({
			repo: 'QNLQueens/QNL-Wafer-Database',
			number: 12,
			action: 'not-planned',
		});
		expect(parseIssuePath('/issues/a.b/c_d.e/1')).toEqual({ repo: 'a.b/c_d.e', number: 1, action: '' });
	});
	it('rejects other shapes', () => {
		expect(parseIssuePath('/issues/3/detail')).toBeNull();
		expect(parseIssuePath('/issues/o/r/x')).toBeNull();
		expect(parseIssuePath('/issues/o/r/3/other')).toBeNull();
	});
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd worker && npx vitest run test/paths.test.ts`
Expected: FAIL, cannot find module `../src/paths`.

- [ ] **Step 3: Create `worker/src/paths.ts`**

```ts
/**
 * Reads an issue route such as `/issues/owner/name/12/detail`.
 *
 * Args:
 * 	pathname: The request path.
 *
 * Returns:
 * 	The repo as `owner/name`, the issue number and the action (`''` for the issue itself), or null if the path is not an issue route.
 */
export function parseIssuePath(pathname: string): { repo: string; number: number; action: '' | 'detail' | 'not-planned' } | null {
	const m = pathname.match(/^\/issues\/([\w.-]+)\/([\w.-]+)\/(\d+)(?:\/(detail|not-planned))?$/);
	if (!m) return null;
	return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]), action: (m[4] ?? '') as '' | 'detail' | 'not-planned' };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd worker && npx vitest run test/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `route` in `worker/src/index.ts`**

Replace the imports and the `route` function. Keep the default export (CORS) as it is.

```ts
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
```

Then make a named field or option error, and a REST refusal from GitHub (for example no access to the repo), reach the app as a 409 it can show; the app's `send` already shows a 409's `error` and the board rolls the card back. Wrap the call in the default export:

```ts
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
```

- [ ] **Step 6: Set the origin**

In `worker/wrangler.jsonc` line 15:

```jsonc
	"vars": { "ALLOWED_ORIGINS": "https://st4eve.github.io" }
```

- [ ] **Step 7: Run the worker gate**

Run: `cd worker && npm run cf-typegen && npx tsc --noEmit && npx vitest run`
Expected: tsc prints nothing. All three test files pass.

- [ ] **Step 8: Commit**

```bash
git add worker/src/paths.ts worker/src/index.ts worker/test/paths.test.ts worker/wrangler.jsonc worker/worker-configuration.d.ts
git commit -m "worker: route issues by owner/repo, create tasks in a chosen repo, refuse non-admin deletes"
```

---

### Task 4: Next page filters on areas, sizes and flat tasks

**Files:**
- Modify: `app/src/lib/next.ts` (whole file)
- Test: `app/src/lib/next.test.ts` (whole file)

**Interfaces:**
- Consumes: `BoardItem`, `SIZES`, `priorityRank`, `projectOf`, `makeRef` from `worker/src/types`.
- Produces: `TIMES`, `PLACES`, `NextFilters { time; place; area; backlog }`, `areaOf(items, task)`, `dueSoon(items, area, today)`, `nextList(items, filters)`.

- [ ] **Step 1: Write the failing tests**

Replace `app/src/lib/next.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem } from "../../../worker/src/types";
import { dueSoon, nextList, type NextFilters } from "./next";

const HOME = "st4eve/MyLife";
const OTHER = "QNLQueens/WickedIdeas";

function item(over: Partial<BoardItem> & { number: number }): BoardItem {
    const repo = over.repo ?? HOME;
    return {
        id: `id-${repo}-${over.number}`,
        repo,
        ref: makeRef(repo, over.number),
        title: "t",
        url: "",
        open: true,
        isProject: false,
        parent: null,
        status: null,
        area: null,
        priority: null,
        size: null,
        lab: false,
        due: null,
        updatedAt: "",
        blocked: false,
        canDelete: true,
        ...over,
    };
}

// project #1 in each repo; the one in OTHER is paused, so its tasks never show
const board: BoardItem[] = [
    item({ number: 1, isProject: true, status: "In progress", area: "Research", priority: "P2" }),
    item({ number: 1, repo: OTHER, isProject: true, status: "Waiting", area: "Research", priority: "P0" }),
    item({ number: 10, parent: `${HOME}#1`, status: "To do", size: "S" }),
    item({ number: 11, parent: `${HOME}#1`, status: "In progress", size: "XS", updatedAt: "2026-11-01T00:00:00Z" }),
    item({ number: 12, parent: `${HOME}#1`, status: "Backlog", size: "M" }),
    item({ number: 10, repo: OTHER, parent: `${OTHER}#1`, status: "To do", size: "XS" }),
    // flat tasks qualify on their own status
    item({ number: 20, status: "To do", area: "Personal", priority: "P0" }),
    item({ number: 21, status: "In progress", area: "Course", updatedAt: "2026-11-05T00:00:00Z", size: "L" }),
    item({ number: 22, status: "To do", area: "Course", priority: "P2", due: "2026-11-20", size: "XS" }),
    item({ number: 23, repo: OTHER, status: "To do", area: "Course", priority: "P2", due: "2026-11-20", size: "XS" }),
    item({ number: 24, status: "To do", lab: true, size: "XS", area: "Research" }),
    item({ number: 25, status: "To do", blocked: true }),
    item({ number: 26, status: "Inbox" }),
    item({ number: 27, status: "Done", open: false }),
];

const all: NextFilters = { time: "any", place: "lab", area: "all", backlog: true };
const refs = (items: BoardItem[]): string[] => items.map((i) => i.ref);

describe("nextList", () => {
    it("orders In progress by recency, then To do by priority, due, repo and number, then Backlog", () => {
        expect(refs(nextList(board, all))).toEqual([
            `${HOME}#21`,
            `${HOME}#11`,
            `${HOME}#20`,
            `${OTHER}#23`,
            `${HOME}#22`,
            `${HOME}#10`,
            `${HOME}#24`,
            `${HOME}#12`,
        ]);
    });
    it("leaves out Backlog when the toggle is off", () => {
        expect(refs(nextList(board, { ...all, backlog: false }))).not.toContain(`${HOME}#12`);
    });
    it("keeps the same-numbered task of a paused project in another repo out", () => {
        expect(refs(nextList(board, all))).not.toContain(`${OTHER}#10`);
    });
    it("caps size by the time toggle and shows unsized tasks only under any", () => {
        expect(refs(nextList(board, { ...all, time: "15m" }))).toEqual([`${HOME}#11`, `${OTHER}#23`, `${HOME}#22`, `${HOME}#24`]);
        expect(refs(nextList(board, { ...all, time: "1h" }))).toEqual([`${HOME}#11`, `${OTHER}#23`, `${HOME}#22`, `${HOME}#10`, `${HOME}#24`]);
        expect(refs(nextList(board, { ...all, time: "half-day" }))).toContain(`${HOME}#12`);
        expect(refs(nextList(board, { ...all, time: "half-day" }))).not.toContain(`${HOME}#20`);
    });
    it("hides lab tasks at home", () => {
        expect(refs(nextList(board, { ...all, place: "home" }))).not.toContain(`${HOME}#24`);
    });
    it("filters by the task's own area, falling back to its project's", () => {
        expect(refs(nextList(board, { ...all, area: "Research" }))).toEqual([`${HOME}#11`, `${HOME}#10`, `${HOME}#24`, `${HOME}#12`]);
    });
});

describe("dueSoon", () => {
    it("keeps open tasks due within 7 days, soonest first, then by repo and number", () => {
        expect(refs(dueSoon(board, "all", "2026-11-15"))).toEqual([`${OTHER}#23`, `${HOME}#22`]);
        expect(dueSoon(board, "all", "2026-11-12")).toEqual([]);
    });
    it("filters by area", () => {
        expect(dueSoon(board, "Research", "2026-11-15")).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd app && npx vitest run src/lib/next.test.ts`
Expected: FAIL. Old filter names are used and `area` is unknown.

- [ ] **Step 3: Rewrite `app/src/lib/next.ts`**

```ts
import { priorityRank, projectOf, type BoardItem } from "../../../worker/src/types";

/** Choices of the time toggle: how long you have, or `any` for every task including unsized ones. */
export const TIMES: string[] = ["15m", "1h", "half-day", "any"];

// sizes that fit each time choice
const FITS: Record<string, string[]> = { "15m": ["XS"], "1h": ["XS", "S"], "half-day": ["XS", "S", "M"] };

/** Choices of the place toggle. `home` hides tasks labelled `lab`. */
export const PLACES: string[] = ["home", "lab"];

/** How far ahead a due date counts as soon, in days. */
const DUE_SOON_DAYS = 7;

/** The toggles of the Next page. */
export interface NextFilters {
    /** one of `TIMES` */
    time: string;
    /** one of `PLACES` */
    place: string;
    /** an Area name, or `all` */
    area: string;
    /** also list `Backlog` tasks, after the rest */
    backlog: boolean;
}

/**
 * A task's area: its own, else its project's.
 *
 * Args:
 *     items: The whole board.
 *     task: The task.
 */
export function areaOf(items: BoardItem[], task: BoardItem): string | null {
    return task.area ?? projectOf(items, task)?.area ?? null;
}

// true when the task is in the area; every task is in `all`
function inArea(items: BoardItem[], task: BoardItem, area: string): boolean {
    return area === "all" || areaOf(items, task) === area;
}

// true when the task's size fits the time toggle; unsized tasks fit only `any`
function fitsTime(task: BoardItem, time: string): boolean {
    if (time === "any") return true;
    return task.size !== null && (FITS[time] ?? []).includes(task.size);
}

// the date `days` after a YYYY-MM-DD date, in the same form
function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// tie-break shared by both lists so equal tasks keep a stable order across repos
function byRepoNumber(a: BoardItem, b: BoardItem): number {
    return a.repo.localeCompare(b.repo) || a.number - b.number;
}

/**
 * Open tasks that are overdue or due within 7 days, soonest first, blocked or not. Not filtered by time or place.
 *
 * Args:
 *     items: The whole board.
 *     area: An Area name, or `all`.
 *     today: Today's local date, YYYY-MM-DD.
 */
export function dueSoon(items: BoardItem[], area: string, today: string): BoardItem[] {
    const limit = addDays(today, DUE_SOON_DAYS);
    return items
        .filter((t) => t.open && !t.isProject && t.due !== null && t.due <= limit && inArea(items, t, area))
        .sort((a, b) => a.due!.localeCompare(b.due!) || byRepoNumber(a, b));
}

/**
 * What can be done now: open, unblocked tasks that pass the toggles. A flat task qualifies on its own status; a project task also needs its project In progress. Order: In progress (most recently updated first), then To do, then Backlog if asked for; the last two by priority (the task's own, else its project's), due date, repo and number.
 *
 * Args:
 *     items: The whole board.
 *     filters: The toggles.
 */
export function nextList(items: BoardItem[], filters: NextFilters): BoardItem[] {
    const groups = filters.backlog ? ["In progress", "To do", "Backlog"] : ["In progress", "To do"];
    const group = (t: BoardItem): number => groups.indexOf(t.status ?? "");
    const rank = (t: BoardItem): number => priorityRank(t.priority ?? projectOf(items, t)?.priority ?? null);
    return items
        .filter((t) => {
            const project = projectOf(items, t);
            return (
                t.open &&
                !t.isProject &&
                !t.blocked &&
                group(t) !== -1 &&
                (!project || project.status === "In progress") &&
                inArea(items, t, filters.area) &&
                fitsTime(t, filters.time) &&
                (filters.place === "lab" || !t.lab)
            );
        })
        .sort((a, b) => {
            if (group(a) !== group(b)) return group(a) - group(b);
            if (a.status === "In progress") return b.updatedAt.localeCompare(a.updatedAt);
            return rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || byRepoNumber(a, b);
        });
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd app && npx vitest run src/lib/next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/next.ts app/src/lib/next.test.ts
git commit -m "app: next list on areas, sizes, lab label and flat tasks"
```

---

### Task 5: App API, routes and board state on refs

**Files:**
- Modify: `app/src/lib/api.ts`
- Create: `app/src/lib/route.ts` (pure route parsing, testable without `window`)
- Modify: `app/src/lib/router.svelte.ts` (whole file)
- Modify: `app/src/lib/board.svelte.ts`
- Delete: `app/src/lib/categories.ts`; create `app/src/lib/areas.ts`
- Test: `app/src/lib/api.test.ts`, `app/src/lib/route.test.ts`

**Interfaces:**
- Consumes: the HTTP contract from Task 3; `parseRef` from types; `REPOS` and `HOME_REPO` from `worker/src/config`.
- Produces:
  - `api.ts`: `issuePath(ref)`, `fetchDetail(ref)`, `postTask(title, repo)`, `deleteTask(ref)`, `closeTaskNotPlanned(ref)`, `StatusWrite { id; ref; status }`, and re-exports `REPOS` and `HOME_REPO`.
  - `route.ts`: `Route` = inbox | next | settings | `{ page: "area"; name }` | `{ page: "project"; ref }`, `parseRoute(hash)`, `areaHref(name)`, `projectHref(ref)`.
  - `board.svelte.ts`: `board.selected: string | null` (a ref), `select(ref | null)`, `areaNames(items)`, `projectsIn(items, area)`, `tasksOf(items, projectRef)`, `flatTasksIn(items, area)`, `inboxTasks`, `changeStatus`, `changePriority`, `removeTask`, `dropTask`.
  - `areas.ts`: `areaSummary(name): string`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { issuePath } from "./api";

describe("issuePath", () => {
    it("builds the worker path for repos with dots and dashes", () => {
        expect(issuePath("Shastri-Lab/polymerNN#3")).toBe("/issues/Shastri-Lab/polymerNN/3");
        expect(issuePath("QNLQueens/QNL-Wafer-Database#12")).toBe("/issues/QNLQueens/QNL-Wafer-Database/12");
    });
    it("throws on a malformed ref", () => {
        expect(() => issuePath("nope")).toThrow("bad ref nope");
    });
});
```

Create `app/src/lib/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { areaHref, parseRoute, projectHref } from "./route";

describe("parseRoute", () => {
    it("round-trips a project ref with dots, dashes and a hash", () => {
        const ref = "QNLQueens/QNL-Wafer-Database#12";
        expect(parseRoute(projectHref(ref))).toEqual({ page: "project", ref });
    });
    it("round-trips an area", () => {
        expect(parseRoute(areaHref("Research"))).toEqual({ page: "area", name: "Research" });
    });
    it("falls back to the inbox", () => {
        expect(parseRoute("")).toEqual({ page: "inbox" });
        expect(parseRoute("#/project/")).toEqual({ page: "inbox" });
        expect(parseRoute("#/project/notaref")).toEqual({ page: "inbox" });
    });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd app && npx vitest run src/lib/api.test.ts src/lib/route.test.ts`
Expected: FAIL. `issuePath` is not exported, and `./route` does not exist.

- [ ] **Step 3: Update `app/src/lib/api.ts`** (2-space indent)

Change the first two lines to:

```ts
import { parseRef, type BoardItem, type ItemDetail } from "../../../worker/src/types";
export type { BoardItem, ItemDetail };
export { HOME_REPO, REPOS } from "../../../worker/src/config";
```

Replace everything from `/** One Status the Worker changed` to the end of the file with:

```ts
/** One Status the Worker changed, which may include tasks paused along with a project. */
export interface StatusWrite {
  id: string;
  ref: string;
  status: string;
}

/** The Worker path of an issue, e.g. `owner/name#3` → `/issues/owner/name/3`. Throws on a malformed ref. */
export function issuePath(ref: string): string {
  const parsed = parseRef(ref);
  if (!parsed) throw new Error(`bad ref ${ref}`);
  return `/issues/${parsed.repo}/${parsed.number}`;
}

/** Fetches every board item from the Worker. */
export function fetchBoard(): Promise<BoardItem[]> {
  return request("/board");
}

/** Fetches an issue's body and comments as HTML. */
export function fetchDetail(ref: string): Promise<ItemDetail> {
  return request(`${issuePath(ref)}/detail`);
}

/** Asks the Worker to set an item's status. Returns every status it changed. Throws the board rule's reason if it refuses. */
export async function postStatus(id: string, status: string): Promise<StatusWrite[]> {
  return (await request<{ writes: StatusWrite[] }>(`/items/${id}/status`, { status })).writes;
}

/** Asks the Worker to create a task in a repo; it lands in the board's Inbox. Returns the new issue's number and address. */
export function postTask(title: string, repo: string): Promise<{ number: number; url: string }> {
  return request("/tasks", { title, repo });
}

/** Asks the Worker to permanently delete an inbox task's issue. Throws the Worker's reason if it refuses. */
export function deleteTask(ref: string): Promise<void> {
  return request(issuePath(ref), undefined, "DELETE");
}

/** Asks the Worker to close a triaged task's issue as not planned. Throws the Worker's reason if it refuses. */
export function closeTaskNotPlanned(ref: string): Promise<void> {
  return request(`${issuePath(ref)}/not-planned`, {});
}

/** Asks the Worker to set an item's priority. Throws the board rule's reason if it refuses. */
export async function postPriority(id: string, priority: string): Promise<void> {
  await request(`/items/${id}/priority`, { priority });
}
```

- [ ] **Step 4: Create `app/src/lib/route.ts` and rewrite `router.svelte.ts`**

`app/src/lib/route.ts`:

```ts
import { parseRef } from "../../../worker/src/types";

/** The page the hash points at. */
export type Route =
    | { page: "inbox" }
    | { page: "next" }
    | { page: "settings" }
    | { page: "area"; name: string }
    | { page: "project"; ref: string };

/** Turns a hash such as `#/project/st4eve%2FMyLife%2312` into a route. Unknown or malformed hashes give the inbox. */
export function parseRoute(hash: string): Route {
    const [page, ...rest] = hash.replace(/^#\/?/, "").split("/");
    const arg = decodeURIComponent(rest.join("/"));
    if (page === "next" || page === "settings") return { page };
    if (page === "area" && arg) return { page, name: arg };
    if (page === "project" && parseRef(arg)) return { page, ref: arg };
    return { page: "inbox" };
}

/** Hash link to an area page. */
export function areaHref(name: string): string {
    return `#/area/${encodeURIComponent(name)}`;
}

/** Hash link to a project page; the ref is encoded so `/` and `#` survive. */
export function projectHref(ref: string): string {
    return `#/project/${encodeURIComponent(ref)}`;
}
```

`app/src/lib/router.svelte.ts`:

```ts
import { parseRoute, type Route } from "./route";
export { areaHref, parseRoute, projectHref, type Route } from "./route";

let hash = $state(location.hash);
window.addEventListener("hashchange", () => (hash = location.hash));

/** The current route, updates when the hash changes. */
export const router = {
    get route(): Route {
        return parseRoute(hash);
    },
};
```

- [ ] **Step 5: Update `app/src/lib/board.svelte.ts`**

Make these replacements:

- `selected: number | null` becomes `selected: string | null` in the type of `board`. Change its doc to say "`selected` is the ref of the task whose sheet is open".
- `select`:

```ts
/** Opens the detail sheet for a task by ref, or closes it with `null`. */
export function select(ref: string | null): void {
    board.selected = ref;
}
```

- Replace `categoryNames`, `projectsIn`, `tasksOf` with:

```ts
/** Area names that have an open project or an open, triaged flat task, sorted. */
export function areaNames(items: BoardItem[]): string[] {
    const names = items.filter((i) => i.open && (i.isProject || (i.parent === null && i.status !== "Inbox"))).map((i) => i.area);
    return [...new Set(names.filter((n): n is string => n !== null))].sort();
}

/** Open projects in one area, highest priority first, then repo and number. */
export function projectsIn(items: BoardItem[], area: string): BoardItem[] {
    return openProjects(items)
        .filter((p) => p.area === area)
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.repo.localeCompare(b.repo) || a.number - b.number);
}

/** Open, triaged tasks in one area that belong to no project, highest priority first. */
export function flatTasksIn(items: BoardItem[], area: string): BoardItem[] {
    return items
        .filter((i) => i.open && !i.isProject && i.area === area && i.status !== "Inbox" && !projectOf(items, i))
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.repo.localeCompare(b.repo) || a.number - b.number);
}

/** Open tasks of one project, by repo then issue number. */
export function tasksOf(items: BoardItem[], project: string): BoardItem[] {
    return items
        .filter((i) => i.open && !i.isProject && i.parent === project)
        .sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
}
```

Change the first import to `import { priorityRank, projectOf } from "../../../worker/src/types";`.

- In `apply`, change the comment to `// shows what the Worker changed; a Done task is closed, so it leaves the open lists` and the line to `item.open = w.status !== "Done";`.
- In `changeStatus`: `apply([{ id: item.id, ref: item.ref, status }]);`
- In `changePriority`, change the doc to "Sets an item's priority".
- In `removeTask`: `await deleteTask(item.ref);`
- In `dropTask`: `await closeTaskNotPlanned(item.ref);` and `item.status = "Done";`
- In `inboxTasks`, filter on `i.status === "Inbox"`, sort with `(a, b) => b.updatedAt.localeCompare(a.updatedAt)` (numbers no longer compare across repos), and change the doc to "Open tasks in the Inbox, most recently changed first."

- [ ] **Step 6: Replace categories with areas**

Delete `app/src/lib/categories.ts`. Create `app/src/lib/areas.ts`:

```ts
// one line under each area's heading; areas missing here show no summary
const summaries: Record<string, string> = {
    Course: "classes, assignments and exams",
    Research: "lab work, papers and experiments",
    Personal: "life outside work",
    Admin: "forms, email and errands",
};

/** The one-line summary shown on an area page, or an empty string. */
export function areaSummary(name: string): string {
    return summaries[name] ?? "";
}
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `cd app && npx vitest run`
Expected: api, route and next tests PASS. `npm run check` still fails in components until Task 6.

- [ ] **Step 8: Commit**

```bash
git add -A app/src/lib
git commit -m "app: key api calls, routes and board state by ref"
```

---

### Task 6: UI on refs, areas and the new vocabulary

**Files (all under `app/src`):**
- Modify: `components/Icon.svelte:33-35`, `theme.css:55-58,102-105,142-145`, `components/Board.svelte`, `components/StatusMenu.svelte`, `components/PriorityMenu.svelte`, `components/Card.svelte`, `components/DetailSheet.svelte`, `components/AddTaskDialog.svelte`, `components/BottomBar.svelte`, `components/Sidebar.svelte`, `pages/Inbox.svelte`, `pages/Next.svelte`, `pages/Project.svelte`, `pages/Settings.svelte:88`, `App.svelte:33-36,49,129-132`
- Rename: `pages/Category.svelte` → `pages/Area.svelte`

**Interfaces:**
- Consumes: everything Task 5 produces; `statusSlug`, `allowedStatuses`, `PRIORITIES` from types; `HOME_REPO`, `REPOS` via `api.ts`.
- Produces: `areaIcon(area): IconName` in `Icon.svelte`.

Read each file before editing it. The changes below are exact. Lines not mentioned stay as they are.

- [ ] **Step 1: Icons and status colours**

In `components/Icon.svelte` replace `categoryIcon` with:

```ts
    /** The icon for a board Area, a folder for any other. */
    export function areaIcon(area: string): IconName {
        const icons: Record<string, IconName> = { Course: "degree", Research: "next", Personal: "personal", Admin: "settings" };
        return icons[area] ?? "folder";
    }
```

In `theme.css`, in all three blocks, rename `--st-next` to `--st-to-do` and `--st-doing` to `--st-in-progress`:

```bash
sed -i '' -e 's/--st-next:/--st-to-do:/' -e 's/--st-doing:/--st-in-progress:/' app/src/theme.css
```

In `components/Board.svelte` and `components/StatusMenu.svelte`, wherever a status builds a CSS variable (`var(--st-{status})`, `--st-{item.status}`, and so on), use `statusSlug(...)` imported from `../../../worker/src/types`, for example `style="--st: var(--st-{statusSlug(status)})"`. Leave `data-status={status}` as the raw name; `querySelector(\`[data-status="${start}"]\`)` works with spaces.

- [ ] **Step 2: Priority menu for tasks**

In `components/PriorityMenu.svelte`, change the doc to "An item's priority (project or task)". The level formula `PRIORITIES.indexOf(item.priority ?? "") + 1 || 4` stays. With three priorities, `--pr-4` now means "none", which is already its grey.

- [ ] **Step 3: Card**

In `components/Card.svelte`:
- Import `HOME_REPO` from `../lib/api` and `projectOf` from types.
- The project title lookup becomes `projectOf(board.items, item)?.title`.
- Drag data becomes `setData("text/plain", item.ref)`.
- `taskCount` becomes `tasksOf(board.items, item.ref).length`.
- `draggable={item.status !== "Inbox"}`.
- Project link: `href={projectHref(item.ref)}`. Task button: `onclick={() => select(item.ref)}`. aria label: `open issue {item.ref}`.
- Chips: drop the `#number` chip and the kind and effort chips. Add the following, in this order:

```svelte
{#if item.repo !== HOME_REPO}<span class="chip">{item.repo.split("/")[1]}</span>{/if}
{#if item.lab}<span class="chip">lab</span>{/if}
{#if item.size}<span class="chip">{item.size}</span>{/if}
{#if !item.isProject && item.priority}<span class="chip">{item.priority}</span>{/if}
```

  Keep the existing due chip after these.

- [ ] **Step 4: Detail sheet**

In `components/DetailSheet.svelte`:
- `let item = $derived(board.items.find((i) => i.ref === board.selected && !i.isProject));`
- The effect calls `fetchDetail(item.ref)`.
- Show `StatusMenu` when `item.status !== "Inbox"` (was `item.parent !== null`). Add `<PriorityMenu {item} />` beside it.
- Chips: the same four as the card, then due.
- The issue link text becomes `{item.ref}`.
- The trash action:

```ts
    // an inbox task in a repo the token admins is deleted; anything else is closed as not planned
    let deletes = $derived(item?.status === "Inbox" && item.canDelete);
```

  The button and the confirm call `deletes ? removeTask(item) : dropTask(item)`. The aria-label and confirm text use `deletes ? "delete task" : "close as not planned"`.

- [ ] **Step 5: Add-task box with a repo picker**

In `components/AddTaskDialog.svelte`:
- Import `HOME_REPO`, `REPOS` from `../lib/api`.
- Add `let repo = $state(HOME_REPO);`.
- Change the prop type to `onsubmit: (title: string, repo: string) => void`.
- Add this inside the form, above the submit button:

```svelte
<label>
    repo
    <select bind:value={repo}>
        {#each REPOS as r (r)}<option value={r}>{r}</option>{/each}
    </select>
</label>
```

- Submit calls `onsubmit(title, repo)`.

- [ ] **Step 6: Inbox page**

In `pages/Inbox.svelte`:
- Pending rows become `{ key, ref, title }`.
- The submit handler takes `(title: string, repo: string)` and calls `const { number } = await postTask(title, repo); const ref = \`${repo}#${number}\`;`.
- The poll checks `board.items.some((t) => t.ref === ref)` (still 6 tries, 2500 ms apart).
- Replace the copied triage prompt text with:

```
Triage my inbox on the task_planner board (GitHub Project st4eve #2) with the MyLife planner skill. For each Inbox item (refs like owner/name#n): set Area, Size and Priority, set Status to To do or Backlog, and add it as a sub-issue of a `project` issue if it belongs to one.
```

- [ ] **Step 7: Next page**

In `pages/Next.svelte`, rename `category` to `area` throughout: the filter field, the `localStorage` key `attask.next.area`, the list `["all", ...areaNames(board.items)]`, and `dueSoon(board.items, area, today)`. The old key `attask.next.category` is simply ignored.

- [ ] **Step 8: Area and Project pages**

```bash
git mv app/src/pages/Category.svelte app/src/pages/Area.svelte
```

`pages/Area.svelte` renders the summary, the project board, and the flat tasks:

```svelte
<script lang="ts">
    import Board from "../components/Board.svelte";
    import Card from "../components/Card.svelte";
    import { areaSummary } from "../lib/areas";
    import { board, flatTasksIn, projectsIn } from "../lib/board.svelte";

    /**
     * One Area: its projects as a board, then its open tasks that belong to no project.
     *
     * Args:
     *   name: the Area option name.
     */
    let { name }: { name: string } = $props();
    let flat = $derived(flatTasksIn(board.items, name));
</script>

{#if areaSummary(name)}<p class="summary">{areaSummary(name)}</p>{/if}
<Board statuses={["Backlog", "In progress", "Waiting"]} items={projectsIn(board.items, name)} start="In progress" />
{#if flat.length}
    <h3>tasks</h3>
    <ul class="flat">
        {#each flat as item (item.ref)}<li><Card {item} /></li>{/each}
    </ul>
{/if}
```

Keep the `.summary` style from the old page and add `.flat { list-style: none; padding: 0; display: grid; gap: 0.5rem; }`.

In `pages/Project.svelte`:
- The prop becomes `let { ref }: { ref: string } = $props();`.
- `project = $derived(board.items.find((i) => i.ref === ref && i.isProject))`.
- `start` is the project's status if it is `"Backlog"` or `"Waiting"`, else `"In progress"`.
- The back link becomes `areaHref(project.area)` when `project.area` is set.
- `<Board statuses={["Backlog", "To do", "In progress", "Waiting"]} items={tasksOf(board.items, ref)} {start} />`.
- The missing message becomes `no project {ref}`.

- [ ] **Step 9: Bars, sidebar, app shell, settings**

- `components/BottomBar.svelte` uses `areaNames`, `areaIcon` and `areaHref`. A project page's area comes from `board.items.find((i) => i.ref === route.ref)?.area`, and the active check uses `route.page === "area"`.
- `components/Sidebar.svelte`: the heading `categories` becomes `areas`. Projects filter on `p.area === name`. The active check is `router.route.page === "project" && router.route.ref === project.ref`, with `href={projectHref(project.ref)}` and `{#each ... (project.ref)}`.
- `App.svelte`:
  - Title: `case "area": return route.name;` and `case "project": return board.items.find((i) => i.ref === route.ref && i.isProject)?.title ?? route.ref;`.
  - `headProject` looks up by `i.ref === route.ref && i.isProject`.
  - Import `Area` in place of `Category`, then `{:else if router.route.page === "area"}<Area name={router.route.name} />` and `<Project ref={router.route.ref} />`.
- `pages/Settings.svelte:88`: the source link points at `https://github.com/st4eve/attask`.

- [ ] **Step 10: Run the full gate**

Run:
```bash
cd app && npm run check && npx vitest run
cd ../worker && npm run cf-typegen && npx tsc --noEmit && npx vitest run --passWithNoTests
```
Expected: `svelte-check found 0 errors and 0 warnings`, and every test passes. Then run `grep -rn "category\|effort\|\.kind\|\"doing\"\|\"next\"\|\"inbox\"\|\"done\"" app/src --include='*.svelte' --include='*.ts'`. It should print only the `next` route and page names, nothing about statuses or old fields.

- [ ] **Step 11: Look at it in the browser**

Run `cd worker && npx wrangler dev` and `cd app && npm run dev`, but only once the owner has put a token in `worker/.dev.vars` (Task 8, step 1). Without a token, check with `npm run build` that it compiles and skip the live look. On the real board, read only: Inbox, Next with each toggle, an Area page, a Project page, and the detail sheet. Change nothing here.

- [ ] **Step 12: Commit**

```bash
git add -A app/src
git commit -m "app: areas, refs, repo picker, lab and size chips, task priorities"
```

---

### Task 7: Docs, and Backlog in the MyLife planner

**Files:**
- Modify: `CLAUDE.md`, `docs/deploy.md`, `worker/.dev.vars.example` (if it names the old origin)
- In MyLife, on local branch `task-planner`: `.claude/skills/planner/planner.py:22` plus its test file under `.claude/skills/planner/tests/`

- [ ] **Step 1: Update `CLAUDE.md`**

- Intro: "...for viewing and editing the owner's task board: GitHub Project #2 ("task_planner") of user `st4eve`, which holds issues from several repos. The design is `docs/superpowers/specs/2026-11-25-task-planner-board-design.md`. Owner-specific values are in `worker/src/config.ts`."
- Layout: `src/types.ts` **and `src/config.ts`** are imported by the app.
- Gate: the worker tests cover `rules.ts`, `paths.ts` and `github.ts` parsing. The app tests cover `next.ts`, `route.ts` and `issuePath`.
- Safety: "The Worker's token is a classic token (`repo` + `project`) with write access to the repos in `REPOS` and board #2. Test every write on a throwaway issue titled `attask test – delete me` in `st4eve/MyLife`, never on real items, and delete it afterwards."
- Workflow: "Branch, land by PR into the fork's `main` (`gh repo set-default st4eve/attask` first); never push to or open PRs against `jewaniuk/attask`."

- [ ] **Step 2: Update `docs/deploy.md`**

Replace `jewaniuk` origins and board references with `https://st4eve.github.io`, `/attask/`, project `st4eve` #2, and "add the `Backlog` option to the board's Status field once". Run `grep -rn jewaniuk . --exclude-dir=node_modules --exclude-dir=.git`. The only matches left should be upstream credit (for example the README).

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md docs/deploy.md worker/.dev.vars.example
git commit -m "docs: name the task_planner board, owner and origin"
```

- [ ] **Step 4: Add Backlog to the MyLife planner (separate repo, via a worktree)**

Leave the checked-out `lab-notebooks` branch in `/Users/st4eve/Desktop/MyLife` alone.

```bash
git -C /Users/st4eve/Desktop/MyLife worktree add /Users/st4eve/Desktop/MyLife-task-planner task-planner
```

In `/Users/st4eve/Desktop/MyLife-task-planner/.claude/skills/planner/planner.py` line 22:

```python
STATUSES = ["Inbox", "Backlog", "To do", "In progress", "Waiting", "Done"]
```

Add to the planner's existing test file, next to its other `check_choice` tests:

```python
def test_check_choice_accepts_backlog():
    assert check_choice("Status", "backlog") == "Backlog"
```

Run from the worktree root:
`/Users/st4eve/Desktop/MyLife/.claude/skills/vault-maintain/.venv/bin/python -m pytest .claude/skills/planner/tests -q`
Expected: all pass.

```bash
git -C /Users/st4eve/Desktop/MyLife-task-planner commit -am "planner: add Backlog status to match the board and attask"
git -C /Users/st4eve/Desktop/MyLife worktree remove /Users/st4eve/Desktop/MyLife-task-planner
```

Do not push. Tell the owner the commit is on the local `task-planner` branch.

---

### Task 8: Deploy and live checks (needs the owner at several steps)

Each step marked **owner** is done by the owner. Claude never sees or types the token or app key.

- [ ] **Step 1 (owner): Add the Backlog option.** On github.com, open project #2's Status field and add `Backlog`. Until then, any write that needs Backlog fails with `board has no Status option "Backlog"`, which is expected.
- [ ] **Step 2 (owner): Cloudflare and secrets.** Create a Cloudflare account, run `cd worker && npx wrangler login`, then `npx wrangler secret put GITHUB_TOKEN` (classic token, `repo` + `project`) and `npx wrangler secret put APP_KEY` (a long random string), each at the hidden prompt.
- [ ] **Step 3: Deploy the Worker.** Run `cd worker && npx wrangler deploy` and note the `*.workers.dev` URL. Check `curl -s -o /dev/null -w '%{http_code}' <url>/board`. Expected: `401`.
- [ ] **Step 4: Open the PR and enable Pages.** `gh repo set-default st4eve/attask`, push the branch to `origin` (the fork) and open a PR into `main`. The owner squash-merges it. Then `gh api -X POST repos/st4eve/attask/pages -f build_type=workflow` (or set Settings → Pages → Source to GitHub Actions). Expected: after the Pages workflow runs on `main`, `https://st4eve.github.io/attask/` loads.
- [ ] **Step 5 (owner): Phone setup.** Open `https://st4eve.github.io/attask/`, enter the Worker URL and app key in Settings, then Add to Home Screen.
- [ ] **Step 6: Live write checks, on the throwaway issue only.** From the app, add a task titled `attask test – delete me` to `st4eve/MyLife`.
  1. It appears in the Inbox with status Inbox.
  2. Delete it from the detail sheet. It disappears from the board and the issue is gone.
  3. Add a second throwaway, move it out of Inbox with the planner, then in attask set its status to To do and In progress, set its priority to P2, and close it as not planned. Each change shows on github.com.
  4. Delete the second throwaway on github.com (or with `gh issue delete`). Confirm with the owner first, since it cannot be undone.
- [ ] **Step 7: Report.** List what was checked, the Worker URL, the Pages URL, and anything that failed with its message.
