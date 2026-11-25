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
