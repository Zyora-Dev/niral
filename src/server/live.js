/**
 * Niral server — live channels (real-time, framework-owned WebSockets).
 *
 * The framework already owns an RFC 6455 implementation for HMR — this
 * turns it into a user-facing primitive:
 *
 *   client (components):   const room = live("chat", (msg) => …)
 *                          room.send({ text: "hi" })
 *   server (<server> js):  publish("chat", { text: "deploy done" })
 *
 * Protocol (JSON text frames on /@niral/live):
 *   client → server: {type:"join"|"leave", channel} · {type:"send", channel, data}
 *   server → client: {type:"message", channel, data}
 * `send` fans out to every OTHER member of the channel; `publish` (server)
 * reaches every member. Works identically in dev and prod.
 *
 * CHANNEL AUTH: export `liveAuth({ channel, user, session })` from the
 * project's hooks.js — return false to deny a join (the client gets
 * {type:"denied", channel}). Without it, channels stay open (opt-in).
 */

import { acceptKey, encodeText, decodeFrame, encodePong, encodeClose } from "../dev/websocket.js";
import { readSession } from "./session.js";
import { loadHooks } from "./hooks.js";
import { randomBytes } from "node:crypto";

const CHANNEL_RE = /^[\w:-]{1,64}$/;
const MAX_CHANNELS_PER_CLIENT = 32;
const MAX_FRAME = 64 * 1024;

export function attachLive(server, { path = "/@niral/live", secret = null, projectDir = null, backplane = null } = {}) {
  const channels = new Map(); // name → Set<client>
  const clients = new Set(); // every connected socket — graceful shutdown closes them all

  function joinChannel(client, name) {
    if (!CHANNEL_RE.test(name) || client.channels.size >= MAX_CHANNELS_PER_CLIENT) return;
    let set = channels.get(name);
    if (!set) channels.set(name, (set = new Set()));
    set.add(client);
    client.channels.add(name);
  }

  function leaveChannel(client, name) {
    channels.get(name)?.delete(client);
    if (channels.get(name)?.size === 0) channels.delete(name);
    client.channels.delete(name);
  }

  function fanout(name, obj, exceptId = null) {
    const set = channels.get(name);
    if (!set) return;
    const frame = encodeText(JSON.stringify(obj));
    for (const c of set) {
      if (exceptId && c.id === exceptId) continue;
      try {
        c.socket.write(frame);
      } catch {
        dropClient(c);
      }
    }
  }

  // Deliver an envelope to THIS node's local clients. Same shape whether it
  // came from a local publish/send or arrived over the cluster backplane.
  function deliverLocal(env) {
    const msg = { type: "message", channel: env.c, data: env.d };
    if (env.k === "snd") fanout(env.c, msg, env.s); // exclude the original sender (matches on its node)
    else fanout(env.c, msg);
  }

  // One route for both modes: clustered → through the backplane (every node,
  // incl. this one, delivers on the echo); standalone → straight to locals.
  function route(env) {
    if (backplane) backplane.publish(env);
    else deliverLocal(env);
  }

  function dropClient(client) {
    for (const name of [...client.channels]) leaveChannel(client, name);
    clients.delete(client);
  }

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== path) return; // another attacher may own this path
    const key = req.headers["sec-websocket-key"];
    if ((req.headers.upgrade ?? "").toLowerCase() !== "websocket" || !key) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );

    const client = { socket, channels: new Set(), id: randomBytes(8).toString("hex") };
    clients.add(client);
    // session snapshot from the upgrade request — drives liveAuth decisions
    const session = secret ? readSession(req.headers.cookie, secret).data : {};
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_FRAME) {
        dropClient(client);
        socket.destroy();
        return;
      }
      let frame;
      while ((frame = decodeFrame(pending))) {
        pending = Buffer.from(frame.rest);
        if (frame.opcode === 0x8) {
          dropClient(client);
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodePong(frame.payload));
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          continue;
        }
        if (typeof msg?.channel !== "string") continue;
        if (msg.type === "join") {
          void (async () => {
            if (projectDir) {
              try {
                const hooks = await loadHooks(projectDir);
                if (typeof hooks?.liveAuth === "function") {
                  const ok = await hooks.liveAuth({ channel: msg.channel, user: session.user ?? null, session });
                  if (!ok) {
                    socket.write(encodeText(JSON.stringify({ type: "denied", channel: msg.channel })));
                    return;
                  }
                }
              } catch {
                return; // a broken guard NEVER fails open
              }
            }
            joinChannel(client, msg.channel);
          })();
        } else if (msg.type === "leave") leaveChannel(client, msg.channel);
        else if (msg.type === "send" && client.channels.has(msg.channel)) {
          route({ k: "snd", c: msg.channel, d: msg.data, s: client.id });
        }
      }
    });
    const drop = () => dropClient(client);
    socket.on("close", drop);
    socket.on("error", drop);
  });

  const hub = {
    /** Server-side publish — reaches EVERY member of the channel (all nodes). */
    publish(channel, data) {
      route({ k: "pub", c: channel, d: data });
    },
    /** Deliver a backplane envelope to this node's local clients. */
    deliverLocal,
    /** Attach (or replace) the cluster backplane once it has connected. */
    setBackplane(bp) {
      backplane = bp;
    },
    /** Members currently in a channel on THIS node (diagnostics). */
    size(channel) {
      return channels.get(channel)?.size ?? 0;
    },
    /** Graceful shutdown — every client gets a proper close frame (1001 going
     *  away) so browsers reconnect cleanly instead of seeing a dead socket. */
    closeAll() {
      for (const c of [...clients]) {
        try {
          c.socket.write(encodeClose(1001));
          c.socket.end();
        } catch {
          c.socket.destroy();
        }
      }
      clients.clear();
      channels.clear();
    },
  };

  // <server> blocks call the ambient `publish()` — routed here with no import
  globalThis.__niralPublish = (channel, data) => hub.publish(channel, data);

  return hub;
}
