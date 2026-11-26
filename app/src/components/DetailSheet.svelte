<script lang="ts">
    import { fetchDetail, HOME_REPO, type ItemDetail } from "../lib/api";
    import { board, dropTask, removeTask, select } from "../lib/board.svelte";
    import Icon from "./Icon.svelte";
    import Spinner from "./Spinner.svelte";
    import PriorityMenu from "./PriorityMenu.svelte";
    import StatusMenu from "./StatusMenu.svelte";

    /** Pop-up for the task in `board.selected`: a bottom sheet on a phone, a centred panel on desktop. Shows the status menu, the issue body and its comments, fetched when it opens, and a trash button: an inbox task in a repo the token admins is deleted for good, anything else is closed as not planned. */
    let dialog: HTMLDialogElement;

    let item = $derived(board.items.find((i) => i.ref === board.selected && !i.isProject));
    let detail = $state<ItemDetail | null>(null);
    let failed = $state("");
    // an inbox task in a repo the token admins is deleted; anything else is closed as not planned
    let deletes = $derived(item?.status === "Inbox" && item.canDelete);
    /** Whether the delete button has been tapped once and now asks to confirm. */
    let confirming = $state(false);

    $effect(() => {
        const ref = board.selected;
        if (ref === null) {
            if (dialog.open) dialog.close();
            return;
        }
        if (!dialog.open) {
            dialog.showModal();
            dialog.focus();
        }
        detail = null;
        failed = "";
        confirming = false;
        // ignore an answer that arrives after another task was opened
        fetchDetail(ref)
            .then((d) => board.selected === ref && (detail = d))
            .catch((e) => board.selected === ref && (failed = String(e)));
    });
</script>

<!-- one dim layer for the whole screen, status bar area included, fading in and out together; the dialog's own backdrop is left clear -->
<div class="dim" class:on={board.selected !== null}></div>

<!-- the sheet takes the focus itself (see the effect), so the browser doesn't focus the close button -->
<dialog
    tabindex="-1"
    bind:this={dialog}
    onclose={() => select(null)}
    oncancel={(e) => board.busy && e.preventDefault()}
    onclick={(e) => e.target === dialog && !board.busy && select(null)}
>
    {#if item}
        <header>
            <h2>{item.title}</h2>
            <button class="close" aria-label="close" disabled={board.busy} onclick={() => select(null)}>×</button>
        </header>
        <div class="controls">
            <StatusMenu {item} />
            <PriorityMenu {item} />
            {#if item.repo !== HOME_REPO}<span class="chip">{item.repo.split("/")[1]}</span>{/if}
            {#if item.lab}<span class="chip">lab</span>{/if}
            {#if item.size}<span class="chip">{item.size}</span>{/if}
            {#if item.due}<span class="chip"><Icon name="calendar" size={0.9} />{item.due}</span>{/if}
            <a class="issue" href={item.url} target="_blank" rel="noopener"><Icon name="link" size={1} />{item.ref}</a>
            <!-- an inbox task is deleted for good; a triaged one is closed as not planned -->
            {#if board.busy}
                <span class="confirm"><Spinner /></span>
            {:else if confirming}
                <span class="confirm">
                    are you sure?
                    <button class="yes" aria-label={deletes ? "delete task for good" : "close task as not planned"} onclick={() => (deletes ? removeTask(item) : dropTask(item))}><Icon name="check" size={1.1} /></button>
                    <button aria-label="keep task" onclick={() => (confirming = false)}><Icon name="close" size={1.1} /></button>
                </span>
            {:else}
                <button class="trash" aria-label={deletes ? "delete task" : "close task as not planned"} onclick={() => (confirming = true)}><Icon name="trash" size={1.1} /></button>
            {/if}
        </div>
        {#if board.error}<p class="error">{board.error}</p>{/if}

        <div class="text">
            {#if failed}
                <p class="error">{failed}</p>
            {:else if !detail}
                <p class="faint">loading ...</p>
            {:else}
                <!-- html rendered and sanitized by GitHub, from this repo's own issues -->
                {#if detail.bodyHtml}{@html detail.bodyHtml}{:else}<p class="faint">no description</p>{/if}
                {#each detail.comments as comment}
                    <hr />
                    <p class="faint">{new Date(comment.createdAt).toLocaleDateString()}</p>
                    {@html comment.bodyHtml}
                {/each}
            {/if}
        </div>
    {/if}
</dialog>

<style>
    /* the link stays left and the delete controls take the right edge; the confirm text then grows leftwards without moving the link */
    .trash,
    .confirm {
        margin-left: auto;
    }
    .trash,
    .confirm button {
        display: inline-flex;
        align-items: center;
        padding: 0.3em;
        color: var(--muted);
        background: none;
        border: none;
        border-radius: 999px;
        cursor: pointer;
    }
    .confirm {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        color: var(--muted);
    }
    .confirm .yes {
        color: #c0392b;
    }
    dialog {
        width: min(36rem, 100% - 2rem);
        max-height: 80dvh;
        padding: 1.2rem 1.4rem;
        color: var(--text);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        box-shadow: var(--shadow-hover);
        overflow: auto;
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
    header {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }
    h2 {
        flex: 1;
        margin: 0;
        font-size: 1.25em;
        overflow-wrap: anywhere;
    }
    .close {
        font-size: 1.6em;
        line-height: 1;
        color: var(--muted);
        background: none;
        border: none;
        cursor: pointer;
    }
    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        margin: 0.8rem 0;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25em;
        padding: 0 0.5em;
        border-radius: 999px;
        background: var(--bg-alt);
        color: var(--muted);
        font-size: 0.82em;
    }
    .issue {
        display: inline-flex;
        align-items: center;
        gap: 0.25em;
        color: var(--muted);
        text-decoration: none;
    }
    .error {
        color: var(--accent);
    }
    .faint {
        color: var(--faint);
        font-size: 0.85em;
    }
    .text :global(img) {
        max-width: 100%;
    }
    .text :global(pre) {
        overflow-x: auto;
    }

    /* phone: a sheet pinned to the bottom */
    @media (max-width: 768px) {
        dialog {
            width: 100%;
            max-width: none;
            margin: auto 0 0;
            max-height: 85dvh;
            border-radius: 14px 14px 0 0;
            padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.2rem);
        }
    }
</style>
