# Deploying attask

Two parts, deployed separately: the app (static files) on GitHub Pages, and the Worker on Cloudflare. Do each step once; after that, merging to `main` redeploys the app and `npx wrangler deploy` redeploys the Worker.

## Check the token

The Worker's token must be a **classic** token with the `repo` and `project` scopes. `REPOS` includes repos in the `QNLQueens` and `Shastri-Lab` orgs, so the token needs Issues read/write on each of them (a classic `repo` token covers this where you are a member; a fine-grained token must list each repo, and an org may need to approve it first). Admin rights are only needed for `DELETE /issues/<owner>/<repo>/<n>`, so deleting works only in repos you admin; elsewhere inbox tasks are closed as not planned. To check without printing the token:

```
read -s "T?token: "
curl -sI -H "Authorization: Bearer $T" https://api.github.com/user | grep -i x-oauth-scopes
curl -s -H "Authorization: Bearer $T" https://api.github.com/repos/st4eve/MyLife | grep -A9 '"permissions"'
unset T
```

Expect `repo` and `project` in the first output and `"admin": true` in the second.

## Board setup

The board is project #2 of `st4eve`. Add the `Backlog` option to the board's Status field once.

## Cloudflare Worker

1. Make a free Cloudflare account at dash.cloudflare.com. No domain or card is needed; the Worker gets a free `*.workers.dev` address.
2. `cd worker && npx wrangler login` opens a browser to authorize the CLI.
3. `npx wrangler deploy` uploads the Worker named `attask-worker` and prints its URL, `https://attask-worker.<your-subdomain>.workers.dev`. The first deploy asks you to pick the subdomain.
4. Set the two secrets. Each command asks for the value at a hidden prompt, so it never lands in shell history:
   - `npx wrangler secret put GITHUB_TOKEN`
   - `npx wrangler secret put APP_KEY` (any long random string, for example from `openssl rand -base64 32`; keep a copy for the phone)
5. Check it is up: `curl -i https://attask-worker.<subdomain>.workers.dev/board` should answer `401`, not an error page.

To regenerate the Worker's types (`npm run cf-typegen`) you need a local `worker/.dev.vars` file (git-ignored, copy `.dev.vars.example`); the command reads the secret names from it.

Some actions write in several steps (a status change that pauses a project's tasks, closing an issue and then setting Done). If one fails part-way, retrying the same action is safe: the Worker re-reads the board and only changes what still differs. The exception is creating a task: if it fails after the issue exists, a retry makes a second issue, so check the repo first.

`ALLOWED_ORIGINS` is not a secret and is already in `wrangler.jsonc`, set to `https://st4eve.github.io`. It is an origin, so no path and no trailing slash.

## GitHub Pages

1. Merge the PR that holds `.github/workflows/pages.yml`.
2. In `st4eve/attask` go to Settings, Pages, and set Source to "GitHub Actions". (Or `gh api -X POST repos/st4eve/attask/pages -f build_type=workflow`.)
3. The workflow runs on the merge (Actions tab); if it ran before Pages was enabled, run it again with "Run workflow". The app is then at `https://st4eve.github.io/attask/`.

## On the phone

Settings are stored per origin, so the new address starts empty.

1. Open `https://st4eve.github.io/attask/` in Safari.
2. Settings: enter the Worker URL and the app key.
3. Delete any old attask icon, then Share, Add to Home Screen.
