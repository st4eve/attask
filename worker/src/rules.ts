import type { BoardField } from './github';
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
 * Checks that an issue may be closed as not planned: an open task that is triaged, or an inbox task the token cannot delete (an inbox task it can delete is deleted instead). Projects are never dropped from attask.
 *
 * Args:
 * 	item: The board item, undefined if the issue is not on the board.
 *
 * Returns:
 * 	null if allowed, else the reason to refuse.
 */
export function checkNotPlanned(item: BoardItem | undefined): string | null {
	if (!item || !item.open || item.isProject || (item.status === 'Inbox' && item.canDelete)) {
		return 'only open, triaged tasks can be closed as not planned';
	}
	return null;
}

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
		if (!known) return { ok: false, reason: `board has no ${field} option "${option}"` };
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
