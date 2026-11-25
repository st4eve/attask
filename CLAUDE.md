# attask

Mobile-first web app (PWA, installable on the home screen) for viewing and editing the user's task board: GitHub Project #2 ("task_planner") of user `st4eve`, which holds issues from several repos. The design is `docs/superpowers/specs/2026-11-25-task-planner-board-design.md`. Owner-specific values are in `worker/src/config.ts`.

The repo is public and holds no board data. Never commit tokens, keys or real task content.

## Layout

Two independent packages, no npm workspaces. Run npm commands inside each. `tools/` holds phone testing helpers (Playwright, USB iPhone inspector), see `docs/mobile-testing.md` and the `phone-test` skill; it is not part of the gate. `tools/make-icons.mjs` redraws the app icons. Deploy steps: `docs/deploy.md`.

- `app/` Vite + Svelte 5 + TypeScript, plain CSS, hash router. Deployed to GitHub Pages.
- `worker/` Cloudflare Worker. Holds the GitHub token, exposes a few board actions, applies the board rules. `src/types.ts` and `src/config.ts` are imported by the app too, so keep it free of Worker-only code.

## Run

Two terminals, each from its own directory:

- `cd worker && npx wrangler dev --ip 0.0.0.0` serves `localhost:8787`.
- `cd app && npm run dev -- --host` serves `localhost:5173` and the LAN address for the phone.

Local secrets live in `worker/.dev.vars` (git-ignored, copy `.dev.vars.example`): `GITHUB_TOKEN`, `APP_KEY`, and `ALLOWED_ORIGINS` (comma-separated, include the Mac's LAN origin for phone testing). Restart `wrangler dev` after editing it. The app stores the Worker URL and app key in `localStorage` through its Settings page. The user enters them once per device.

## Gate

Run before every PR. All must pass.

- `cd app && npm run check`
- `cd app && npx vitest run` (unit tests cover `next.ts`, `route.ts` and `issuePath`)
- `cd worker && npm run cf-typegen && npx tsc --noEmit`
- `cd worker && npx vitest run --passWithNoTests` (unit tests cover `rules.ts`, `paths.ts` and `github.ts` parsing)

## Workflow

Agent mode: branch, implement one checkpoint, land by PR into the fork's `main` (`gh repo set-default st4eve/attask` first), never push to or commit on `main`, never merge; never push to or open PRs against `jewaniuk/attask`. The user reviews and squash-merges. Follow the PR format in `~/.claude/CLAUDE.md`.

Work in checkpoints, one PR each. At the end of each, the PR's "needs you" lists what to try on desktop and on the phone, and the user's feedback steers the next one.

1. App shell: router, sidebar (drawer on mobile), theme.
2. Read-only boards: Board, Card, Category and Project pages.
3. Editing: Inbox, Next, StatusMenu, `POST /items/<id>/status`, `rules.ts`.
4. Add-task box: `POST /tasks`.
5. Deploy: PWA manifest and icons, Pages workflow, install on the phone.

The user is learning web app design by conversation. Before implementing each checkpoint, explain the concepts it uses (briefly, defining jargon) and give your recommendation. Keep the code simple enough to read.

## Safety

The Worker's token is a classic token (`repo` + `project`) with write access to the repos in `REPOS` and board #2. Test every write on a throwaway issue titled `attask test – delete me` in `st4eve/MyLife`, never on real items, and delete it afterwards. Never put a token or app key in a command that gets logged, a commit, or an issue comment.

## Code style

- Inline comments lowercase with minimal punctuation. `/** */` on every exported item, Google-style sections (`Args:`, `Returns:`) where they add something. Update affected docs whenever code changes.
- Explicit types. No `any` beyond the one untyped GraphQL response in `worker/src/github.ts` unless there is no alternative.
- No speculative abstraction or premature error handling.
- Format with the package's Prettier config (`worker/.prettierrc`); keep each package consistent with itself.
