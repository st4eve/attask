<script lang="ts">
    import { HOME_REPO, REPOS } from "../lib/api";
    import Icon from "./Icon.svelte";

    /** Title box that opens over the slot where the new task will land: the top of `anchor`, the task list, with the rest of the screen dimmed. Enter or the plus button hands the title to `onsubmit` and closes it; the x, Escape or a tap outside cancels. Args: open: whether it is showing (bindable); anchor: the list element to sit on top of; onsubmit: called with the trimmed, non-empty title and the chosen repo. */
    let {
        open = $bindable(false),
        anchor,
        onsubmit,
    }: { open: boolean; anchor: HTMLElement | undefined; onsubmit: (title: string, repo: string) => void } = $props();

    let dialog: HTMLDialogElement;
    let input: HTMLInputElement;
    let title = $state("");
    let repo = $state(HOME_REPO);

    $effect(() => {
        if (open && !dialog.open) {
            title = "";
            // sit where the first card is, kept on screen if the page is scrolled past it
            const r = anchor?.getBoundingClientRect();
            dialog.style.top = `${Math.max(r?.top ?? 0, 16)}px`;
            dialog.style.left = `${r?.left ?? 16}px`;
            dialog.style.width = `${r?.width ?? 300}px`;
            dialog.showModal();
            input.focus();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    });

    function submit(e: SubmitEvent): void {
        e.preventDefault();
        const text = title.trim();
        if (!text) return;
        open = false;
        onsubmit(text, repo);
    }
</script>

<!-- one dim layer for the whole screen, status bar area included, as in DetailSheet -->
<div class="dim" class:on={open}></div>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && (open = false)}>
    <form onsubmit={submit}>
        <input bind:this={input} bind:value={title} placeholder="new task" aria-label="new task title" enterkeyhint="send" />
        <label>
            repo
            <select bind:value={repo}>
                {#each REPOS as r (r)}<option value={r}>{r}</option>{/each}
            </select>
        </label>
        <button class="go" aria-label="add task" disabled={!title.trim()}><Icon name="plus" size={1.3} /></button>
        <button type="button" class="cancel" aria-label="cancel" onclick={() => (open = false)}><Icon name="close" size={1.1} /></button>
    </form>
</dialog>

<style>
    /* styled like a task card so it reads as the card being created; top, left and width are set when it opens */
    dialog {
        position: fixed;
        inset: auto;
        margin: 0;
        max-width: calc(100% - 2rem);
        padding: 0.45rem 0.8rem;
        color: var(--text);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 10px;
        box-shadow: var(--shadow-rest);
    }
    dialog:focus {
        outline: none;
    }
    dialog::backdrop {
        background: transparent;
    }
    .dim {
        position: fixed;
        inset: -200px;
        z-index: 40;
        background: rgba(0, 0, 0, 0.45);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
    }
    .dim.on {
        opacity: 1;
    }
    form {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }
    input {
        flex: 1;
        min-width: 0;
        padding: 0.5em 0.2em;
        font: inherit;
        font-size: 16px; /* under 16px iOS zooms into the box on focus */
        color: var(--text);
        background: none;
        border: none;
    }
    input:focus {
        outline: none;
    }
    button {
        display: inline-flex;
        align-items: center;
        padding: 0.45em;
        color: var(--text);
        background: none;
        border: none;
        border-radius: 999px;
        cursor: pointer;
    }
    .go {
        color: var(--accent);
    }
    .go:disabled {
        color: var(--faint);
        cursor: default;
    }
    .cancel {
        color: var(--muted);
    }
</style>
