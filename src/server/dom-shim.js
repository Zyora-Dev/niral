/**
 * Niral server — DOM shim.
 *
 * A document just big enough to run compiled Niral components on the
 * server. The SAME client module renders here: `renderComponent()` installs
 * this as `globalThis.document`, mounts synchronously, serializes, restores.
 * Event listeners are no-ops; effects run once to produce initial values.
 */

import { VOID_ELEMENTS } from "../compiler/ast.js";

class NNode {
  constructor() {
    this.parentNode = null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.childNodes;
    const i = sib.indexOf(this);
    return i === -1 ? null : sib[i + 1] ?? null;
  }
  remove() {
    if (!this.parentNode) return;
    const sib = this.parentNode.childNodes;
    const i = sib.indexOf(this);
    if (i !== -1) sib.splice(i, 1);
    this.parentNode = null;
  }
}

class NText extends NNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
  /** Browser Text API — hydration splits merged SSR text nodes. */
  splitText(offset) {
    const rest = new NText(this.data.slice(offset));
    this.data = this.data.slice(0, offset);
    if (this.parentNode) this.parentNode.insertBefore(rest, this.nextSibling);
    return rest;
  }
}

class NComment extends NNode {
  constructor(data) {
    super();
    this.nodeType = 8;
    this.data = String(data);
  }
}

class NElement extends NNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toLowerCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.value = "";
    this.checked = false;
  }
  get type() {
    return this.attributes.get("type") ?? "";
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    node.remove();
    node.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  replaceChildren() {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
  }
  addEventListener(type, fn) {
    // no events fire during SSR — recorded so runtime tests can simulate input
    (this._listeners ??= {})[type] = fn;
  }
  removeEventListener() {}
}

/** A minimal `document` for SSR. */
export function createDocument() {
  return {
    createElement: (tag) => new NElement(tag),
    createTextNode: (data) => new NText(data),
    createComment: (data) => new NComment(data),
    createRawNode: (html) => {
      const t = new NText(html);
      t.raw = true; // serialized WITHOUT escaping — {@html} only
      return t;
    },
  };
}

/* ── serialization ── */

const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");
const RAW_TEXT = new Set(["script", "style"]);

export function serialize(node) {
  // empty dynamic text would vanish in HTML — emit a claimable placeholder
  if (node.nodeType === 3) {
    if (node.raw) return node.data; // {@html} — intentionally unescaped
    return node.data === "" ? "<!--n:t-->" : escText(node.data);
  }
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  const tag = node.tagName;
  let out = `<${tag}`;
  for (const [name, value] of node.attributes) {
    out += value === "" ? ` ${name}` : ` ${name}="${escAttr(value)}"`;
  }
  // reflect live input state set by bindValue during SSR
  if (tag === "input") {
    if (node.value && !node.attributes.has("value")) out += ` value="${escAttr(node.value)}"`;
    if (node.checked && !node.attributes.has("checked")) out += " checked";
  }
  out += ">";
  if (VOID_ELEMENTS.has(tag)) return out;
  for (const c of node.childNodes) {
    out += RAW_TEXT.has(tag) && c.nodeType === 3 ? c.data : serialize(c);
  }
  return out + `</${tag}>`;
}

export function serializeChildren(node) {
  return node.childNodes.map(serialize).join("");
}
