# Note Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a task in attask from an `#/task/<repo name>/<number>` link, so a `MyLife#12` reference in an Obsidian note (drawn as a link by Linkify) opens that task's sheet.

**Architecture:** `parseRoute` learns a `task` page and a `fullRef` helper maps a short repo name to a board repo. A pure `taskLanding` function decides which page to show underneath, which task to select, or which error to show. `App.svelte` runs it once the board has loaded and swaps the address with a new `replaceRoute` so Back never reopens the sheet. No Worker change.

**Tech Stack:** Svelte 5 runes, TypeScript, vitest. App code in `app/`, shared types in `worker/src/types.ts` and `worker/src/config.ts`.

**Spec:** `docs/superpowers/specs/2026-11-27-note-links-design.md`

## Global Constraints

- The repo is public: no tokens, keys or real task or note content in code, docs, tests or commits.
- Test writes only on a throwaway issue titled `attask test – delete me` in `st4eve/MyLife`, and delete it afterwards with the user's OK.
- App code uses 4-space indent and double quotes (the app's Prettier config); worker files use tabs and single quotes. Keep each package consistent with itself.
- Inline comments lowercase with minimal punctuation; `/** */` on every exported item.
- Explicit types, no `any`.
- Route: `#/task/<repo name>/<number>`; number a positive integer; repo name matched against the name part of `REPOS`, ignoring case.
- Linkify pattern `\b([\w.-]+)#(\d+)\b`, link `https://st4eve.github.io/attask/#/task/$1/$2`.
- Errors: unknown repo `"<repo>#<number> isn't a board repo"`; unknown task `"<ref> isn't on the board"`; both land on `#/inbox`.
- Gate before the PR: `cd app && npm run check`, `cd app && npx vitest run`, `cd worker && npm run cf-typegen && npx tsc --noEmit`, `cd worker && npx vitest run --passWithNoTests`.

## Review Focus

1. A link with a leading zero or a huge number (`#/task/MyLife/012`) should still find issue 12, not fail. Pinned in Task 1.
2. A link to a closed task that is still on the board should open its sheet, not say it isn't on the board. Pinned in Task 2.
3. A link to a task whose parent is not a project on the board (parent missing or not `project`-labelled) should land on its Area, not a blank project page. Pinned in Task 2.
4. Opening a second link while attask is already open (Android reuses the running app and changes the hash) should open the new task. Checked in Task 3's browser step.
5. A repo name with different case (`mylife#12`) should still open the task. Pinned in Task 1.

---

### Task 1: The `task` route and `fullRef`

**Files:**
- Modify: `app/src/lib/route.ts`
- Test: `app/src/lib/route.test.ts`

**Interfaces:**
- Consumes: `REPOS` from `worker/src/config.ts`, `makeRef` and `parseRef` from `worker/src/types.ts`.
- Produces:
  - `Route` gains `{ page: "task"; repo: string; number: number }`.
  - `fullRef(repo: string, number: number): string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/route.test.ts`, and change its import line to `import { areaHref, fullRef, parseRoute, projectHref } from "./route";`:

```ts
describe("parseRoute task", () => {
    it("reads a repo name and number", () => {
        expect(parseRoute("#/task/MyLife/12")).toEqual({ page: "task", repo: "MyLife", number: 12 });
    });
    it("reads a leading zero as the same number", () => {
        expect(parseRoute("#/task/MyLife/012")).toEqual({ page: "task", repo: "MyLife", number: 12 });
    });
    it("falls back to the inbox for a bad number or missing part", () => {
        expect(parseRoute("#/task/MyLife/abc")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife/0")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife/1.5")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task//12")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/My/Life/12")).toEqual({ page: "inbox" });
    });
});

describe("fullRef", () => {
    it("maps each board repo's name to its full ref", () => {
        expect(fullRef("MyLife", 12)).toBe("st4eve/MyLife#12");
        expect(fullRef("QNL-Wafer-Database", 3)).toBe("QNLQueens/QNL-Wafer-Database#3");
        expect(fullRef("WickedIdeas", 1)).toBe("QNLQueens/WickedIdeas#1");
        expect(fullRef("polymerNN", 4)).toBe("Shastri-Lab/polymerNN#4");
        expect(fullRef("Hybrid_CV_Networks", 5)).toBe("st4eve/Hybrid_CV_Networks#5");
    });
    it("ignores case and keeps the board's casing", () => {
        expect(fullRef("mylife", 12)).toBe("st4eve/MyLife#12");
    });
    it("returns null for a repo not on the board", () => {
        expect(fullRef("C", 2)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd app && npx vitest run src/lib/route.test.ts`
Expected: FAIL, `fullRef` is not exported and the task cases give `{ page: "inbox" }`.

- [ ] **Step 3: Implement**

In `app/src/lib/route.ts` change the imports and `Route`, add the `task` case to `parseRoute`, and add `fullRef`:

```ts
import { REPOS } from "../../../worker/src/config";
import { makeRef, parseRef } from "../../../worker/src/types";

/** The page the hash points at. `task` comes from a note link and is swapped for a real page once the board loads. */
export type Route =
    | { page: "inbox" }
    | { page: "next" }
    | { page: "settings" }
    | { page: "area"; name: string }
    | { page: "project"; ref: string }
    | { page: "task"; repo: string; number: number };
```

In `parseRoute`, before the final `return { page: "inbox" };`:

```ts
    if (page === "task" && rest.length === 2 && rest[0] && /^\d+$/.test(rest[1]) && Number(rest[1]) > 0) {
        return { page, repo: rest[0], number: Number(rest[1]) };
    }
```

Update the `parseRoute` doc to mention `#/task/MyLife/12`. Then add:

```ts
/** Full ref for a short task reference such as `MyLife` and 12, matching the name part of a board repo and ignoring case, or null when no board repo has that name. */
export function fullRef(repo: string, number: number): string | null {
    const match = REPOS.find((r) => r.split("/")[1].toLowerCase() === repo.toLowerCase());
    return match ? makeRef(match, number) : null;
}
```

`rest[0]` is used undecoded on purpose: repo names hold only letters, digits, `.`, `_` and `-`, so they need no decoding, and the split already keeps `My/Life` from matching.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npx vitest run src/lib/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check and commit**

Run: `cd app && npm run check`
Expected: 0 errors. `App.svelte`'s `title` switch has a `default`, so the new route type needs no change there yet.

```bash
git add app/src/lib/route.ts app/src/lib/route.test.ts
git commit -m "feat(app): task route and short repo lookup for note links"
```

---

### Task 2: `taskLanding` and `replaceRoute`

**Files:**
- Create: `app/src/lib/tasklink.ts`
- Create: `app/src/lib/tasklink.test.ts`
- Modify: `app/src/lib/router.svelte.ts`

**Interfaces:**
- Consumes: `fullRef`, `projectHref`, `areaHref` from `app/src/lib/route.ts`; `projectOf`, `BoardItem` from `worker/src/types.ts`.
- Produces:
  - `interface Landing { hash: string; selected: string | null; error: string }`
  - `taskLanding(items: BoardItem[], repo: string, number: number): Landing`
  - `replaceRoute(hash: string): void` in `router.svelte.ts`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/tasklink.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem } from "../../../worker/src/types";
