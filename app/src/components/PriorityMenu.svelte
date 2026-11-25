<script lang="ts">
    import { PRIORITIES } from "../../../worker/src/types";
    import type { BoardItem } from "../lib/api";
    import { changePriority } from "../lib/board.svelte";

    /** Chip showing an item's priority (project or task); tapping it opens the system picker to change it. An item without a priority shows "none". */
    let { item }: { item: BoardItem } = $props();

    // chip colour, one of --pr-1 (!!!) to --pr-4 (- or none)
    let level = $derived(PRIORITIES.indexOf(item.priority ?? "") + 1 || 4);
</script>

<!-- same trick as the status pill: plain text for the chip, an invisible select on top; it sits above the card's stretched link so a tap here doesn't open the project -->
<label class="chip priority" style="--pr: var(--pr-{level})">
    {item.priority ?? "none"}
    <select value={item.priority ?? ""} aria-label="priority" onchange={(e) => changePriority(item, e.currentTarget.value)}>
        {#if item.priority === null}<option value="" disabled>none</option>{/if}
        {#each PRIORITIES as priority}
            <option value={priority}>{priority}</option>
        {/each}
    </select>
</label>

<style>
    .chip {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        padding: 0 0.5em;
        border-radius: 999px;
        font-size: 0.82em;
        font-weight: 600;
        color: var(--pr);
        background: color-mix(in srgb, var(--pr) 15%, transparent);
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
