<script lang="ts">
    import Card from "../components/Card.svelte";
    import AddTaskDialog from "../components/AddTaskDialog.svelte";
    import Icon from "../components/Icon.svelte";
    import TriageReview from "../components/TriageReview.svelte";
    import Spinner from "../components/Spinner.svelte";
    import { postTask, postTriage, type TriageOptions } from "../lib/api";
    import { board, inboxTasks, loadBoard } from "../lib/board.svelte";
    import { toRows, type Row } from "../lib/triage";

    /** Open tasks still in the inbox. Each can be moved by hand from its detail sheet's status menu, or all triaged at once: the triage button asks the Worker to have Claude propose Area, Size, Priority, Status and project for each, and opens a review list where nothing is written until applied. */
    let tasks = $derived(inboxTasks(board.items));

    /** The open triage review, or null when none is showing. */
    let review: { rows: Row[]; options: TriageOptions } | null = $state(null);
    /** True while the Worker is asking Claude. */
    let triaging = $state(false);

    /** Asks the Worker for proposals and opens the review list; an empty answer or a failure goes to `board.error`. */
    async function triage(): Promise<void> {
        triaging = true;
        try {
            const { proposals, options } = await postTriage();
            board.error = proposals.length === 0 ? "nothing to triage" : "";
            review = proposals.length === 0 ? null : { rows: toRows(proposals, board.items), options };
        } catch (err) {
            board.error = err instanceof Error ? err.message : String(err);
        }
        triaging = false;
    }

    let list: HTMLElement | undefined = $state();
    /** Whether the add-task pop-up is showing. */
    let open = $state(false);
    /** Tasks just created that the board does not list yet: the Worker adds a new issue to the board, but the app's copy of the board is only refreshed by loading it. */
    let pending: { key: number; ref: string | null; title: string }[] = $state([]);
    let nextKey = 0;

    /** Creates a task, shows it as pending at once (so the slot the pop-up held does not jump), then reloads the board until it appears. */
    async function add(text: string, repo: string): Promise<void> {
        const row = { key: nextKey++, ref: null as string | null, title: text };
        pending.push(row);
        const mine = pending[pending.length - 1];
        try {
            const { number } = await postTask(text, repo);
            const ref = `${repo}#${number}`;
            mine.ref = ref;
            board.error = "";
            await loadBoard();
            for (let i = 0; i < 6 && !board.items.some((t) => t.ref === ref); i++) {
                await new Promise((r) => setTimeout(r, 2500));
                await loadBoard();
            }
        } catch (err) {
            board.error = err instanceof Error ? err.message : String(err);
        }
        pending = pending.filter((p) => p.key !== row.key);
    }
</script>

<div class="page">
<div class="list" bind:this={list}>
    <!-- while the pop-up is open it floats over this empty slot, and the cards wait below it -->
    {#if open}<div class="slot"></div>{/if}
    {#each pending as p (p.key)}
        <div class="pending">{#if p.ref}<span>{p.ref}</span>{/if}{p.title}</div>
    {/each}
    {#each tasks as item (item.id)}
        <Card {item} />
    {:else}
        {#if board.items.length > 0}<p class="empty">inbox is empty</p>{/if}
    {/each}
</div>

<AddTaskDialog bind:open anchor={list} onsubmit={add} />

<div class="actions">
    <button class="pill" onclick={() => (open = true)}><Icon name="plus" size={1.3} />add task</button>
    {#if tasks.length > 0}
        <button class="pill triage" disabled={triaging || review !== null} onclick={triage}>
            {#if triaging}<Spinner />triaging…{:else}<Icon name="claude" size={1.3} />triage inbox{/if}
        </button>
    {/if}
</div>
{#if review}
    <TriageReview bind:rows={review.rows} options={review.options} onclose={() => (review = null)} />
{/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
    }
    .list {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 36rem;
    }
    .slot {
        height: 3.5rem;
    }
    .pending {
        display: flex;
        gap: 0.4em;
        align-items: center;
        min-height: 3.5rem; /* the height of the pop-up it replaces */
        padding: 0.45rem 0.8rem;
        color: var(--muted);
        border: 1px dashed var(--border);
        border-radius: 0.6rem;
    }
    .empty {
        color: var(--muted);
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        margin-top: 1.2rem;
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.5em;
        padding: 0.55em 1.2em;
        font: inherit;
        font-weight: 500;
        color: var(--text);
        text-decoration: none;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 999px;
        box-shadow: var(--shadow-rest);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    /* the triage icon is Claude's orange */
    .triage :global(svg) {
        color: #d97757;
    }
    .pill:disabled {
        opacity: 0.6;
    }
    @media (hover: hover) {
        .pill:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-hover);
        }
    }
</style>
