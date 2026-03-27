<script lang="ts">
  import type { TodoItem } from "../types";

  let { todos }: { todos: TodoItem[] } = $props();

  let expanded = $state(false);

  const completedCount = $derived(todos.filter(t => t.status === "completed").length);
  const totalCount = $derived(todos.length);
  const activeTask = $derived(todos.find(t => t.status === "in_progress"));
  const progress = $derived(totalCount > 0 ? (completedCount / totalCount) * 100 : 0);
</script>

{#if todos.length > 0}
  <div
    class="todo-panel"
    role="button"
    tabindex="0"
    onclick={() => (expanded = !expanded)}
    onkeydown={(e) => e.key === "Enter" && (expanded = !expanded)}
  >
    <div class="todo-header">
      <div class="progress-ring">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--ring-track, rgba(255,255,255,0.06))" stroke-width="2" />
          <circle
            cx="8" cy="8" r="6"
            fill="none"
            stroke="var(--color-success)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-dasharray={2 * Math.PI * 6}
            stroke-dashoffset={2 * Math.PI * 6 * (1 - progress / 100)}
            transform="rotate(-90 8 8)"
            class="progress-arc"
          />
        </svg>
      </div>
      <span class="todo-count">{completedCount}/{totalCount}</span>
      {#if activeTask && !expanded}
        <span class="todo-active">{activeTask.activeForm}</span>
      {/if}
      <span class="expand-chevron" class:open={!expanded}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg>
      </span>
    </div>

    {#if expanded}
      <div class="todo-list">
        {#each todos as todo}
          <div class="todo-item" class:completed={todo.status === "completed"} class:active={todo.status === "in_progress"}>
            <span class="todo-check">
              {#if todo.status === "completed"}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {:else if todo.status === "in_progress"}
                <span class="pulse-dot"></span>
              {:else}
                <span class="empty-dot"></span>
              {/if}
            </span>
            <span class="todo-text">
              {#if todo.status === "in_progress"}
                {todo.activeForm}
              {:else}
                {todo.content}
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .todo-panel {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 20px;
    cursor: pointer;
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .todo-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .progress-ring {
    flex-shrink: 0;
  }

  .progress-arc {
    transition: stroke-dashoffset 0.5s var(--ease-out-expo);
  }

  .todo-count {
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .todo-active {
    color: var(--text-secondary);
    font-size: 11px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
  }

  .expand-chevron {
    color: var(--text-tertiary);
    opacity: 0.3;
    transition: transform 0.2s var(--ease-out-expo);
    flex-shrink: 0;
    display: flex;
  }

  .expand-chevron.open {
    transform: rotate(180deg);
  }

  .todo-list {
    padding: 2px 0 6px 0;
    animation: fadeIn 0.2s var(--ease-out-expo);
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0 3px 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .todo-item.active {
    color: var(--text-secondary);
  }

  .todo-item.completed {
    opacity: 0.4;
  }

  .todo-item.completed .todo-text {
    text-decoration: line-through;
    text-decoration-color: var(--color-success-soft);
  }

  .todo-check {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .empty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .todo-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global([data-theme="light"]) .progress-ring circle {
    stroke: rgba(0, 0, 0, 0.08) !important;
  }
</style>