import { areaHref, projectHref } from "./route";
import { taskLanding } from "./tasklink";

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
    const repo = over.repo ?? "st4eve/MyLife";
    return {
        id: `id-${repo}-${over.number}`, repo, ref: makeRef(repo, over.number), title: `task ${over.number}`, url: "", open: true,
        isProject: false, parent: null, status: "To do", area: null, priority: null, size: null, lab: false, due: null,
        updatedAt: "", blocked: false, canDelete: true, ...over,
    };
}

const items = [
    item({ number: 1, isProject: true, status: "In progress", area: "Research" }),
    item({ number: 2, parent: "st4eve/MyLife#1", area: "Research" }),
    item({ number: 3, area: "Admin" }),
    item({ number: 4, status: "Inbox" }),
    item({ number: 5, parent: "st4eve/MyLife#99", area: "Admin" }),
    item({ number: 6, area: "Admin", open: false, status: "Done" }),
    item({ number: 7, repo: "Shastri-Lab/polymerNN", area: "Research" }),
];

describe("taskLanding", () => {
    it("opens a task in a project over the project page", () => {
        expect(taskLanding(items, "MyLife", 2)).toEqual({ hash: projectHref("st4eve/MyLife#1"), selected: "st4eve/MyLife#2", error: "" });
    });
    it("opens a flat task over its Area page", () => {
        expect(taskLanding(items, "MyLife", 3)).toEqual({ hash: areaHref("Admin"), selected: "st4eve/MyLife#3", error: "" });
    });
    it("opens a task with no Area over the inbox", () => {
        expect(taskLanding(items, "MyLife", 4)).toEqual({ hash: "#/inbox", selected: "st4eve/MyLife#4", error: "" });
    });
    it("treats a parent that is not a project on the board as flat", () => {
        expect(taskLanding(items, "MyLife", 5)).toEqual({ hash: areaHref("Admin"), selected: "st4eve/MyLife#5", error: "" });
    });
    it("opens a closed task that is still on the board", () => {
        expect(taskLanding(items, "MyLife", 6).selected).toBe("st4eve/MyLife#6");
    });
    it("shows a project as its own page with no sheet", () => {
        expect(taskLanding(items, "MyLife", 1)).toEqual({ hash: projectHref("st4eve/MyLife#1"), selected: null, error: "" });
    });
    it("matches the repo name in any case", () => {
        expect(taskLanding(items, "polymernn", 7).selected).toBe("Shastri-Lab/polymerNN#7");
    });
    it("lands on the inbox with an error for an unknown repo", () => {
        expect(taskLanding(items, "C", 2)).toEqual({ hash: "#/inbox", selected: null, error: "C#2 isn't a board repo" });
    });
    it("lands on the inbox with an error for a task not on the board", () => {
        expect(taskLanding(items, "MyLife", 42)).toEqual({ hash: "#/inbox", selected: null, error: "st4eve/MyLife#42 isn't on the board" });
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd app && npx vitest run src/lib/tasklink.test.ts`
Expected: FAIL, cannot resolve `./tasklink`.

- [ ] **Step 3: Implement `taskLanding`**

Create `app/src/lib/tasklink.ts`:

```ts
import { projectOf, type BoardItem } from "../../../worker/src/types";
import { areaHref, fullRef, projectHref } from "./route";

/** Where a note link lands: the page to show, the task whose sheet opens (null for none), and an error line ("" for none). */
export interface Landing {
    hash: string;
    selected: string | null;
    error: string;
}

/**
 * Decides where a `#/task/<repo>/<number>` link lands once the board has loaded.
 *
 * Args:
 *     items: The whole board.
 *     repo: The repo name from the link, any case.
 *     number: The issue number.
 *
 * Returns:
 *     A project opens as its own page. A task opens its sheet over its project page, else its Area page, else the inbox. An unknown repo or a ref not on the board lands on the inbox with an error.
 */
export function taskLanding(items: BoardItem[], repo: string, number: number): Landing {
    const ref = fullRef(repo, number);
    if (!ref) return { hash: "#/inbox", selected: null, error: `${repo}#${number} isn't a board repo` };
    const item = items.find((i) => i.ref === ref);
    if (!item) return { hash: "#/inbox", selected: null, error: `${ref} isn't on the board` };
    if (item.isProject) return { hash: projectHref(ref), selected: null, error: "" };
    const project = projectOf(items, item);
    const hash = project ? projectHref(project.ref) : item.area ? areaHref(item.area) : "#/inbox";
    return { hash, selected: ref, error: "" };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd app && npx vitest run src/lib/tasklink.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add `replaceRoute`**

In `app/src/lib/router.svelte.ts`, after the `router` object, add this. It sets the module's `hash` state directly; assigning `location.hash` would add a history entry.

```ts
/** Swaps the address for `hash` without a new history entry, so Back skips the old one, and updates `router.route` at once (replaceState fires no hashchange). */
export function replaceRoute(next: string): void {
    history.replaceState(null, "", next);
    hash = next;
}
```

The parameter is `next` because `hash` is the module's state variable.

- [ ] **Step 6: Check and commit**

Run: `cd app && npm run check && npx vitest run`
Expected: 0 errors, all tests pass.

```bash
git add app/src/lib/tasklink.ts app/src/lib/tasklink.test.ts app/src/lib/router.svelte.ts
git commit -m "feat(app): decide where a note link lands, replace the route without history"
```

---

### Task 3: Wire the link into `App.svelte`

**Files:**
- Modify: `app/src/App.svelte`

**Interfaces:**
- Consumes: `taskLanding` (Task 2), `replaceRoute` (Task 2), `router.route` with the `task` page (Task 1), `board`, `select` from `app/src/lib/board.svelte.ts`.
- Produces: nothing new.

- [ ] **Step 1: Add the effect**

In `App.svelte`'s imports:

```ts
    import { board, loadBoard, select } from "./lib/board.svelte";
    import { replaceRoute, router } from "./lib/router.svelte";
    import { taskLanding } from "./lib/tasklink";
```

After `onMount(loadBoard);`:

```ts
    // a note link waits for the board, then becomes the page underneath and opens the task's sheet; it also runs when a link arrives while the app is open
    $effect(() => {
        const route = router.route;
        if (route.page !== "task" || board.items.length === 0) return;
        const landing = taskLanding(board.items, route.repo, route.number);
        replaceRoute(landing.hash);
        if (landing.error) board.error = landing.error;
        if (landing.selected) select(landing.selected);
    });
```

While the board is still loading the page area is empty (the `{#key}` block has no `task` branch) and the title reads "inbox". A load failure leaves the existing error showing, as the spec says.

- [ ] **Step 2: Check**

Run: `cd app && npm run check`
Expected: 0 errors.

- [ ] **Step 3: Browser check with a throwaway task**

Start both preview servers (`worker` and `app` in `.claude/launch.json`). `worker/.dev.vars` needs `GITHUB_TOKEN`; it is blank after the last session, so ask the user to fill it (never print it). Create the throwaway issue:

```bash
gh issue create --repo st4eve/MyLife --title "attask test – delete me" --body "temporary, for the note-link check"
```

Add it to board #2 so it shows in the inbox (`gh project item-add 2 --owner st4eve --url <issue url>`). Then, in the browser pane at `http://localhost:5173`:

1. `#/task/MyLife/<n>`: the inbox shows underneath, the sheet opens, the address reads `#/inbox`.
2. Close the sheet, press Back: the app does not reopen the sheet.
3. `#/task/mylife/<n>` from another page: the sheet opens again (link arriving while open, any case).
4. `#/task/MyLife/999999`: inbox with "st4eve/MyLife#999999 isn't on the board".
5. `#/task/C/2`: inbox with "C#2 isn't a board repo".
6. `#/task/MyLife/<a project number from the board>` (read one from the sidebar): its project page, no sheet.

Screenshot step 1 at phone width. Ask the user before deleting the throwaway issue, then `gh issue delete <n> --repo st4eve/MyLife --yes`, and blank `GITHUB_TOKEN` again if the user asks.

- [ ] **Step 4: Commit**

```bash
git add app/src/App.svelte
git commit -m "feat(app): open a task from a note link"
```

---

### Task 4: Docs

**Files:**
- Create: `docs/notes.md`
- Modify: `CLAUDE.md` (Layout and Gate sections)
- Modify: `docs/superpowers/specs/2026-11-27-note-links-design.md` (Status line)

**Interfaces:**
- Consumes: the route and error text from Tasks 1–3, the Linkify rule from Global Constraints.
- Produces: nothing in code.

- [ ] **Step 1: Write `docs/notes.md`**

```markdown
# Notes and task links

Obsidian notes live in the private `st4eve/MyLife` repo, which is the vault. Each device syncs it with the Obsidian Git plugin; GitHub sits in the middle. attask does not sync notes.

## Laptop

Already set up: the vault is the MyLife checkout with Obsidian Git. In the plugin's settings, turn on "Pull on startup" and set auto commit-and-sync to 10 minutes if they are off.

## Android phone

1. Install Obsidian from the Play Store and create an empty vault named `MyLife`.
2. On GitHub, Settings → Developer settings → Fine-grained tokens: a token for `st4eve/MyLife` only, with Contents read and write. Type it into Obsidian only; never paste it into a chat, command or file in this repo.
3. In Obsidian: Settings → Community plugins → Browse, install and enable **Git**. Run "Git: Clone an existing remote repo" with `https://github.com/st4eve/MyLife`, your GitHub username and the token, and a clone depth of `1` (the full history is about 140 MB).
4. In the Git plugin's settings, turn on "Pull on startup" and set auto commit-and-sync to 10 minutes.

## Linking a note to a task

Write the task as `<repo name>#<number>`, for example `MyLife#12` or `polymerNN#3`. The number is the issue number shown on GitHub.

To make these tappable, install the **Linkify** community plugin on each device and add one rule:

- Pattern: `\b([\w.-]+)#(\d+)\b`
- Link: `https://st4eve.github.io/attask/#/task/$1/$2`

Linkify only changes how the note looks; the file keeps the plain text. Tapping opens the task's sheet in attask, over its project, Area or inbox page. On Android, with attask installed on the home screen, the link opens the app rather than a browser tab. A repo that is not on the board, or a task not on it, shows an error on the inbox.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the Layout section, after the sentence that names `docs/deploy.md`, add: `Obsidian sync and note links: \`docs/notes.md\`.`

In the Gate section, change the app unit-test line to: `` - `cd app && npx vitest run` (unit tests cover `next.ts`, `route.ts`, `issuePath`, `triage.ts` and `tasklink.ts`) ``.

- [ ] **Step 3: Mark the spec implemented**

In the spec, change `Status: draft, awaiting review` to `Status: approved, implemented on spec/note-links`.

- [ ] **Step 4: Run the gate and commit**

Run the four gate commands from Global Constraints. Expected: all pass.

```bash
git add docs/notes.md CLAUDE.md docs/superpowers/specs/2026-11-27-note-links-design.md
git commit -m "docs: notes sync and task links guide"
```
