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
