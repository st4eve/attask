# Note links to tasks

Date: 2026-11-27
Status: approved, implemented on spec/note-links

## Goal

Let an Obsidian note point at a task on the board, and open that task in attask with one tap on the phone or the laptop. The notes live in the private `st4eve/MyLife` repo, which is already the Obsidian vault and already synced on the laptop by the Obsidian Git plugin. The phone is Android, so it syncs the same way.

## Agreed with the user

- Sync is git: Obsidian Git on both devices, MyLife on GitHub in the middle. attask does not sync files; a web page cannot write into Obsidian's folder.
- A note references a task as `<repo name>#<number>`, for example `MyLife#12` or `polymerNN#3`. The repo name is the part after the owner; the five board repos have distinct names.
- Tapping a reference opens the task in attask, not on GitHub.
- The text in the `.md` file stays plain. The Linkify community plugin draws it as a link.
- "Mentioned in" backlinks in attask are a later checkpoint.

## Scope

In scope:

- App route `#/task/<repo name>/<number>` that opens the task's detail sheet.
- The Linkify rule, documented for both devices.
- `docs/notes.md`: phone sync setup and the Linkify rule.

Out of scope:

- Backlinks ("mentioned in these notes") in attask. Needs a spike first: GitHub code search may not match `#`, and fetching every note on load is too slow.
- Any Worker change. The route works from the board the app already loads.
- Linking to projects. A project is an issue too, so `MyLife#5` for a project works the same way (see section 1), but no separate syntax is added.
- Writing or editing notes from attask.

## 1. The route

`parseRoute` gains a page:

```ts
| { page: "task"; repo: string; number: number }
```

`#/task/MyLife/12` gives `{ page: "task", repo: "MyLife", number: 12 }`. The number must be a positive integer; anything else gives the inbox, like other malformed hashes. The repo part is kept as typed, so case is matched later.

A new helper in `app/src/lib/route.ts`:

```ts
/** Full ref for a short task reference such as MyLife and 12, or null when no board repo has that name. */
export function fullRef(repo: string, number: number): string | null
```

It compares `repo` with the name part of each entry in `REPOS`, ignoring case, and returns `${owner}/${name}#${number}` for the match, using the casing from `REPOS`.

## 2. Opening the task

When the route is `task`, `App.svelte` waits for the board to load (it already loads on start), then:

1. Finds the full ref with `fullRef`. No match: `board.error = "<repo>#<number> isn't a board repo"`, address becomes `#/inbox`.
2. Finds the board item with that ref. Not on the board (closed, or never added): `board.error = "<ref> isn't on the board"`, address becomes `#/inbox`.
   A good link sets `board.error` to "", so an error left by an earlier bad link goes away.
3. Picks the page underneath:
   - a project item: its own project page, no sheet
   - a task with a parent: the parent's project page
   - a task with an Area that has left Inbox: that Area's page (an Inbox task is only listed on the inbox)
   - otherwise the inbox
4. Replaces the address with that page's hash using `history.replaceState`, so Back does not return to the `#/task/...` address and reopen the sheet.
5. For a task, calls `select(ref)`, which opens the detail sheet as a card tap does. For a project or a bad link it calls `select(null)`, so a sheet left open from before does not sit over the error.

The router keeps `hash` in state and updates it on `hashchange`, which `replaceState` does not fire. So `router.svelte.ts` gains `replaceRoute(hash: string)`: it calls `history.replaceState(null, "", hash)` and sets the `hash` state, so the page updates at once.

"A task with a parent" means a parent that is a `project` item on the board, the same test the board's `projectOf` uses; a task whose parent is not on the board falls through to its Area.

A board load failure leaves the existing error showing and does nothing else.

## 3. Linkify rule

One rule, set on each device in Linkify's options:

- Pattern: `\b([\w.-]+)#(\d+)\b`
- Link: `https://st4eve.github.io/attask/#/task/$1/$2`

The pattern is generic so a repo added to `REPOS` later needs no rule change. Text that is not a board repo (`C#2`) still shows as a link; attask answers with the error from section 2. Obsidian treats `#12` alone as plain text, not a tag, and `MyLife#12` has no space before `#`, so it is not a tag either.

On Android, Chrome hands links inside an installed web app's scope to that app, so the tap opens attask, not a browser tab. On the laptop the link opens in the browser.

## 4. `docs/notes.md`

A short guide in the attask repo. It holds no note content.

- Laptop: already set up (Obsidian Git in MyLife). Recommend pull on startup if not on.
- Phone:
  1. Install Obsidian, create an empty vault.
  2. Create a fine-grained GitHub token for MyLife only, Contents read and write. The user creates it and types it into Obsidian; it never goes in a command, commit or chat.
  3. Install the Git community plugin, clone `https://github.com/st4eve/MyLife` with depth 1 (the history is about 140 MB).
  4. Turn on pull on startup and auto commit-and-sync every 10 minutes.
- Linkify on both devices with the rule from section 3.
- Writing references: `MyLife#12`, the issue number from the task's sheet or GitHub.

`CLAUDE.md` links to it from the Layout section.

## 5. Testing

- `app/src/lib/route.test.ts`: `#/task/MyLife/12` parses; `#/task/MyLife/abc`, `#/task/MyLife/0` and `#/task/MyLife` give the inbox; `fullRef` matches each of the five repos, ignores case, and returns null for an unknown name.
- Browser, local dev with the Worker: open `#/task/MyLife/<n>` for a test task with no parent and one inside a project, check the page underneath, the sheet, the address after the replace, and that Back leaves the app or returns to the previous page rather than reopening the sheet. Check an unknown repo and an unknown number show the error. Test tasks follow the repo's safety rule: a throwaway `attask test – delete me` issue in MyLife, deleted afterwards.
- Phone: the user taps a `MyLife#…` reference in a note and the task opens in attask.

## 6. Later: backlinks

A separate checkpoint, starting with a spike on how the Worker finds notes that mention a ref (GitHub code search on a private repo versus reading the git tree). Not designed here.
