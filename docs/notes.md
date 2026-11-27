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

Write the task as `<repo name>#<number>`, for example `MyLife#12` or `polymerNN#3`. The number is the issue number shown on GitHub and in the task's sheet.

To make these tappable, install the **Linkify** community plugin on each device and add one rule:

- Pattern: `\b([\w.-]+)#(\d+)\b`
- Link: `https://st4eve.github.io/attask/#/task/$1/$2`

Linkify only changes how the note looks; the file keeps the plain text. Tapping opens the task's sheet in attask, over its project, Area or inbox page; a project opens as its own page. On Android, with attask installed on the home screen, the link opens the app rather than a browser tab. A repo that is not on the board, or a task not on it, shows an error on the inbox.
