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
