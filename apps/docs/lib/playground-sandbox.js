function playgroundSandbox() {
  function execute() {
    const send = self.postMessage.bind(self);
    const finish = self.close.bind(self);
    self.onmessage = async ({ data }) => {
      let length = 0;
      let lines = 0;
      const print = (...values) => {
        if (++lines > 100) throw new Error("Output exceeds 100 lines.");
        const text = values.map(value => typeof value === "string" ? value : JSON.stringify(value) ?? String(value)).join(" ");
        length += text.length;
        if (length > 16000) throw new Error("Output exceeds 16,000 characters.");
        send({ output: text });
      };
      const url = URL.createObjectURL(new Blob([data], { type: "text/javascript" }));
      try {
        const { createInstance } = await import(url);
        const instance = createInstance({}, { print });
        if (typeof instance.values.main === "function") {
          const result = await instance.values.main();
          if (result !== undefined) print(result);
        }
        send({ done: true });
      } catch (error) {
        send({ error: String(error?.message ?? error).slice(0, 16000) });
      } finally {
        URL.revokeObjectURL(url);
        finish();
      }
    };
  }
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.type !== "niralscript-run" || !event.ports[0]) return;
    const port = event.ports[0];
    if (typeof event.data.code !== "string" || event.data.code.length > 250000) { port.close(); return; }
    const url = URL.createObjectURL(new Blob([`(${execute.toString()})()`], { type: "text/javascript" }));
    let worker;
    let timer;
    function stop() { clearTimeout(timer); worker?.terminate(); URL.revokeObjectURL(url); port.close(); }
    try {
      worker = new Worker(url);
      timer = setTimeout(() => { port.postMessage({ error: "Execution stopped after 2 seconds." }); stop(); }, 2000);
      worker.onmessage = ({ data }) => {
        port.postMessage(data);
        if (data.done || data.error) stop();
      };
      worker.onerror = event => { event.preventDefault(); port.postMessage({ error: "Execution worker failed." }); stop(); };
      worker.postMessage(event.data.code);
    } catch (error) { port.postMessage({ error: String(error.message) }); stop(); }
  }, { once: true });
}
playgroundSandbox();