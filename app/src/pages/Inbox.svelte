<script lang="ts">
    import Card from "../components/Card.svelte";
    import AddTaskDialog from "../components/AddTaskDialog.svelte";
    import Icon from "../components/Icon.svelte";
    import { postTask } from "../lib/api";
    import { board, inboxTasks, loadBoard } from "../lib/board.svelte";

    /** Open tasks still in the inbox. Each can be moved by hand from its detail sheet's status menu, or all triaged at once by an agent. The button opens Claude with a triage prompt for these issues already filled in, where it can be edited before sending. */
    let tasks = $derived(inboxTasks(board.items));

    const prompt =
        "Triage my inbox on the task_planner board (GitHub Project st4eve #2) with the MyLife planner skill. For each Inbox item (refs like owner/name#n): set Area, Size and Priority, set Status to To do or Backlog, and add it as a sub-issue of a `project` issue if it belongs to one.";

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
        <a class="pill" href="https://claude.ai/new?q={encodeURIComponent(prompt)}" target="_blank" rel="noopener">
            <Icon name="claude" size={1.3} />triage inbox
        </a>
    {/if}
</div>
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
    a.pill :global(svg) {
        color: #d97757;
    }
    @media (hover: hover) {
        .pill:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-hover);
        }
    }
</style>
