/**
 * Niral server — passkeys (WebAuthn), hand-rolled on node:crypto.
 *
 * Registration + authentication for the flow 99% of the web uses
 * ("none" attestation — the same thing GitHub/Google verify for consumer
 * passkeys). Supports ES256 (P-256, every platform authenticator) and
 * RS256 (older Windows Hello).
 *
 * Every check the spec requires for this flow is here and tested:
 *   clientDataJSON: type, challenge (timing-safe), origin
 *   authenticatorData: rpIdHash, user-present flag, user-verified (opt-in),
 *                      signature counter regression
 *   signature: over authData ‖ SHA-256(clientDataJSON), DER-encoded
 *
 * Zero dependencies: includes the CBOR subset decoder attestation objects
 * need (major types 0–5) and COSE→JWK key conversion.
 */

import { createHash, createVerify, timingSafeEqual, randomBytes } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(String(s), "base64url");

/* ── CBOR (decode subset: uint, negint, bytes, text, array, map) ── */

export function cborDecode(buf) {
  const [value, rest] = decodeItem(buf, 0);
  if (rest !== buf.length) {
    // attestation objects are a single item; trailing bytes = malformed
    throw new Error("CBOR: trailing bytes");
  }
  return value;
}

function decodeItem(buf, at) {
  if (at >= buf.length) throw new Error("CBOR: truncated");
  const initial = buf[at];
  const major = initial >> 5;
  const info = initial & 0x1f;

  let length;
  let i = at + 1;
  if (info < 24) length = info;
  else if (info === 24) { length = buf[i]; i += 1; }
  else if (info === 25) { length = buf.readUInt16BE(i); i += 2; }
  else if (info === 26) { length = buf.readUInt32BE(i); i += 4; }
  else if (info === 27) { length = Number(buf.readBigUInt64BE(i)); i += 8; }
  else throw new Error("CBOR: unsupported length encoding");

  switch (major) {
    case 0: return [length, i]; // unsigned int
    case 1: return [-1 - length, i]; // negative int
    case 2: { // byte string
      if (i + length > buf.length) throw new Error("CBOR: truncated bytes");
      return [buf.slice(i, i + length), i + length];
    }
    case 3: { // text string
      if (i + length > buf.length) throw new Error("CBOR: truncated text");
      return [buf.slice(i, i + length).toString("utf8"), i + length];
    }
    case 4: { // array
      const arr = [];
      let p = i;
      for (let n = 0; n < length; n++) {
        const [v, np] = decodeItem(buf, p);
        arr.push(v);
        p = np;
      }
      return [arr, p];
    }
    case 5: { // map
      const map = new Map();
      let p = i;
      for (let n = 0; n < length; n++) {
        const [k, kp] = decodeItem(buf, p);
        const [v, vp] = decodeItem(buf, kp);
        map.set(k, v);
        p = vp;
      }
      return [map, p];
    }
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

/* ── COSE key → JWK ── */

export function coseToJwk(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2) {
    // EC2 — P-256 (ES256)
    if (cose.get(-1) !== 1) throw new Error("passkey: unsupported EC curve");
    return {
      jwk: { kty: "EC", crv: "P-256", x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) },
      alg: "ES256",
    };
  }
  if (kty === 3) {
    // RSA (RS256)
    return { jwk: { kty: "RSA", n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) }, alg: "RS256" };
  }
  throw new Error(`passkey: unsupported key type ${kty} (alg ${alg})`);
}

/* ── authenticatorData ── */

export function parseAuthData(authData) {
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  const out = {
    rpIdHash,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    counter,
    credentialId: null,
    cosePublicKey: null,
  };
  if (flags & 0x40) {
    // attested credential data present
    const credIdLen = authData.readUInt16BE(53);
    out.credentialId = authData.slice(55, 55 + credIdLen);
    const [cose] = decodeItem(authData, 55 + credIdLen);
    out.cosePublicKey = cose;
  }
  return out;
}

/* ── options builders (JSON-safe, base64url binary fields) ── */

export function registrationOptions({ rpId, rpName, user, challenge, excludeCredentialIds = [] }) {
  return {
    challenge,
    rp: { id: rpId, name: rpName ?? rpId },
    user: { id: b64url(Buffer.from(String(user.id))), name: user.name, displayName: user.displayName ?? user.name },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, //   ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: excludeCredentialIds.map((id) => ({ type: "public-key", id })),
    attestation: "none",
    timeout: 60_000,
  };
}

