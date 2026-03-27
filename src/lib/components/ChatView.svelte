<script lang="ts">
  import type { ChatMessage } from "../types";
  import MessageBubble from "./MessageBubble.svelte";
  import { tick } from "svelte";

  let {
    messages,
    isRunning,
    runStartTime,
    autoScrollEnabled = true,
    onFork,
    onCopy,
    onEditMessage,
  }: {
    messages: ChatMessage[];
    isRunning: boolean;
    runStartTime?: number;
    autoScrollEnabled?: boolean;
    onFork?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
    onEditMessage?: (messageId: string) => void;
  } = $props();

  // Elapsed timer
  let elapsed = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    if (isRunning && runStartTime) {
      elapsed = Math.floor((Date.now() - runStartTime) / 1000);
      timerInterval = setInterval(() => {
        elapsed = Math.floor((Date.now() - runStartTime) / 1000);
      }, 1000);
    } else {
      clearInterval(timerInterval);
    }
    return () => clearInterval(timerInterval);
  });

  function formatElapsed(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // Derive current activity from the last assistant message for the live indicator
  const currentActivity = $derived.by(() => {
    if (!isRunning || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return null;

    for (let i = last.content.length - 1; i >= 0; i--) {
      const block = last.content[i];
      if (block.type === "thinking" && block.text) {
        const text = block.text.trim();
        const lastNewline = text.lastIndexOf('\n', text.length - 1);
        const lastLine = lastNewline >= 0 ? text.slice(lastNewline + 1).trim() : text;
        const preview = lastLine.length > 120 ? '\u2026' + lastLine.slice(-120) : lastLine;
        return { kind: "thinking" as const, text: preview };
      }
      if (block.type === "tool_call" && !block.toolCall.isComplete) {
        return { kind: "tool" as const, text: block.toolCall.name };
      }
    }
    return { kind: "working" as const, text: "" };
  });

  // ── Three-body gravitational simulation ──
  let orbitCanvas: HTMLCanvasElement | undefined;
  let animFrame: number | undefined;

  interface Body {
    x: number; y: number;
    vx: number; vy: number;
    mass: number;
    radius: number;
    color: string;
    glow: string;
    trail: { x: number; y: number }[];
  }

  function initBodies(): Body[] {
    // Stable figure-8-ish initial conditions (centered in 56x36 canvas)
    const cx = 28, cy = 18;
    return [
      { x: cx + 5, y: cy, vx: 0, vy: -6, mass: 1.0, radius: 1.8,
        color: "rgba(167, 139, 250, 1)", glow: "rgba(167, 139, 250, 0.5)",
        trail: [] },
      { x: cx - 2.5, y: cy - 4, vx: 5.2, vy: 3, mass: 1.0, radius: 1.4,
        color: "rgba(130, 170, 255, 0.95)", glow: "rgba(130, 170, 255, 0.45)",
        trail: [] },
      { x: cx - 2.5, y: cy + 4, vx: -5.2, vy: 3, mass: 1.0, radius: 1.2,
        color: "rgba(200, 180, 255, 0.95)", glow: "rgba(200, 180, 255, 0.4)",
        trail: [] },
    ];
  }

  let bodies: Body[] = initBodies();

  function stepSimulation(bodies: Body[], dt: number, G: number) {
    const n = bodies.length;
    // Compute gravitational acceleration
    const ax = new Float64Array(n);
    const ay = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = bodies[j].x - bodies[i].x;
        const dy = bodies[j].y - bodies[i].y;
        const distSq = dx * dx + dy * dy + 4; // softening to prevent singularities
        const dist = Math.sqrt(distSq);
        const force = G / (distSq * dist);
        const fx = force * dx;
        const fy = force * dy;
        ax[i] += fx * bodies[j].mass;
        ay[i] += fy * bodies[j].mass;
        ax[j] -= fx * bodies[i].mass;
        ay[j] -= fy * bodies[i].mass;
      }
    }
    // Velocity Verlet integration
    const cx = 28, cy = 18;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.vx += ax[i] * dt;
      b.vy += ay[i] * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Soft boundary: apply restoring force if too far from center
      const bx = b.x - cx, by = b.y - cy;
      const bDist = Math.sqrt(bx * bx + by * by);
      if (bDist > 9) {
        const restoring = 0.6 * (bDist - 9);
        b.vx -= (bx / bDist) * restoring * dt;
        b.vy -= (by / bDist) * restoring * dt;
      }
      // Trail
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 30) b.trail.shift();
    }
  }

  function renderBodies(ctx: CanvasRenderingContext2D, bodies: Body[]) {
    ctx.clearRect(0, 0, 56, 36);
    // Draw trails
    for (const b of bodies) {
      if (b.trail.length < 2) continue;
      for (let i = 1; i < b.trail.length; i++) {
        const alpha = (i / b.trail.length) * 0.3;
        ctx.strokeStyle = b.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
        ctx.lineTo(b.trail[i].x, b.trail[i].y);
        ctx.stroke();
      }
    }
    // Draw bodies with glow
    for (const b of bodies) {
      ctx.save();
      ctx.shadowColor = b.glow;
      ctx.shadowBlur = 4;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function startOrbitAnimation() {
    if (animFrame) cancelAnimationFrame(animFrame);
    bodies = initBodies();
    const G = 80;
    const dt = 0.016;
    const substeps = 3;

    function loop() {
      if (!orbitCanvas) return;
      const ctx = orbitCanvas.getContext("2d");
      if (!ctx) return;
      for (let s = 0; s < substeps; s++) {
        stepSimulation(bodies, dt / substeps, G);
      }
      renderBodies(ctx, bodies);
      animFrame = requestAnimationFrame(loop);
    }
    animFrame = requestAnimationFrame(loop);
  }

  function stopOrbitAnimation() {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = undefined;
    }
  }

  $effect(() => {
    if (isRunning && orbitCanvas) {
      startOrbitAnimation();
    } else {
      stopOrbitAnimation();
    }
    return () => stopOrbitAnimation();
  });

  let scrollContainer: HTMLDivElement;
  let userScrolledUp = $state(false);
  let programmaticScroll = false;

  function isNearBottom(): boolean {
    if (!scrollContainer) return true;
    const threshold = 150;
    return (
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <
      threshold
    );
  }

  function handleScroll() {
    if (programmaticScroll) return;
    userScrolledUp = !isNearBottom();
  }

  function scrollToBottom() {
    if (!scrollContainer) return;
    programmaticScroll = true;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    // Reset flag after scroll completes
    requestAnimationFrame(() => {
      programmaticScroll = false;
    });
  }

  // Auto-scroll when messages update (content changes during streaming)
  // Track all relevant state changes — not just the last block of the last message
  $effect(() => {
    const len = messages.length;
    if (len > 0) {
      const last = messages[len - 1];
      const cLen = last.content.length;
      // Track total text + thinking length across ALL blocks (catches streaming deltas)
      let _textLen = 0;
      let _toolComplete = 0;
      for (let i = 0; i < cLen; i++) {
        const block = last.content[i];
        if (block.type === "text") _textLen += block.text.length;
        else if (block.type === "thinking") _textLen += block.text.length;
        else if (block.type === "tool_call") {
          if (block.toolCall.isComplete) _toolComplete++;
          // Track agent children changes too
          if (block.toolCall.children) _toolComplete += block.toolCall.children.length;
        }
      }
      void _textLen;
      void _toolComplete;
    }
    void isRunning;

    if (autoScrollEnabled && !userScrolledUp) {
      tick().then(scrollToBottom);
    }
  });
</script>

<div class="chat-view" bind:this={scrollContainer} onscroll={handleScroll}>
  {#if messages.length === 0}
    <div class="empty-state">
      <div class="empty-logo">clauke</div>
      <p class="empty-sub">send a prompt to get started</p>
    </div>
  {:else}
    <div class="messages">
      {#each messages as message, i (message.id)}
        {#if message.role === "system"}
          <div class="system-divider" id={message.id}>
            <div class="system-line"></div>
            <span class="system-label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              {message.content[0]?.type === "text" ? (message.content[0] as any).text : "system"}
            </span>
            <div class="system-line"></div>
          </div>
        {:else}
          <MessageBubble {message} {onFork} {onCopy} onEdit={onEditMessage} isStreaming={isRunning && i === messages.length - 1 && message.role === 'assistant'} />
        {/if}
      {/each}

      {#if isRunning}
        <div class="thinking-indicator">
          <canvas
            class="think-orbit-canvas"
            width="56"
            height="36"
            bind:this={orbitCanvas}
          ></canvas>
          <span class="think-text">
            {#if currentActivity?.kind === "thinking"}
              {currentActivity.text}
            {:else if currentActivity?.kind === "tool"}
              running {currentActivity.text}
            {:else}
              thinking
            {/if}
          </span>
          <span class="think-timer">{formatElapsed(elapsed)}</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if userScrolledUp}
    <button class="scroll-bottom" onclick={() => { userScrolledUp = false; scrollToBottom(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .chat-view {
    height: 100%;
    overflow-y: auto;
    padding: 24px 20px;
    position: relative;
  }

  .scroll-bottom {
    position: sticky;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    margin: 0 auto;
    animation: fadeIn 0.2s ease;
  }
  .scroll-bottom:hover {
    background: var(--bg-glass-hover);
    color: var(--text);
    border-color: var(--border-focus);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 10px;
  }

  .empty-logo {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 400;
    letter-spacing: 2px;
    color: var(--text-tertiary);
    animation: fadeIn 0.6s var(--ease-out-expo);
  }

  .empty-sub {
    font-size: 13px;
    font-weight: 350;
    color: var(--text-tertiary);
    letter-spacing: 0.3px;
    animation: fadeIn 0.6s var(--ease-out-expo) 0.1s both;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 860px;
    margin: 0 auto;
  }

  /* ── Thinking indicator: three-body orbit + live text + timer ── */
  .thinking-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 2px;
    animation: thinkFadeIn 0.4s var(--ease-out-expo);
  }

  @keyframes thinkFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .think-orbit-canvas {
    width: 56px;
    height: 36px;
    flex-shrink: 0;
  }

  .think-text {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 400;
    color: var(--text-tertiary);
    opacity: 0.65;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    line-height: 1.4;
  }

  .think-timer {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 450;
    color: var(--text-tertiary);
    letter-spacing: 0.5px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    margin-left: auto;
  }

  /* ── System divider (compact notification, etc.) ── */
  .system-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    animation: slideUp 0.35s var(--ease-out-expo);
  }

  .system-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--border-subtle), transparent);
  }

  .system-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 450;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.5;
    white-space: nowrap;
  }

  .system-label svg {
    opacity: 0.6;
  }

  /* Search highlight flash */
  :global(.search-highlight) {
    animation: searchFlash 1.5s ease-out;
  }

  @keyframes searchFlash {
    0% { background: rgba(167, 139, 250, 0.15); }
    100% { background: transparent; }
  }
</style>
