/**
 * Niral cluster backplane — fan real-time messages across servers.
 *
 * A single Niral process delivers publish()/live() messages to its own
 * connected clients. Run the same app on TWO boxes behind a load balancer and
 * a message published on box A would never reach a client connected to box B.
 * This backplane closes that gap using **Postgres LISTEN/NOTIFY** — no Redis,
 * no extra dependency, just the pure-Node pg driver Niral already ships.
 *
 * How it works: every node LISTENs on one channel (`niral_live`). publish()
 * and client sends NOTIFY that channel; each node — including the origin —
 * delivers to its OWN local clients when the notification echoes back. So
 * behaviour is identical whether you run 1 server or 50.
 *
 * Enabled when  NIRAL_CLUSTER=1  AND  NIRAL_DATABASE_URL  is set. Off by
 * default — Niral stays a single fast process until you actually outgrow it.
 */

import { pgConnect } from "./postgres.js";

const PG_CHANNEL = "niral_live";
const MAX_PAYLOAD = 7500; // Postgres NOTIFY payload hard limit is 8000 bytes

/** True when the operator asked for clustering AND a database is configured. */
export function clusterEnabled() {
  const flag = String(process.env.NIRAL_CLUSTER ?? "").toLowerCase();
  return (flag === "1" || flag === "on" || flag === "true") && !!process.env.NIRAL_DATABASE_URL;
}

/**
 * Connect the backplane. `onRemote(env)` is called for every message that
 * should be delivered to this node's local clients (the node re-delivers its
 * own published messages via the LISTEN echo, keeping single/multi identical).
 */
export async function createPgBackplane({ url = process.env.NIRAL_DATABASE_URL, onRemote, log = console } = {}) {
  let listenConn = null;
  let sendConn = null;
  let closed = false;

  async function openListen() {
    const c = await pgConnect(url);
    c.onNotification((channel, payload) => {
      if (channel !== PG_CHANNEL || closed) return;
      let env;
      try { env = JSON.parse(payload); } catch { return; }
      try { onRemote?.(env); } catch {}
    });
    await c.query(`LISTEN ${PG_CHANNEL}`);
    listenConn = c;
  }
  async function openSend() { sendConn = await pgConnect(url); }

  await openListen();
  await openSend();

  // Self-heal: if either socket drops, reconnect. LISTEN must always be up or
  // this node goes deaf; the heartbeat re-establishes it.
  const heartbeat = setInterval(() => {
    if (closed) return;
    if (!listenConn || listenConn.closed) openListen().catch((e) => log.warn?.("niral cluster: LISTEN reconnect failed: " + e.message));
    if (!sendConn || sendConn.closed) openSend().catch(() => {});
  }, 3000);
  heartbeat.unref?.();

  return {
    /** Broadcast an envelope to every node (incl. this one, via the echo). */
    async publish(env) {
      if (closed) return onRemote?.(env);
      const payload = JSON.stringify(env);
      if (payload.length > MAX_PAYLOAD) {
        // Too big for NOTIFY — never drop it silently; deliver locally at least.
        log.warn?.("niral cluster: message exceeds NOTIFY limit, delivered to local clients only");
        return onRemote?.(env);
      }
      try {
        if (!sendConn || sendConn.closed) await openSend();
        await sendConn.query("SELECT pg_notify($1, $2)", [PG_CHANNEL, payload]);
      } catch (e) {
        // Backplane hiccup must never cost local delivery.
        onRemote?.(env);
        openSend().catch(() => {});
      }
    },
    async close() {
      closed = true;
      clearInterval(heartbeat);
      try { await listenConn?.end(); } catch {}
      try { await sendConn?.end(); } catch {}
    },
  };
}