export function authenticationOptions({ rpId, challenge, allowCredentialIds = [] }) {
  return {
    challenge,
    rpId,
    allowCredentials: allowCredentialIds.map((id) => ({ type: "public-key", id })),
    userVerification: "preferred",
    timeout: 60_000,
  };
}

/** A fresh challenge (store it in the SESSION, verify it on the way back). */
export function webauthnChallenge() {
  return randomBytes(32).toString("base64url");
}

/* ── verification ── */

function checkClientData(clientDataJSON, { type, challenge, origin }) {
  let cd;
  try {
    cd = JSON.parse(Buffer.from(clientDataJSON).toString("utf8"));
  } catch {
    throw new Error("passkey: malformed clientDataJSON");
  }
  if (cd.type !== type) throw new Error(`passkey: wrong ceremony type (${cd.type})`);
  const a = Buffer.from(String(cd.challenge));
  const b = Buffer.from(String(challenge));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("passkey: challenge mismatch");
  if (cd.origin !== origin) throw new Error(`passkey: origin mismatch (${cd.origin} != ${origin})`);
  return cd;
}

/**
 * Verify a registration (navigator.credentials.create result).
 * response: { clientDataJSON, attestationObject } as base64url strings.
 * → { credentialId, publicKeyJwk, alg, counter, userVerified }
 */
export function verifyRegistration({ response, challenge, origin, rpId, requireUserVerification = false }) {
  checkClientData(fromB64url(response.clientDataJSON), { type: "webauthn.create", challenge, origin });
  const att = cborDecode(fromB64url(response.attestationObject));
  const authData = parseAuthData(att.get("authData"));

  const wantRpIdHash = createHash("sha256").update(rpId).digest();
  if (!timingSafeEqual(authData.rpIdHash, wantRpIdHash)) throw new Error("passkey: rpId mismatch");
  if (!authData.userPresent) throw new Error("passkey: user-present flag missing");
  if (requireUserVerification && !authData.userVerified) throw new Error("passkey: user verification required");
  if (!authData.credentialId || !authData.cosePublicKey) throw new Error("passkey: no credential data");

  const { jwk, alg } = coseToJwk(authData.cosePublicKey);
  return {
    credentialId: b64url(authData.credentialId),
    publicKeyJwk: jwk,
    alg,
    counter: authData.counter,
    userVerified: authData.userVerified,
  };
}

/**
 * Verify an authentication (navigator.credentials.get result).
 * response: { clientDataJSON, authenticatorData, signature } base64url.
 * credential: { publicKeyJwk, alg, counter } from registration.
 * → { counter } (persist it — regression detection catches cloned keys)
 */
export function verifyAuthentication({
  response, challenge, origin, rpId, credential, requireUserVerification = false,
}) {
  checkClientData(fromB64url(response.clientDataJSON), { type: "webauthn.get", challenge, origin });
  const authData = fromB64url(response.authenticatorData);
  const parsed = parseAuthData(authData);

  const wantRpIdHash = createHash("sha256").update(rpId).digest();
  if (!timingSafeEqual(parsed.rpIdHash, wantRpIdHash)) throw new Error("passkey: rpId mismatch");
  if (!parsed.userPresent) throw new Error("passkey: user-present flag missing");
  if (requireUserVerification && !parsed.userVerified) throw new Error("passkey: user verification required");

  // cloned-authenticator detection: the counter must never move backwards
  if (credential.counter > 0 && parsed.counter > 0 && parsed.counter <= credential.counter) {
    throw new Error("passkey: signature counter regression — possible cloned credential");
  }

  const signedData = Buffer.concat([
    authData,
    createHash("sha256").update(fromB64url(response.clientDataJSON)).digest(),
  ]);
  const verify = createVerify("sha256");
  verify.update(signedData);
  const key = {
    key: credential.publicKeyJwk,
    format: "jwk",
    ...(credential.alg === "ES256" ? { dsaEncoding: "der" } : {}),
  };
  if (!verify.verify(key, fromB64url(response.signature))) {
    throw new Error("passkey: signature verification failed");
  }
  return { counter: parsed.counter, userVerified: parsed.userVerified };
}
