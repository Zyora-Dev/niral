/**
 * Niral dev — WebSocket server (RFC 6455), hand-rolled on node:http upgrade.
 *
 * Only what HMR needs: handshake, server→client text frames, and enough
 * client-frame parsing to answer pings and notice closes. Zero dependencies.
 */

import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Sec-WebSocket-Accept for a client key. */
export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/** Encode a server→client text frame (FIN=1, opcode=1, unmasked). */
export function encodeText(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Decode one client frame from `buf` (client frames are masked).
 * Returns { opcode, payload, rest } or null if incomplete.
 */
export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.subarray(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, rest: buf.subarray(off + len) };
}

/** Encode a pong frame echoing a ping payload. */
export function encodePong(payload) {
  return Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
}

/** Encode a close frame (FIN + opcode 0x8) — 1001 = "going away" (shutdown/deploy). */
export function encodeClose(code = 1001) {
  return Buffer.from([0x88, 0x02, code >> 8, code & 0xff]);
}

/**
 * Attach a WebSocket endpoint to an http server.
 * Returns { clients: Set, broadcast(obj) }.
 */
export function attachWebSocket(server, path = "/@niral/hmr") {
  const clients = new Set();

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== path) return; // another attacher may own this path
    if ((req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );

    const client = {
      send(obj) {
        try {
          socket.write(encodeText(JSON.stringify(obj)));
        } catch {
          clients.delete(client);
        }
      },
    };
    clients.add(client);

    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let frame;
      while ((frame = decodeFrame(pending))) {
        pending = Buffer.from(frame.rest);
        if (frame.opcode === 0x8) {
          // close
          clients.delete(client);
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) socket.write(encodePong(frame.payload)); // ping → pong
        // text frames from the client are ignored (HMR is server → client)
      }
    });
    const drop = () => clients.delete(client);
    socket.on("close", drop);
    socket.on("error", drop);
  });

  return {
    clients,
    broadcast(obj) {
      for (const c of clients) c.send(obj);
    },
  };
}
