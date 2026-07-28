/**
 * Niral server — mailer (SMTP client, hand-rolled on node:net + node:tls).
 *
 * Works with every SMTP provider (SES, Mailgun, Postmark, Resend, Gmail,
 * your own postfix): you bring credentials, Niral speaks the protocol.
 *
 *   NIRAL_SMTP_URL=smtp://user:pass@smtp.example.com:587    (STARTTLS)
 *   NIRAL_SMTP_URL=smtps://user:pass@smtp.example.com:465   (implicit TLS)
 *
 *   await sendMail({ to, subject, text, html? })
 *
 * Supports: EHLO, STARTTLS upgrade, AUTH PLAIN/LOGIN, dot-stuffing,
 * multipart/alternative (text + html). Server blocks get an ambient
 * `mail()` that reads NIRAL_SMTP_URL / NIRAL_MAIL_FROM.
 */

import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { randomBytes } from "node:crypto";

const CRLF = "\r\n";

export function parseSmtpUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") {
    throw new Error(`mailer: unsupported protocol ${u.protocol} (use smtp:// or smtps://)`);
  }
  return {
    host: u.hostname,
    port: Number(u.port) || (u.protocol === "smtps:" ? 465 : 587),
    secure: u.protocol === "smtps:",
    user: decodeURIComponent(u.username ?? ""),
    pass: decodeURIComponent(u.password ?? ""),
  };
}

/** Build a MIME message (text + optional html as multipart/alternative). */
export function buildMime({ from, to, subject, text, html, headers = {} }) {
  const now = new Date().toUTCString();
  const id = `<${randomBytes(12).toString("hex")}@niral>`;
  const encSubject = /[^\x20-\x7e]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`
    : subject;
  const top = [
    `From: ${from}`,
    `To: ${Array.isArray(to) ? to.join(", ") : to}`,
    `Subject: ${encSubject}`,
    `Date: ${now}`,
    `Message-ID: ${id}`,
    `MIME-Version: 1.0`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ];
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, `$1${CRLF}`);

  if (!html) {
    return [
      ...top,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      b64(text ?? ""),
    ].join(CRLF);
  }
  const boundary = `niral-${randomBytes(8).toString("hex")}`;
  return [
    ...top,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    b64(text ?? ""),
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    b64(html),
    `--${boundary}--`,
  ].join(CRLF);
}

/** One SMTP conversation. Returns after the server accepts the message. */
export async function sendMail({ to, from, subject, text, html, headers, smtpUrl, timeout = 15_000 }) {
  const url = smtpUrl ?? process.env.NIRAL_SMTP_URL;
  if (!url) throw new Error("mailer: set NIRAL_SMTP_URL (smtp://user:pass@host:port)");
  const sender = from ?? process.env.NIRAL_MAIL_FROM;
  if (!sender) throw new Error("mailer: set NIRAL_MAIL_FROM or pass `from`");
  if (!to) throw new Error("mailer: `to` is required");
  const cfg = parseSmtpUrl(url);
  const recipients = (Array.isArray(to) ? to : [to]).map(String);
  for (const r of recipients) {
    if (/[\r\n]/.test(r) || /[\r\n]/.test(sender)) throw new Error("mailer: header injection rejected");
  }

  let socket = cfg.secure
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : netConnect({ host: cfg.host, port: cfg.port });

  let buf = "";
  let waiter = null;
  const attach = (s) => {
    s.setEncoding("utf8");
    s.on("data", (chunk) => {
      buf += chunk;
      pump();
    });
    s.on("error", (e) => waiter?.reject(e));
  };
  const pump = () => {
    // a reply is complete when the LAST line is "NNN " (space, not dash)
    const lines = buf.split(CRLF).filter(Boolean);
    const last = lines[lines.length - 1];
    if (last && /^\d{3} /.test(last)) {
      const reply = buf;
      buf = "";
      waiter?.resolve(reply);
      waiter = null;
    }
  };
  const read = () =>
    new Promise((resolve, reject) => {
      waiter = { resolve, reject };
      pump();
      setTimeout(() => reject(new Error("mailer: SMTP timeout")), timeout).unref?.();
    });
  const send = (line) => socket.write(line + CRLF);
  const expect = (reply, codes, step) => {
    const code = Number(reply.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`mailer: ${step} failed — ${reply.trim().split(CRLF).pop()}`);
    return reply;
  };

  attach(socket);
  try {
    expect(await read(), [220], "greeting");
    send("EHLO niral.local");
    let ehlo = expect(await read(), [250], "EHLO");

    if (!cfg.secure && /STARTTLS/i.test(ehlo)) {
      send("STARTTLS");
      expect(await read(), [220], "STARTTLS");
      socket = tlsConnect({ socket, servername: cfg.host });
      attach(socket);
      send("EHLO niral.local");
      ehlo = expect(await read(), [250], "EHLO (tls)");
    }

    if (cfg.user) {
      if (/AUTH[ =][^\r\n]*PLAIN/i.test(ehlo)) {
        send("AUTH PLAIN " + Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString("base64"));
        expect(await read(), [235], "AUTH PLAIN");
      } else {
        send("AUTH LOGIN");
        expect(await read(), [334], "AUTH LOGIN");
        send(Buffer.from(cfg.user).toString("base64"));
        expect(await read(), [334], "AUTH LOGIN user");
        send(Buffer.from(cfg.pass).toString("base64"));
        expect(await read(), [235], "AUTH LOGIN pass");
      }
    }

    send(`MAIL FROM:<${sender.match(/<([^>]+)>/)?.[1] ?? sender}>`);
    expect(await read(), [250], "MAIL FROM");
    for (const r of recipients) {
      send(`RCPT TO:<${r.match(/<([^>]+)>/)?.[1] ?? r}>`);
      expect(await read(), [250, 251], "RCPT TO");
    }
    send("DATA");
    expect(await read(), [354], "DATA");
    const mime = buildMime({ from: sender, to, subject, text, html, headers });
    socket.write(mime.replace(/\r\n\./g, "\r\n..") + CRLF + "." + CRLF); // dot-stuffing
    expect(await read(), [250], "message");
    send("QUIT");
    return { accepted: recipients };
  } finally {
    socket.destroy();
  }
}
