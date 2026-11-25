# attask on the task_planner board: design

Date: 2026-11-25
Status: draft, awaiting review

## Goal

Run this fork of attask as a phone-friendly front end for the owner's existing
multi-repo GitHub Project (user `st4eve`, project #2, "task_planner"). That board
already tracks issues from several repos and is driven from the desktop by the
MyLife planner CLI. attask becomes the mobile view and editor of the same board,
so one board covers work in every repo.

## Scope

This spec is piece 1 of 2.

- **Piece 1 (this spec):** point attask at the task_planner board, support
  issues from many repos, adopt the board's vocabulary, deploy the Worker and
  the app.
- **Piece 2 (later, own spec):** links between tasks and MyLife notes (attask
  renders `Note:` lines as links; a planner command writes `## Tasks` blocks
  into notes).

Out of scope here: editing parent/sub-issue links from attask, free-text repo
entry, any change to upstream `jewaniuk/attask`.

## 1. Data model and many repos

- `BoardItem` gains `repo` (`owner/name`) and `ref` (`owner/name#n`). `parent`
  becomes a ref string (or `null`) instead of a bare number, since numbers are
  only unique within a repo.
- Routes that name an issue take the repo:
  `GET /issues/:owner/:repo/:n/detail`, `POST /issues/:owner/:repo/:n/not-planned`,
  `DELETE /issues/:owner/:repo/:n`. Status and priority routes are unchanged;
  they use the project item ID.
- New `worker/src/config.ts` holds everything owner-specific: owner `st4eve`,
  project number `2`, home repo `st4eve/MyLife`, and the list of repos offered
  in the add box. `wrangler.jsonc` sets `ALLOWED_ORIGINS` to
  `https://st4eve.github.io`.
- No field or option IDs are hard-coded. The board query also fetches the
  project's fields with their options, and the Worker resolves IDs by name
  each request.
- The board query reads `repository { nameWithOwner }` and `parent { number
  repository { nameWithOwner } }` for each issue.
- Creating a task: the Worker creates the issue in the chosen repo, adds it to
  the board with `addProjectV2ItemById`, then sets Status to Inbox. It does not
  rely on a GitHub auto-add workflow.
- Projects are issues labelled `project`; their tasks are sub-issues. Items
  that are neither stay flat, which is how most current items are.
- Delete is offered only for repos where the viewer has admin rights (the
  board query reads `viewerPermission`). Elsewhere attask offers only "close as
  not planned", and the Worker refuses a delete with a clear message.

## 2. Vocabulary and rules

Board fields, by name:

| Field    | Values                                                      | Replaces |
|----------|-------------------------------------------------------------|----------|
| Status   | Inbox, Backlog, To do, In progress, Waiting, Done           | Status (attask names) |
| Priority | P0, P1, P2                                                  | `!!!` / `!!` / `!` / `-` |
| Size     | XS, S, M, L, XL                                             | Effort |
| Area     | the board's existing options                                | Category |
| label `lab` | present or absent                                        | Kind (hardware/experiment) |

- The Backlog option is added to the board's Status field once, by hand or by
  the setup step. The MyLife planner CLI's `STATUSES` list gains `Backlog` in
  the same change set.
- Project statuses: Backlog, In progress, Waiting, Done.
- Task statuses: all six. Nothing is moved back to Inbox by attask.
- Pausing a project (Backlog or Waiting) cascades that status to its open
  tasks. A task of a paused project may only take the project's status or
  Done.
- Priority can be set on tasks as well as projects.

Next page:

- Shows open, unblocked tasks whose status is In progress or To do, plus
  Backlog when the backlog toggle is on.
- A flat task qualifies by its own status. A project task also needs its
  project to be In progress.
- Order: In progress first, most recently updated first; then To do by
  priority (the task's own, else its project's), then due date, then repo and
  number. Backlog follows in the same order as To do.
- Time toggle maps to Size: 15m → XS, 1h → XS or S, half-day → up to M,
  any → everything, including unsized tasks. Unsized tasks appear only under
  "any".
- The Home place hides tasks labelled `lab`; Lab shows everything.

Due soon and the kanban pages keep their current behaviour with the new names.

## 3. App UI

- Add box: a repo picker fed by the config list, defaulting to MyLife. No free
  text.
- Cards: a repo chip for tasks outside MyLife, and a `lab` chip when labelled.
- Detail sheet: the title links to the issue in its repo. Delete appears only
  for admin repos. `Note:` lines in the body show as plain text (links come in
  piece 2).
- Inbox triage prompt names this board and the MyLife planner skill instead of
  `jewaniuk/tasks` board #4.
- Settings links to `st4eve/attask`.
- Bottom bar shows the board's Area options, each with a fitting icon and a
  folder icon as fallback.
- Projects page lists `project`-labelled issues with their sub-issues. attask
  does not edit parent links.

## 4. Errors, testing, deployment

Errors:

- A missing field or option yields a named Worker error, for example
  `board has no Status option "Backlog"`, shown in the app's error banner. The
  Worker never writes a guessed ID.
- A write to a repo the token cannot reach returns GitHub's reason; the app
  shows it and moves the card back.

Testing:

- vitest unit tests for the status rules and Next ordering with the new
  vocabulary, covering flat tasks, project tasks and tasks from several repos;
  ref parsing; and the repo list.
- A Worker test of the field-by-name lookup against a recorded (anonymised)
  GraphQL response.
- One live check per write path, using a throwaway issue titled
  `attask test – delete me` in MyLife, deleted afterwards. No real items are
  touched.
- The repo gate passes:
  `cd app && npm run check`, `cd app && npx vitest run`,
  `cd worker && npm run cf-typegen && npx tsc --noEmit`,
  `cd worker && npx vitest run --passWithNoTests`.

Deployment:

1. The owner creates a Cloudflare account, runs `wrangler login`, and sets
   `GITHUB_TOKEN` (classic, `repo` + `project`) and `APP_KEY` with
   `wrangler secret put` at the hidden prompt. Secrets never pass through a
   logged command, a commit or an issue comment.
2. Claude deploys the Worker and checks that `/board` without a key answers
   401.
3. Claude enables GitHub Pages (source: GitHub Actions) on the fork; the app is
   served at `https://st4eve.github.io/attask/`.
4. On the phone: open that address, enter the Worker URL and app key in
   Settings, Add to Home Screen.

Workflow:

- Work happens on a branch and lands by PR into the fork's own `main`. Run
  `gh repo set-default st4eve/attask` first so PRs never target upstream.
- The repo's `CLAUDE.md` and `docs/deploy.md` are updated to name this board,
  owner and origin instead of `jewaniuk/tasks` board #4.
- The repo is public: no tokens, keys or real task content in commits,
  fixtures or test data.
