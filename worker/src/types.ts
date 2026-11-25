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
