<script lang="ts">
    import { onMount } from "svelte";
    import StatusMenu from "./components/StatusMenu.svelte";
    import DetailSheet from "./components/DetailSheet.svelte";
    import BottomBar from "./components/BottomBar.svelte";
    import Sidebar from "./components/Sidebar.svelte";
    import Area from "./pages/Area.svelte";
    import Inbox from "./pages/Inbox.svelte";
    import Next from "./pages/Next.svelte";
    import Project from "./pages/Project.svelte";
    import Settings from "./pages/Settings.svelte";
    import { board, loadBoard, select } from "./lib/board.svelte";
    import { replaceRoute, router } from "./lib/router.svelte";
    import { taskLanding } from "./lib/tasklink";

    // desktop sidebar width in px, dragged from its right edge and kept on this device
    const minWidth = 200;
    const maxWidth = 420;
    let sidebarWidth = $state(initialWidth());

    function initialWidth(): number {
        const saved = Number(localStorage.getItem("attask.sidebar"));
        return saved >= minWidth && saved <= maxWidth ? saved : 260;
    }

    function resize(width: number): void {
        sidebarWidth = Math.min(maxWidth, Math.max(minWidth, width));
        localStorage.setItem("attask.sidebar", String(sidebarWidth));
    }

    let title = $derived.by(() => {
        const route = router.route;
        switch (route.page) {
            case "area":
                return route.name;
            case "project":
                return board.items.find((i) => i.ref === route.ref && i.isProject)?.title ?? route.ref;
            case "settings":
                return "settings";
            case "next":
                return "next";
            default:
                return "inbox";
        }
    });

    // the open project's own status menu sits in the page head, so it stays at the right edge when a wide board scrolls sideways
    let headProject = $derived.by(() => {
        const route = router.route;
        return route.page === "project" ? board.items.find((i) => i.ref === route.ref && i.isProject) : undefined;
    });

    // pull down from the top of the page on a phone to reload the board
    let main: HTMLElement;
    let pull = $state(0);
    let refreshing = $state(false);
    let start: { x: number; y: number } | null = null;
    // the page glides back after a pull but follows the finger during one
    let dragging = $state(false);
    const pullNeeded = 60;

    function touchStart(e: TouchEvent): void {
        if (main.scrollTop <= 0 && !refreshing) {
            start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragging = true;
        }
    }

    function touchMove(e: TouchEvent): void {
        if (!start) return;
        const dx = e.touches[0].clientX - start.x;
        const dy = e.touches[0].clientY - start.y;
        // a sideways swipe on a board is not a pull
        const next = dy > 0 && dy > Math.abs(dx) ? Math.min(dy * 0.5, 80) : 0;
        pull = next;
    }

    async function touchEnd(): Promise<void> {
        if (!start) return;
        start = null;
        dragging = false;
        if (pull >= pullNeeded) {
            refreshing = true;
            pull = pullNeeded;
            await loadBoard();
            refreshing = false;
        }
        pull = 0;
    }

    onMount(loadBoard);

    // a note link waits for the board, then becomes the page underneath and opens the task's sheet; it also runs when a link arrives while the app is open
    $effect(() => {
        const route = router.route;
        if (route.page !== "task" || board.items.length === 0) return;
        const landing = taskLanding(board.items, route.repo, route.number);
        replaceRoute(landing.hash);
        // a good link clears the error a bad one left
        board.error = landing.error;
        // a project or a bad link closes any sheet left open from before
        select(landing.selected);
    });
</script>

