/**
 * Niral runtime — live channels (client side).
 *
 *   const room = live("chat", (msg) => messages = [...messages, msg])
 *   room.send({ text: "hello" })
 *   room.close()
 *
 * One shared WebSocket to /@niral/live, auto-reconnect (channels re-join),
 * SSR-safe (no-op on the server). Messages from OTHER members and from
 * server-side publish() arrive in the callback; your own send() does not
 * echo back.
 */

let sock = null;
let ready = false;
let queue = [];
const handlers = new Map(); // channel → Set<cb>

function sendRaw(obj) {
  const s = JSON.stringify(obj);
  if (ready) sock.send(s);
  else queue.push(s);
}

function ensure() {
  if (sock || typeof window === "undefined") return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  sock = new WebSocket(`${proto}://${location.host}/@niral/live`);
  sock.onopen = () => {
    ready = true;
    for (const channel of handlers.keys()) sock.send(JSON.stringify({ type: "join", channel }));
    for (const s of queue.splice(0)) sock.send(s);
  };
  sock.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg?.type !== "message") return;
    for (const cb of handlers.get(msg.channel) ?? []) {
      try {
        cb(msg.data);
      } catch (err) {
        console.error("[niral] live handler error:", err);
      }
    }
  };
  sock.onclose = () => {
    ready = false;
    sock = null;
    if (handlers.size) setTimeout(ensure, 1000); // reconnect + re-join
  };
  sock.onerror = () => {};
}

/** Join a channel. Returns { send(data), close() }. SSR-safe no-op. */
export function live(channel, onMessage) {
  if (typeof window === "undefined") {
    return { send() {}, close() {} };
  }
  let set = handlers.get(channel);
  if (!set) handlers.set(channel, (set = new Set()));
  if (onMessage) set.add(onMessage);
  ensure();
  if (ready) sendRaw({ type: "join", channel });
  else queue.push(JSON.stringify({ type: "join", channel }));

  return {
    send(data) {
      sendRaw({ type: "send", channel, data });
    },
    close() {
      if (onMessage) set.delete(onMessage);
      if (set.size === 0) {
        handlers.delete(channel);
        sendRaw({ type: "leave", channel });
      }
    },
  };
}
