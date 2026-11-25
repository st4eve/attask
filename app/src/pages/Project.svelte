<script lang="ts">
    import Board from "../components/Board.svelte";
    import Icon from "../components/Icon.svelte";
    import { board, tasksOf } from "../lib/board.svelte";
    import { areaHref } from "../lib/router.svelte";

    /** Kanban of one project's open tasks by status, with a link back to its Area. */
    let { ref }: { ref: string } = $props();

    let project = $derived(board.items.find((i) => i.ref === ref && i.isProject));
    // phone starts on the column matching the project's own status: Backlog, Waiting, else In progress
    let start = $derived(project?.status === "Backlog" || project?.status === "Waiting" ? project.status : "In progress");
</script>

{#if project}
    {#if project.area}
        <a class="back" href={areaHref(project.area)}><Icon name="chevron" size={0.9} />{project.area}</a>
    {/if}
{/if}
{#if project}
    <Board statuses={["Backlog", "To do", "In progress", "Waiting"]} items={tasksOf(board.items, ref)} {start} />
{:else if board.items.length > 0}
    <p>no project {ref}</p>
{/if}

<style>
    .back {
        display: inline-flex;
        align-items: center;
        gap: 0.2em;
        margin-bottom: 0.8rem;
        color: var(--muted);
        text-decoration: none;
    }
    .back :global(svg) {
        transform: rotate(180deg);
    }
</style>
