# Inbox triage in the Worker

Date: 2026-11-25
Status: approved, implemented on spec/inbox-triage

## Goal

Make the Inbox "triage inbox" button work from the phone. Today it opens `claude.ai/new?q=...`, a chat that cannot see the board. A spike showed Claude Code on the web cannot reach Projects v2 either, because its GitHub proxy blocks GraphQL. So the Worker, which already holds the GitHub token, asks the Claude API for triage proposals. The app shows them for review, and only approved changes are written.

## Scope

In scope:

- `POST /triage`: the Worker reads the board, asks Claude for one proposal per open Inbox task, validates them, and returns them. It writes nothing.
- `POST /items/<id>/fields`: sets Area and Size, which the app cannot set yet.
- `POST /items/<id>/parent`: adds a task as a sub-issue of a `project` issue. This changes the board spec, which put editing parent links out of scope. The change covers adding a parent only, for an item that has none.
- Inbox page: the triage button calls `/triage` and opens a review list with per-item apply, edit and skip, plus "apply all".

Out of scope:

- Triage of anything outside Inbox, and re-triage of items already triaged.
- Creating new `project` issues, changing or removing an existing parent.
- Running triage on a schedule or without the user pressing the button.
- Writing proposals back without review.

## 1. Worker endpoints

All routes keep the existing conventions: Bearer `APP_KEY`, CORS from `ALLOWED_ORIGINS`, `GithubError` and `BoardShapeError` become 409, anything else 500. Field and option ids are resolved by name on each request.

`POST /triage`, no body. Returns `{ proposals: Proposal[]; options: { area: string[]; size: string[]; priority: string[] } }`. `options` lists the board's option names so the review list's menus can offer them.

- Fetches the board, takes `inboxTasks` (open, non-project items with Status `Inbox`). If there are none, returns `{ proposals: [] }` without calling Claude.
- Sends Claude what it needs and nothing more (section 2), gets structured output, validates it (section 2), returns the valid proposals.
- `Proposal`, in `types.ts` so the app shares it:

  ```ts
  interface Proposal {
  	id: string; // project item id
  	ref: string; // owner/name#n
  	area: string | null;
  	size: string | null;
  	priority: string | null;
  	status: 'To do' | 'Backlog' | 'Waiting'; // Waiting only via a paused parent
  	parent: string | null; // ref of an open `project` issue
  	reason: string; // one short sentence
  }
  ```

`POST /items/<id>/fields`, body `{ area?: string; size?: string }`.

- New `planFields(items, fields, id, change)` in `rules.ts`: refuses if the item is missing or closed, or if a value is not an option of that field. Returns the writes that change something (none if both match).
- New `writeFields(token, board, write)` in `github.ts`, using the existing `setOptions`.

`POST /items/<id>/parent`, body `{ parent: string }` (a ref).

- New `planParent(items, id, parent)` in `rules.ts`: refuses if the item is missing, closed, a project, or already has a parent; or if `parent` is not an open `project` issue on the board. Asking for the parent the item already has is a no-op, so a row whose later writes failed can be applied again.
- New `addSubIssue(token, write)` in `github.ts`: looks up both issues' node ids, then calls GitHub's `addSubIssue` mutation. A sub-issue in another repo of the same owner is allowed by GitHub.
- After linking, if the project is paused, the task's allowed statuses narrow. The app applies the parent before the status (section 3). `planStatus` lets an Inbox item take any status, so the rule is enforced where proposals are made: `validateProposals` sets the status of a task under a paused project, and the review list offers only that status once such a project is chosen.

Status and Priority keep their existing routes.

## 2. Claude call, prompt and validation

New file `worker/src/triage.ts`. Pure parts (prompt building, validation) are separate from the call so they can be tested without the network.

The call, with `@anthropic-ai/sdk` and `zod`:

- Model `claude-opus-5-5`, `max_tokens: 16000`, no `thinking`, `output_config: { effort: "low", format: zodOutputFormat(TriageSchema) }`, through `client.messages.parse`.
- Server-side fallback is on: `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`, so a capacity error on the primary model is retried on a fallback by Anthropic instead of failing.
- If `stop_reason` is `"refusal"`, or `parsed_output` is null, the route returns 502 with a short message. The app shows it like other errors.
- Cheaper models (Sonnet 5.5, Haiku 5.5) would also handle this. The model id is one constant in `triage.ts`, so switching is a one-line change. Opus is the default because the call is rare (a button press) and judgment about areas and projects is the whole job.

