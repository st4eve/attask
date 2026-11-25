<script lang="ts">
    import { version } from "../../package.json";
    import { clearSettings, loadSettings, saveSettings, testConnection } from "../lib/api";
    import { board, loadBoard } from "../lib/board.svelte";
    import { setTheme, theme, themes, type Theme } from "../lib/theme.svelte";
    import Icon, { type IconName } from "../components/Icon.svelte";

    const themeIcons: Record<Theme, IconName> = { system: "desktop", light: "sun", dark: "moon" };

    /** Settings page: theme, the Worker connection (address and app key, kept on this device), and about. */
    let settings = $state(loadSettings());
    let showKey = $state(false);
    /** Result of the last save or test, shown under the buttons; `ok` picks its colour. */
    let note = $state({ text: "", ok: true });
    let testing = $state(false);

    function save(): void {
        saveSettings(settings);
        loadBoard();
        note = { text: "saved", ok: true };
    }

    async function test(): Promise<void> {
        testing = true;
        note = { text: "", ok: true };
        try {
            note = { text: `connected, ${await testConnection(settings)} items on the board`, ok: true };
        } catch (e) {
            note = { text: e instanceof Error ? e.message : String(e), ok: false };
        } finally {
            testing = false;
        }
    }

    function signOut(): void {
        clearSettings();
        settings = loadSettings();
        board.items = [];
        board.error = "";
        note = { text: "signed out, the address and key are cleared from this device", ok: true };
    }
</script>

<div class="page">
    <section>
        <h3>appearance</h3>
        <div class="segmented" role="group" aria-label="theme">
            {#each themes as choice}
                <button class:on={theme.choice === choice} aria-pressed={theme.choice === choice} onclick={() => setTheme(choice)}>
                    <Icon name={themeIcons[choice]} />
                    {choice}
                </button>
            {/each}
        </div>
    </section>

    <section>
        <h3>connection</h3>
        <form
            onsubmit={(e) => {
                e.preventDefault();
                save();
            }}
        >
            <label>worker url <input bind:value={settings.url} placeholder="https://attask-worker.example.workers.dev" /></label>
            <label>
                app key
                <span class="key">
                    <input type={showKey ? "text" : "password"} bind:value={settings.key} />
                    <button type="button" aria-label={showKey ? "hide app key" : "show app key"} onclick={() => (showKey = !showKey)}><Icon name={showKey ? "eye-slash" : "eye"} /></button>
                </span>
            </label>
            <div class="actions">
                <button class="primary">save</button>
                <button type="button" disabled={testing} onclick={test}>{testing ? "testing ..." : "test connection"}</button>
                <button type="button" class="danger" onclick={signOut}>sign out</button>
            </div>
            {#if note.text}<p class="note" class:bad={!note.ok}>{note.text}</p>{/if}
        </form>
    </section>

    <section>
        <h3>about</h3>
        <p class="about">
            <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" />
            attask {version}
        </p>
        <a class="repo" href="https://github.com/st4eve/attask" target="_blank" rel="noopener"><Icon name="github-logo" />source on GitHub</a>
    </section>
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        max-width: 28rem;
    }
    h3 {
        margin: 0 0 0.5rem;
    }
    form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        color: var(--muted);
    }
    .key {
        display: flex;
        gap: 0.4rem;
    }
    .key input {
        flex: 1;
        min-width: 0;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .danger {
        margin-left: auto;
        color: var(--accent);
    }
    .note {
        margin: 0;
        color: var(--muted);
    }
    .note.bad {
        color: var(--accent);
    }
    /* secondary buttons: soft field look like the inputs, not the browser default */
    form button:not(.primary) {
        display: inline-flex;
        align-items: center;
        padding: 0.5em 0.9em;
        background: var(--bg-alt);
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: pointer;
    }
    form button:not(.primary):hover:not(:disabled) {
        border-color: var(--border-hover);
    }
    form button:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .about {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.5rem;
        color: var(--muted);
    }
    .about img {
        width: 1.6rem;
        height: 1.6rem;
    }
    .repo {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        color: var(--accent);
        text-decoration: none;
    }
</style>
