export function createPlayground(update) {
  let dispose = () => {};
  let generation = 0;
  function stop() {
    generation++;
    dispose();
    dispose = () => {};
  }
  function run(source) {
    stop();
    const current = generation;
    let compiler;
    let frame;
    let port;
    let timer;
    let text = "";
    dispose = () => { clearTimeout(timer); compiler?.terminate(); port?.close(); frame?.remove(); };
    const finish = (error) => {
      if (current !== generation) return;
      stop();
      update({ busy: false, status: error ? "Error" : "Completed", output: error ? `${text}${text ? "\n" : ""}${error}` : text || "Completed." });
    };
    const arm = (duration, message) => { clearTimeout(timer); timer = setTimeout(() => finish(message), duration); };
    update({ busy: true, status: "Compiling", output: "", code: "" });
    try {
      compiler = new Worker("/playground/compile-worker.js", { type: "module" });
      arm(10000, "Compiler failed to load. Reload and try again.");
      compiler.onerror = event => { event.preventDefault(); finish("Compiler worker failed to load."); };
      compiler.onmessage = ({ data }) => {
        if (current !== generation) return;
        if (data.ready) { arm(2000, "Compilation stopped after 2 seconds."); compiler.postMessage(source); return; }
        if (data.error) { finish(data.error); return; }
        compiler.terminate();
        update({ code: data.code, status: "Running" });
        frame = document.createElement("iframe");
        frame.hidden = true;
        frame.title = "NiralScript execution sandbox";
        frame.sandbox = "allow-scripts";
        frame.src = "/playground/sandbox";
        arm(10000, "Execution sandbox failed to load.");
        frame.onload = () => {
          if (current !== generation) return;
          const channel = new MessageChannel();
          port = channel.port1;
          port.onmessage = ({ data }) => {
            if (current !== generation) return;
            if (typeof data.output === "string") {
              text += `${text ? "\n" : ""}${data.output}`;
              if (text.length > 17000) { finish("Output exceeds the playground limit."); return; }
              update({ output: text });
            }
            if (data.error || data.done) finish(data.error);
          };
          arm(3000, "Execution stopped after 2 seconds.");
          frame.contentWindow.postMessage({ type: "niralscript-run", code: data.code }, "*", [channel.port2]);
        };
        document.body.append(frame);
      };
    } catch (error) { finish(error.message); }
  }
  return { run, stop };
}