<div class="layout" style="--sidebar-w: {sidebarWidth}px">
    <aside>
        <Sidebar />
        <div
            class="resizer"
            role="slider"
            aria-orientation="horizontal"
            aria-label="resize sidebar"
            aria-valuenow={sidebarWidth}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
            tabindex="0"
            onpointerdown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onpointermove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && resize(e.clientX)}
            onkeydown={(e) => {
                if (e.key === "ArrowLeft") resize(sidebarWidth - 20);
                if (e.key === "ArrowRight") resize(sidebarWidth + 20);
            }}
        ></div>
    </aside>

    <main bind:this={main} class:dragging style="transform: translateY({pull * 0.75}px)" ontouchstart={touchStart} ontouchmove={touchMove} ontouchend={touchEnd} ontouchcancel={touchEnd}>
        <div class="pagehead">
            <h1>{title}</h1>
            {#if headProject}<StatusMenu item={headProject} />{/if}
        </div>
        <div class="content">
            {#if board.error}<p class="error">{board.error}</p>{/if}
            <!-- a new page starts fresh, so a board always opens on its own starting column -->
            {#key JSON.stringify(router.route)}
                {#if router.route.page === "settings"}
                    <Settings />
                {:else if router.route.page === "inbox"}
                    <Inbox />
                {:else if router.route.page === "next"}
                    <Next />
                {:else if router.route.page === "area"}
                    <Area name={router.route.name} />
                {:else if router.route.page === "project"}
                    <Project ref={router.route.ref} />
                {/if}
            {/key}
        </div>
    </main>
</div>

<!-- sunset bar under the status bar: grows from the middle as you pull, pulses while the board loads -->
<div
    class="pullbar"
    class:loading={refreshing}
    style="transform: scaleX({refreshing ? 1 : Math.min(1, pull / pullNeeded)}); opacity: {refreshing ? '' : Math.min(1, pull / 20)}"
></div>

<div class="bottombar"><BottomBar /></div>
<DetailSheet />

<style>
    .layout {
        display: grid;
        grid-template-columns: var(--sidebar-w, 260px) 1fr;
        grid-template-rows: minmax(0, 1fr);
        height: 100dvh;
    }
    aside {
        background: var(--bg-alt);
        border-right: 1px solid var(--border);
        position: relative;
    }
    /* wide invisible grab area with a thin line that shows on hover */
    .resizer {
        position: absolute;
        top: 0;
        bottom: 0;
        right: -4px;
        width: 9px;
        cursor: col-resize;
        touch-action: none;
        z-index: 6;
        background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    .resizer:hover,
    .resizer:active,
    .resizer:focus-visible {
        opacity: 0.6;
        outline: none;
    }
    main {
        overflow: auto;
    }
    /* the title stays on top while the content scrolls under it */
    .pagehead {
        position: sticky;
        top: 0;
        left: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 1.5rem 3rem 0.5rem;
        background: var(--bg);
    }
    .pagehead h1 {
        margin: 0;
    }
    .content {
        padding: 0.5rem 3rem 1.5rem;
    }
    .pagehead h1 {
        flex: 1;
        min-width: 0;
    }
    .error {
        color: var(--accent);
    }

    /* the page follows the finger during a pull and glides back after */
    main {
        transition: transform 0.25s ease;
    }
    main.dragging {
        transition: none;
    }
    .pullbar {
        position: fixed;
        top: env(safe-area-inset-top, 0px);
        left: 0;
        right: 0;
        z-index: 20;
        height: 3px;
        background: var(--sunset);
        transform-origin: 50% 50%;
        transform: scaleX(0);
        opacity: 0;
        pointer-events: none;
    }
    .pullbar.loading {
        animation: pulse 0.9s ease-in-out infinite;
    }
    @keyframes pulse {
        0%,
        100% {
            opacity: 0.45;
        }
        50% {
            opacity: 1;
        }
    }

    .bottombar {
        display: none;
    }

    /* phone: no sidebar, the floating bar at the bottom moves between pages */
    @media (max-width: 768px) {
        .layout {
            grid-template-columns: 1fr;
        }
        aside {
            display: none;
        }
        .bottombar {
            display: block;
        }
        /* keep clear of the status bar in the installed app */
        .pagehead {
            padding: calc(env(safe-area-inset-top, 0px) + 1.5rem) 1.5rem 0.5rem;
        }
        .pagehead h1 {
            font-size: 1.6em;
            line-height: 1.15;
        }
        /* room under the last card for the bar */
        .content {
            padding: 0.5rem 1.5rem calc(env(safe-area-inset-bottom, 0px) + 6rem);
        }
    }
</style>
