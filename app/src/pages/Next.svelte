<script lang="ts">
    import Card from "../components/Card.svelte";
    import { board, areaNames } from "../lib/board.svelte";
    import { dueSoon, nextList, PLACES, TIMES } from "../lib/next";

    /** What can be done right now, built from the board when opened: segmented toggles (area, time, then place and backlog), tasks due soon, then one list of tasks, 5 at first. The toggles are remembered on this device. */

    // first rows of the list before "show more"
    const FIRST = 5;

    // a saved toggle, or the fallback when storage is empty or blocked
    function load(key: string, fallback: string): string {
        try {
            return localStorage.getItem(`attask.next.${key}`) ?? fallback;
        } catch {
            return fallback;
        }
    }
    function save(key: string, value: string): void {
        try {
            localStorage.setItem(`attask.next.${key}`, value);
        } catch {
            // not remembered, the toggle still works
        }
    }

    let area = $state(load("area", "all"));
    let time = $state(load("time", "any"));
    let place = $state(load("place", "lab"));
    let backlog = $state(load("backlog", "false") === "true");
    let expanded = $state(false);
    $effect(() => save("area", area));
    $effect(() => save("time", time));
    $effect(() => save("place", place));
    $effect(() => save("backlog", String(backlog)));

    let areas = $derived(["all", ...areaNames(board.items)]);
    // a saved area that no longer exists falls back to all
    let shownArea = $derived(areas.includes(area) ? area : "all");
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
    let due = $derived(dueSoon(board.items, shownArea, today));
    // tasks already under due soon are not repeated
    let list = $derived(nextList(board.items, { time, place, area: shownArea, backlog }).filter((t) => !due.includes(t)));
    let shown = $derived(expanded ? list : list.slice(0, FIRST));
</script>

<div class="toggles">
    <div class="segmented" role="group" aria-label="area">
        {#each areas as choice (choice)}
            <button class:on={choice === shownArea} aria-pressed={choice === shownArea} onclick={() => (area = choice)}>{choice}</button>
        {/each}
    </div>
    <div class="segmented" role="group" aria-label="time">
        {#each TIMES as choice (choice)}
            <button class:on={choice === time} aria-pressed={choice === time} onclick={() => (time = choice)}>{choice}</button>
        {/each}
    </div>
    <div class="row">
        <div class="segmented place" role="group" aria-label="place">
            {#each PLACES as choice (choice)}
                <button class:on={choice === place} aria-pressed={choice === place} onclick={() => (place = choice)}>{choice}</button>
            {/each}
        </div>
        <div class="segmented">
            <button class:on={backlog} aria-pressed={backlog} onclick={() => (backlog = !backlog)}>backlog</button>
        </div>
    </div>
</div>

{#if due.length > 0}
    <div class="list due">
        {#each due as item (item.id)}
            <Card {item} compact />
        {/each}
    </div>
{/if}

<div class="list">
    {#each shown as item (item.id)}
        <Card {item} compact />
    {:else}
        {#if board.items.length > 0 && due.length === 0}<p class="empty">nothing next</p>{/if}
    {/each}
</div>
{#if !expanded && list.length > FIRST}
    <button class="more" onclick={() => (expanded = true)}>show {list.length - FIRST} more</button>
{/if}

<style>
    .toggles {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        max-width: 36rem;
        margin: 0.5rem 0 1rem;
        font-size: 0.9em;
    }
    .row {
        display: flex;
        gap: 0.4rem;
    }
    /* place gets two thirds of the row, backlog the rest */
    .place {
        flex: 2;
    }
    .row > :last-child {
        flex: 1;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 36rem;
    }
    .due {
        margin-bottom: 1.25rem;
    }
    .more {
        font: inherit;
        margin-top: 0.6rem;
        padding: 0.15rem 0;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--muted);
        font-size: 0.9em;
    }
    .empty {
        color: var(--muted);
    }
</style>
