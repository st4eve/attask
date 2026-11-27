import { describe, expect, it } from 'vitest';
import { TriageError, buildTriageRequest, readAnswer, runTriage, validateProposals, type Ask, type RawProposal } from '../src/triage';
import type { BoardField, Board } from '../src/github';
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
	{
		id: 'F_area',
		name: 'Area',
		options: [
			{ id: 'a1', name: 'Research' },
			{ id: 'a2', name: 'Personal' },
		],
	},
	{
		id: 'F_size',
		name: 'Size',
		options: [
			{ id: 'z1', name: 'S' },
			{ id: 'z2', name: 'M' },
		],
	},
	{
		id: 'F_prio',
		name: 'Priority',
		options: [
			{ id: 'p1', name: 'P1' },
			{ id: 'p2', name: 'P2' },
		],
	},
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
			{
				id: 'id-st4eve/MyLife-10',
				ref: 'st4eve/MyLife#10',
				title: 'Fix "the" plot',
				area: null,
				size: null,
				priority: null,
				lab: true,
				parent: null,
			},
			{
				id: 'id-st4eve/MyLife-11',
				ref: 'st4eve/MyLife#11',
				title: 'Buy soil',
				area: null,
				size: null,
				priority: null,
				lab: false,
				parent: null,
			},
		]);
		expect(JSON.stringify(req)).not.toContain('url');
	});
});

describe('validateProposals', () => {
	const check = (r: RawProposal[]) => validateProposals(r, items, fields);

	it('keeps a valid proposal and takes the ref from the board', () => {
		expect(check([raw({ area: 'Research', size: 'S', priority: 'P1', parent: 'st4eve/MyLife#1', reason: 'thesis figure' })])).toEqual([
			{
				id: 'id-st4eve/MyLife-10',
				ref: 'st4eve/MyLife#10',
				area: 'Research',
				size: 'S',
				priority: 'P1',
				status: 'To do',
				parent: 'st4eve/MyLife#1',
				reason: 'thesis figure',
			},
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
	it("uses the paused status of the right repo's project", () => {
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

describe('runTriage', () => {
	const board: Board = { projectId: 'PVT_test', fields, items };

	it('does not call Claude when the inbox is empty', async () => {
		const ask: Ask = async () => {
			throw new Error('should not be called');
		};
		const empty: Board = { ...board, items: items.filter((i) => i.status !== 'Inbox') };
		expect((await runTriage(async () => empty, ask)).proposals).toEqual([]);
	});
	it('returns validated proposals and the options', async () => {
		const ask: Ask = async () => ({ refused: false, proposals: [raw({ area: 'Personal' }), raw({ id: 'made-up' })] });
		const out = await runTriage(async () => board, ask);
		expect(out.proposals.map((p) => [p.ref, p.area])).toEqual([['st4eve/MyLife#10', 'Personal']]);
		expect(out.options.size).toEqual(['S', 'M']);
	});
	it('turns a refusal into a TriageError', async () => {
		const ask: Ask = async () => ({ refused: true, proposals: null });
		await expect(runTriage(async () => board, ask)).rejects.toThrow(new TriageError('Claude declined to triage this inbox'));
	});
	it('turns an unparsed answer into a TriageError', async () => {
		const ask: Ask = async () => ({ refused: false, proposals: null });
		await expect(runTriage(async () => board, ask)).rejects.toThrow(new TriageError("Claude's answer could not be read"));
	});
});

describe('readAnswer', () => {
	const text = (t: string) => [{ type: 'text', text: t }];
	const answer = JSON.stringify({ proposals: [raw({})] });

	it('reads the proposals of a finished answer', () => {
		expect(readAnswer('end_turn', text(answer))).toEqual({ refused: false, proposals: [raw({})] });
	});
	it('marks a refusal even when its text is not JSON', () => {
		expect(readAnswer('refusal', text('{"propo'))).toEqual({ refused: true, proposals: null });
	});
	it('treats an answer cut off by max_tokens as unreadable', () => {
		expect(readAnswer('max_tokens', text(answer))).toEqual({ refused: false, proposals: null });
	});
	it('treats bad JSON, the wrong shape or no text as unreadable', () => {
		expect(readAnswer('end_turn', text('{"proposals": ['))).toEqual({ refused: false, proposals: null });
		expect(readAnswer('end_turn', text('{"proposals": [{"id": 1}]}'))).toEqual({ refused: false, proposals: null });
		expect(readAnswer('end_turn', [])).toEqual({ refused: false, proposals: null });
	});
});

describe('runTriage on a board that changed', () => {
	it('drops tasks that left the inbox while Claude was answering', async () => {
		const before: Board = { projectId: 'PVT_test', fields, items };
		const after: Board = {
			...before,
			items: items.map((i) => (i.number === 10 && i.repo === 'st4eve/MyLife' ? { ...i, status: 'In progress' } : i)),
		};
		const boards = [before, after];
		const ask: Ask = async () => ({ refused: false, proposals: [raw({}), raw({ id: 'id-st4eve/MyLife-11' })] });
		const out = await runTriage(async () => boards.shift()!, ask);
		expect(out.proposals.map((p) => p.ref)).toEqual(['st4eve/MyLife#11']);
	});
});

describe('tasks that already have a parent', () => {
	const withParents: BoardItem[] = [
		...items,
		item({ number: 14, parent: `${OTHER}#1`, title: 'Under the paused project' }),
		item({ number: 15, parent: 'st4eve/MyLife#11', title: 'Under a plain task' }),
	];

	it('sends the current parent to Claude', () => {
		const tasks = buildTriageRequest(withParents, fields).tasks;
		expect(tasks.find((t) => t.ref === 'st4eve/MyLife#14')?.parent).toBe(`${OTHER}#1`);
	});
	it('keeps the existing project and takes its paused status', () => {
		const [p] = validateProposals([raw({ id: 'id-st4eve/MyLife-14', parent: 'st4eve/MyLife#1', status: 'To do' })], withParents, fields);
		expect([p.parent, p.status]).toEqual([`${OTHER}#1`, 'Waiting']);
	});
	it('proposes no project when the existing parent is not a project', () => {
		const [p] = validateProposals([raw({ id: 'id-st4eve/MyLife-15', parent: 'st4eve/MyLife#1', status: 'To do' })], withParents, fields);
		expect([p.parent, p.status]).toEqual([null, 'To do']);
	});
});
