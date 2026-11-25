<script lang="ts">
    import type { BoardItem } from "../lib/api";
    import { allowedStatuses, statusSlug } from "../../../worker/src/types";
    import { board, changeStatus, drag } from "../lib/board.svelte";
    import Card from "./Card.svelte";

    /**
     * Kanban board: one column per status, cards in the order given. On desktop a card can be dragged to another column, which sets its status like the status menu does; columns the board rules refuse are dimmed while dragging.
     *
     * Args:
     *   statuses: column names, left to right.
     *   items: the cards; each goes in the column matching its status.
     *   start: the column to show first on a phone (centred); changing it moves there again.
     */
    let { statuses, items, start }: { statuses: string[]; items: BoardItem[]; start: string } = $props();

    let boardEl: HTMLDivElement;
    // the column the dragged card is over, to highlight it
    let over: string | null = $state(null);

    // a column takes the dragged card if the board rules allow its status and it is not the card's own column
    function accepts(status: string): boolean {
        const dragged = drag.item;
        // a card from another list (e.g. a flat task on an area page) can't be dropped here
        return dragged !== null && items.some((i) => i.id === dragged.id) && dragged.status !== status && allowedStatuses(dragged, board.items).includes(status);
    }

    function onDragOver(e: DragEvent, status: string): void {
        if (!accepts(status)) return;
        e.preventDefault(); // without this the browser refuses the drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        over = status;
    }

    function onDrop(status: string): void {
        const item = drag.item;
        over = null;
        if (item && accepts(status)) changeStatus(item, status);
    }

    // on a phone the board scrolls sideways, so centre the starting column; does nothing on desktop where nothing scrolls
    $effect(() => {
        const column = boardEl.querySelector<HTMLElement>(`[data-status="${start}"]`);
        if (column) boardEl.scrollLeft = column.offsetLeft - (boardEl.clientWidth - column.offsetWidth) / 2;
    });
</script>

<div class="board" bind:this={boardEl}>
    {#each statuses as status}
        {@const cards = items.filter((i) => i.status === status)}
        <section
            data-status={status}
            role="group"
            aria-label={status}
            style="--st: var(--st-{statusSlug(status)})"
            class:refuses={drag.item !== null && drag.item.status !== status && !accepts(status)}
            class:over={over === status}
            ondragover={(e) => onDragOver(e, status)}
            ondragleave={() => over === status && (over = null)}
            ondrop={() => onDrop(status)}
        >
            <h3>{status}</h3>
            <div class="cards">
                {#each cards as item (item.id)}
                    <Card {item} />
                {/each}
            </div>
        </section>
    {/each}
</div>

<style>
    .board {
        position: relative;
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(240px, 1fr);
        gap: 1rem;
        align-items: start;
    }
    section {
        background: color-mix(in srgb, var(--st) var(--st-tint), var(--bg-alt));
        border: 1px solid color-mix(in srgb, var(--st) 22%, transparent);
        border-radius: 12px;
        padding: 0.8rem;
        min-width: 0;
        transition: opacity 0.15s ease, outline-color 0.15s ease;
        outline: 2px solid transparent;
    }
    section.refuses {
        opacity: 0.4;
    }
    section.over {
        outline-color: var(--st);
    }
    h3 {
        margin: 0 0 0.6rem;
        font-family: var(--font-ui);
        font-size: 1em;
        font-variant: small-caps;
        letter-spacing: 0.04em;
        color: var(--st);
    }
    .cards {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    /* phone: one column at a time, swipe sideways */
    @media (max-width: 768px) {
        .board {
            grid-auto-columns: 100%;
            gap: 0.75rem;
            /* the board reaches to the bottom of the screen, so a swipe works anywhere below the title */
            min-height: calc(100dvh - 11rem);
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            margin: 0 -1.5rem;
            padding: 0 1.5rem;
            /* keep the sideways swipe from chaining into the page or the browser's back gesture */
            overscroll-behavior-x: contain;
            scrollbar-width: none;
        }
        .board::-webkit-scrollbar {
            display: none;
        }
        section {
            scroll-snap-align: center;
        }
    }
</style>