What Claude receives:

- System prompt: the board rules in a few sentences (what Area, Size, Priority mean; To do versus Backlog; tasks of a paused project take the project's status; only link to listed projects; leave a value null when unsure).
- User message, as JSON:
  - `options`: the board's Area, Size and Priority options, read from the board fields.
  - `projects`: open `project` issues as `{ ref, title, status, area }`.
  - `tasks`: Inbox tasks as `{ id, ref, title, area, size, priority, lab }`. Titles only, no bodies or comments, to keep the request small and avoid sending more task content than needed.
- Each proposal's `reason` is one short sentence for the user, not a reasoning trace.

`TriageSchema` is `{ proposals: Proposal[] }` with string fields; enums are not hard-coded in the schema because Area options live on the board.

Validation, `validateProposals(proposals, items, fields)`, pure:

- Drops a proposal whose `id` is not an Inbox task, and duplicates (keeps the first).
- Sets to null any `area`, `size` or `priority` that is not a current option of its field.
- Sets `parent` to null unless it is an open `project` issue on the board.
- If `parent` names a paused project, sets `status` to that project's status (Backlog or Waiting) so the proposal obeys the cascade rule. This is the only way `status` becomes `Waiting`; Claude's own `status` must be To do or Backlog, and anything else becomes Backlog.
- Truncates `reason` to 140 characters.

## 3. App

`app/src/lib/api.ts` gains `postTriage()`, `postFields(id, change)` and `postParent(id, parent)` on top of `send`.

`Inbox.svelte`:

- The `triage inbox` link becomes a button with the same look and Claude-orange icon. Pressing it shows "triaging…" and calls `postTriage`. It is disabled while running.
- The result opens a review list, one row per proposal: ref and title, the proposed Area, Size, Priority, Status and project as small chips, and the reason in muted text.
- Each chip is editable with the same menus the detail sheet uses. Each row has apply and skip. "Apply all" applies every row not skipped. Rows where Area, Size, Priority and project are all null start skipped, since Claude had nothing to suggest beyond a status.
- Applying a row writes in order: parent, fields, priority, status. The status write moves it out of Inbox, so it goes last; if an earlier write fails, the item stays in Inbox and the row shows the error.
- After applying, the board reloads and applied rows disappear. Closing the list discards unapplied proposals.

## 4. Errors, secrets, testing, cost

Errors:

- No `ANTHROPIC_API_KEY` set: `/triage` returns 500 "triage is not set up", so a missing secret is obvious.
- Anthropic API errors (rate limit, overload after fallback, auth) become 502 with the API's message. The SDK's own retries stay on.
- Write routes behave like the existing ones.

Secrets and config:

- New Worker secret `ANTHROPIC_API_KEY`, set by the owner with `npx wrangler secret put ANTHROPIC_API_KEY`. Add `ANTHROPIC_API_KEY=` to `worker/.dev.vars.example`. Update `CLAUDE.md` and `docs/deploy.md`.
- The key never reaches the app. The repo stays free of keys and task content; test fixtures use made-up titles.

Testing (Worker vitest, no network):

- `planFields` and `planParent`: each refusal and the no-change case.
- `buildTriageRequest`: includes options, projects and Inbox tasks only; leaves out bodies and closed items.
- `validateProposals`: unknown ids, duplicates, invalid options, unknown or closed parents, the paused-project status override, reason length.
- The Claude call is mocked: refusal and null `parsed_output` produce 502.
- Live check by hand: one `/triage` run with the throwaway `attask test – delete me` issue in `st4eve/MyLife` sitting in Inbox, apply its proposal, then delete the issue (after confirming with the user).

Cost: one request per button press. Inputs are titles and option lists, a few thousand tokens for a typical inbox, at `effort: "low"`. At Opus 5.5 prices that is a few cents per press; Sonnet or Haiku would cut it further.
