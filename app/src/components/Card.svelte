<script lang="ts">
    import { projectOf } from "../../../worker/src/types";
    import { board, drag, select, tasksOf } from "../lib/board.svelte";
    import { HOME_REPO, type BoardItem } from "../lib/api";
    import { projectHref } from "../lib/router.svelte";
    import Icon from "./Icon.svelte";
    import PriorityMenu from "./PriorityMenu.svelte";

    /** A project shows its priority and open task count and links to its page; a task shows repo, lab, size, priority and due date and opens the detail sheet. The whole card is the link or button. Args: item: the card; compact: a task card showing only its project and due date chips, not draggable. */
    let { item, compact = false }: { item: BoardItem; compact?: boolean } = $props();

    // title of the task's project, only looked up for compact cards
    let projectTitle = $derived(compact ? projectOf(board.items, item)?.title : undefined);
    // a drag is a move, so the browser shows no copy (+) cursor; a link inside the card would otherwise be dragged in its place, hence draggable="false" on them
    function onDragStart(e: DragEvent): void {
        drag.item = item;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", item.ref); // Firefox only starts a drag that carries data
        }
    }
    let taskCount = $derived(item.isProject ? tasksOf(board.items, item.ref).length : 0);
</script>

<!-- inbox cards have no parent, so they stay put; compact cards are on Next, which has no columns -->
<article
    draggable={item.status !== "Inbox" && !compact}
    class:dragging={drag.item?.id === item.id}
    ondragstart={onDragStart}
    ondragend={() => (drag.item = null)}
>
    <div class="top">
        {#if item.isProject}
            <a class="title" href={projectHref(item.ref)} draggable="false">{item.title}</a>
        {:else}
            <button class="title" onclick={() => select(item.ref)}>{item.title}</button>
        {/if}
        {#if item.isProject}
            <a class="issue" href={item.url} target="_blank" rel="noopener" draggable="false" aria-label="open issue {item.ref}"><Icon name="link" size={1} /></a>
        {/if}
    </div>
    <div class="meta">
        {#if compact}
            {#if projectTitle}<span class="chip">{projectTitle}</span>{/if}
            {#if item.due}<span class="chip due"><Icon name="calendar" size={0.9} />{item.due}</span>{/if}
        {:else if item.isProject}
            <PriorityMenu {item} />
            <span class="chip">{taskCount} open</span>
        {:else}
            {#if item.repo !== HOME_REPO}<span class="chip">{item.repo.split("/")[1]}</span>{/if}
            {#if item.lab}<span class="chip">lab</span>{/if}
            {#if item.size}<span class="chip">{item.size}</span>{/if}
            {#if item.priority}<span class="chip">{item.priority}</span>{/if}
            {#if item.due}<span class="chip due"><Icon name="calendar" size={0.9} />{item.due}</span>{/if}
        {/if}
    </div>
</article>

<style>
    article {
        position: relative;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.7rem 0.8rem;
        box-shadow: var(--shadow-rest);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    @media (hover: hover) {
        article:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-hover);
        }
    }
    article.dragging {
        opacity: 0.4;
    }
    /* stretch the title link over the whole card */
    .title::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 10px;
    }
    .top {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }
    .title {
        flex: 1;
        font: inherit;
        text-align: left;
        padding: 0;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text);
        text-decoration: none;
        font-weight: 500;
        overflow-wrap: anywhere;
    }
    /* above the stretched title link so it stays its own target */
    .issue {
        position: relative;
        z-index: 1;
        color: var(--faint);
        padding-top: 0.2em;
    }
    .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-top: 0.4rem;
    }
    .meta:empty {
        display: none;
    }    .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25em;
        padding: 0 0.5em;
        border-radius: 999px;
        background: var(--bg-alt);
        color: var(--muted);
        font-size: 0.82em;
    }
</style>
