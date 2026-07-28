<script>
  let { data } = $props();
  let clicks = $state(0);
</script>

<h1 onclick={() => clicks++}>Rows {data.items.length} · clicks {clicks}</h1>
<ul>
  {#each data.items as t (t.id)}
    <li class={t.done ? "done" : ""}>{t.id}: {t.text}</li>
  {/each}
</ul>
