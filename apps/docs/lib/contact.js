import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const databasePath = fileURLToPath(new URL("../data/contact.db", import.meta.url));
const topics = new Set(["General question", "Technical support", "Partnership", "Feedback"]);

export async function sendContact(fields, filename = databasePath, { env = process.env, request = globalThis.fetch } = {}) {
  const saved = submitContact(fields, filename);
  if (!saved.success) return saved;
  const recipient = "developer@niral.site";
  try {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_EMAIL_API_TOKEN) throw new Error("Email is not configured");
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/email/sending/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { address: env.CLOUDFLARE_EMAIL_FROM || recipient, name: "Niral.js" },
        to: recipient,
        reply_to: fields.email.trim().toLowerCase(),
        subject: `Niral contact: ${fields.topic.trim()}`,
        text: `Name: ${fields.name.trim()}\nEmail: ${fields.email.trim()}\nTopic: ${fields.topic.trim()}\nReference: ${saved.reference}\n\n${fields.message.trim()}`
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error"
    });
    const payload = await response.json();
    const includesRecipient = addresses => Array.isArray(addresses) && addresses.includes(recipient);
    if (!response.ok || payload?.success !== true || includesRecipient(payload.result?.permanent_bounces)
      || !(includesRecipient(payload.result?.delivered) || includesRecipient(payload.result?.queued))) {
      throw new Error("Email was not accepted");
    }
    return saved;
  } catch {
    return { error: "Your message was saved, but the email notification could not be sent. Please email developer@niral.site directly.", reference: saved.reference };
  }
}

export function submitContact(fields, filename = databasePath) {
  const values = {};
  const limits = { name: 100, email: 254, topic: 40, message: 5000 };
  const errors = {};
  for (const [field, limit] of Object.entries(limits)) {
    const raw = typeof fields?.[field] === "string" ? fields[field].trim() : "";
    values[field] = raw.slice(0, limit);
    if (!raw || raw.length > limit) errors[field] = `Enter ${field === "email" ? "an email address" : "a " + field} within ${limit} characters.`;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.email)) errors.email = "Enter a valid email address.";
  if (!topics.has(values.topic)) errors.topic = "Choose a topic from the list.";
  if (values.message.length < 10) errors.message = "Please include at least 10 characters.";
  if (fields?.website) return { error: "Unable to accept this submission.", values };
  if (Object.keys(errors).length) return { error: "Please check the highlighted fields.", errors, values };

  let database;
  try {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    database = new DatabaseSync(filename);
    database.exec(`CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      topic TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS contact_messages_email_date ON contact_messages(email, created_at);`);
    const email = values.email.toLowerCase();
    const now = Date.now();
    const recent = database.prepare("SELECT COUNT(*) AS total, MAX(created_at) AS latest FROM contact_messages WHERE email = ? AND created_at > ?").get(email, now - 86400000);
    if (recent.total >= 5 || (recent.latest && now - recent.latest < 60000)) {
      return { error: "Please wait before sending another message. For urgent enquiries, email us directly.", values };
    }
    const reference = randomUUID();
    database.prepare("INSERT INTO contact_messages (id, name, email, topic, message, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(reference, values.name, email, values.topic, values.message, now);
    return { success: true, reference };
  } catch {
    return { error: "Your message could not be saved. Please try again or email developer@niral.site.", values };
  } finally {
    database?.close();
  }
}