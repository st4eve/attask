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
		expect(refs(planStatus(board, id('st4eve/MyLife', 1), 'Waiting'))).toEqual(['st4eve/MyLife#1', 'st4eve/MyLife#10', 'st4eve/MyLife#11']);
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
