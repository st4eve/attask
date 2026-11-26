import { afterEach, describe, expect, it, vi } from 'vitest';
import page from './fixtures/board-page.json';
import { GithubError, addSubIssue, fetchDetail, parsePage, resolveOption, writeFields, type Board } from '../src/github';

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

describe('github errors', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('turns a graphql errors payload into a GithubError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ errors: [{ message: 'bad scope' }, { message: 'other' }] })),
		);
		const err = await fetchDetail('placeholder', 'example/repo', 1).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GithubError);
		expect((err as GithubError).message).toBe('github returned: bad scope; other');
	});

	it('turns a non-ok graphql response into a GithubError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ message: 'Bad credentials' }, { status: 401 })),
		);
		const err = await fetchDetail('placeholder', 'example/repo', 1).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GithubError);
		expect((err as GithubError).message).toBe('github returned 401: Bad credentials');
	});
});

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
		await expect(writeFields('placeholder', board, [{ id: 'I1', ref: 'a/b#1', field: 'Size', option: 'XL' }])).rejects.toThrow(
			'board has no Size option "XL"',
		);
		expect(sent).toHaveLength(0);
	});

	it('links a sub-issue across repos by node id', async () => {
		const sent = stub([
			{ repository: { issue: { id: 'PARENT' } } },
			{ repository: { issue: { id: 'CHILD' } } },
			{ addSubIssue: { issue: { number: 1 } } },
		]);
		await addSubIssue('placeholder', { id: 'I1', ref: 'Shastri-Lab/polymerNN#7', parent: 'st4eve/MyLife#1' });
		expect(sent[0].variables).toEqual({ o: 'st4eve', r: 'MyLife', n: 1 });
		expect(sent[1].variables).toEqual({ o: 'Shastri-Lab', r: 'polymerNN', n: 7 });
		expect(sent[2].query).toContain('addSubIssue');
		expect(sent[2].variables).toEqual({ parent: 'PARENT', child: 'CHILD' });
	});
});
