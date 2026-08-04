<script>
  let { data } = $props();
</script>

<h1>SHELL READY</h1>
{#await data.slow}
  <p>PENDING</p>
{:then total}
  <p>STREAMED-OK total={total}</p>
{/await}
