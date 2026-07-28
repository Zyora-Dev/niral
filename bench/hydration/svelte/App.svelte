<script>
  let { items } = $props();
  let clicks = $state(0);
  $effect(() => {
    window.__hydrated = performance.now();
  });
</script>

<h1 onclick={() => clicks++}>Rows {items.length} · clicks {clicks}</h1>
<ul>
  {#each items as t (t.id)}
    <li class={t.done ? "done" : ""}>{t.id}: {t.text}</li>
  {/each}
</ul>
