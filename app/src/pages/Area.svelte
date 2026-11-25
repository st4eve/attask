<script lang="ts">
    import Board from "../components/Board.svelte";
    import Card from "../components/Card.svelte";
    import { areaSummary } from "../lib/areas";
    import { board, flatTasksIn, projectsIn } from "../lib/board.svelte";

    /**
     * One Area: its projects as a board, then its open tasks that belong to no project.
     *
     * Args:
     *   name: the Area option name.
     */
    let { name }: { name: string } = $props();
    let flat = $derived(flatTasksIn(board.items, name));
</script>

{#if areaSummary(name)}<p class="summary">{areaSummary(name)}</p>{/if}
<Board statuses={["Backlog", "In progress", "Waiting"]} items={projectsIn(board.items, name)} start="In progress" />
{#if flat.length}
    <h3>tasks</h3>
    <ul class="flat">
        {#each flat as item (item.ref)}<li><Card {item} /></li>{/each}
    </ul>
{/if}

<style>
    .summary {
        margin: 0 0 1rem;
        color: var(--muted);
    }
    .flat {
        list-style: none;
        padding: 0;
        display: grid;
        gap: 0.5rem;
    }
</style>
