<script lang="ts">
    import { allowedStatuses, statusSlug } from "../../../worker/src/types";
    import type { BoardItem } from "../lib/api";
    import { board, changeStatus } from "../lib/board.svelte";

    /** Picker for an item's status. Shows only the statuses the board rules allow: a task of a paused project can only match it or be done. */
    let { item }: { item: BoardItem } = $props();

    let options = $derived(allowedStatuses(item, board.items));
</script>

<!-- the pill shows the status as plain text so it fits the word; the real select sits invisibly on top and opens the system picker -->
<label class="pill" style="--st: var(--st-{statusSlug(item.status ?? "")})">
    {item.status}
    <select value={item.status} aria-label="status" onchange={(e) => changeStatus(item, e.currentTarget.value)}>
        {#each options as status}
            <option value={status}>{status}</option>
        {/each}
    </select>
</label>

<style>
    .pill {
        position: relative;
        display: inline-block;
        padding: 0.1em 0.7em;
        font-size: 0.85em;
        font-weight: 500;
        line-height: 1.5;
        color: var(--st, var(--muted));
        background: color-mix(in srgb, var(--st, var(--muted)) 15%, var(--card));
        border: 1px solid color-mix(in srgb, var(--st, var(--muted)) 35%, transparent);
        border-radius: 999px;
        cursor: pointer;
    }
    select {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
</style>
