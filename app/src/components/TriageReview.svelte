<script lang="ts">
    import type { TriageOptions } from "../lib/api";
    import { board, loadBoard, openProjects } from "../lib/board.svelte";
    import { applyProposal, setParent, staleReason, statusChoices, type Row } from "../lib/triage";
    import Icon from "./Icon.svelte";

    /** Claude's proposals for the inbox, one row each. Every chip is a menu; apply writes the row, skip leaves it out of "apply all". Applied rows disappear; closing discards the rest. */
    let { rows = $bindable(), options, onclose }: { rows: Row[]; options: TriageOptions; onclose: () => void } = $props();

    let projects = $derived(openProjects(board.items));
    let running = $state(false);

    /** Writes one row; on failure the row stays with the reason, and the task stays in Inbox. A row whose task left the inbox since triage ran is refused, not written. */
    async function apply(row: Row): Promise<boolean> {
        row.error = staleReason(row.proposal, board.items);
        if (row.error) return false;
        row.busy = true;
        try {
            await applyProposal(row.proposal);
            return true;
        } catch (e) {
            row.error = e instanceof Error ? e.message : String(e);
            return false;
        } finally {
            row.busy = false;
        }
    }

    /** Reloads the board so each row is checked against it, applies the rows one after another, then reloads once more and drops the rows that were written. */
    async function applyRows(chosen: Row[]): Promise<void> {
        running = true;
        await loadBoard();
        const done = new Set<string>();
        for (const row of chosen) if (await apply(row)) done.add(row.proposal.id);
        rows = rows.filter((r) => !done.has(r.proposal.id));
        await loadBoard();
        running = false;
        if (rows.length === 0) onclose();
    }
</script>

<section class="review">
    <header>
        <h2>triage</h2>
        <button class="icon" aria-label="close triage" onclick={onclose}><Icon name="close" size={1.1} /></button>
    </header>

    {#each rows as row (row.proposal.id)}
        <div class="row" class:skipped={row.skipped}>
            <div class="title"><span class="ref">{row.proposal.ref}</span> {row.title}</div>
            <div class="chips">
                <!-- each chip is plain text with an invisible select on top, like the status pill -->
                <label class="chip">{row.proposal.area ?? "area"}
                    <select aria-label="area" value={row.proposal.area ?? ""} onchange={(e) => (row.proposal.area = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.area as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.size ?? "size"}
                    <select aria-label="size" value={row.proposal.size ?? ""} onchange={(e) => (row.proposal.size = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.size as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.priority ?? "priority"}
                    <select aria-label="priority" value={row.proposal.priority ?? ""} onchange={(e) => (row.proposal.priority = e.currentTarget.value || null)}>
                        <option value="">none</option>
                        {#each options.priority as o}<option value={o}>{o}</option>{/each}
                    </select>
                </label>
                <label class="chip">{row.proposal.status}
                    <select aria-label="status" value={row.proposal.status} onchange={(e) => (row.proposal.status = e.currentTarget.value as Row["proposal"]["status"])}>
                        {#each statusChoices(row.proposal, board.items) as s}<option value={s}>{s}</option>{/each}
                    </select>
                </label>
                <label class="chip">{projects.find((p) => p.ref === row.proposal.parent)?.title ?? "no project"}
                    <select aria-label="project" disabled={row.hasParent} value={row.proposal.parent ?? ""} onchange={(e) => (row.proposal = setParent(row.proposal, e.currentTarget.value || null, board.items))}>
                        <option value="">no project</option>
                        {#each projects as p}<option value={p.ref}>{p.title}</option>{/each}
                    </select>
                </label>
            </div>
            <p class="reason">{row.proposal.reason}</p>
            {#if row.error}<p class="error">{row.error}</p>{/if}
            <div class="row-actions">
                <button class="pill" disabled={running || row.busy} onclick={() => applyRows([row])}><Icon name="check" size={1} />apply</button>
                <button class="pill" disabled={running} onclick={() => (row.skipped = !row.skipped)}>{row.skipped ? "unskip" : "skip"}</button>
            </div>
        </div>
    {/each}

    <button class="pill all" disabled={running || rows.every((r) => r.skipped)} onclick={() => applyRows(rows.filter((r) => !r.skipped))}>
        <Icon name="check" size={1.2} />apply all
    </button>
</section>

<style>
    .review {
        width: 100%;
        max-width: 36rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        margin-top: 1.2rem;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h2 {
        margin: 0;
        font-size: 1.1em;
    }
    .icon {
        display: inline-flex;
        padding: 0.3em;
        color: var(--muted);
        background: none;
        border: none;
    }
    .row {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.6rem 0.8rem;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 0.6rem;
    }
    .row.skipped {
        opacity: 0.55;
    }
    .ref {
        color: var(--muted);
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .chip {
        position: relative;
        padding: 0.05em 0.6em;
        font-size: 0.82em;
        font-weight: 500;
        border: 1px solid var(--border);
        border-radius: 999px;
        cursor: pointer;
    }
    .chip select {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
    .reason,
    .error {
        margin: 0;
        font-size: 0.85em;
        color: var(--muted);
    }
    .error {
        color: #d14343;
    }
    .row-actions {
        display: flex;
        gap: 0.5rem;
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        padding: 0.35em 0.9em;
        font: inherit;
        color: var(--text);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 999px;
    }
    .pill:disabled {
        opacity: 0.5;
    }
    .all {
        align-self: flex-start;
    }
</style>
