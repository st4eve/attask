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
