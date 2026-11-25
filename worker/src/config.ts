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
