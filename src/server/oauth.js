/**
 * Niral server — OAuth 2.0 / OIDC sign-in (Google, GitHub, Microsoft, LinkedIn).
 *
 * You bring the app credentials, Niral runs the whole flow:
 *
 *   NIRAL_OAUTH_GOOGLE_ID / NIRAL_OAUTH_GOOGLE_SECRET
 *   NIRAL_OAUTH_GITHUB_ID / NIRAL_OAUTH_GITHUB_SECRET
 *   NIRAL_OAUTH_MICROSOFT_ID / NIRAL_OAUTH_MICROSOFT_SECRET
 *   NIRAL_OAUTH_LINKEDIN_ID / NIRAL_OAUTH_LINKEDIN_SECRET
 *
 * Authorization-code flow with PKCE (S256) + `state` on every provider,
 * profiles normalized to ONE shape: { provider, id, email, name, picture }.
 * Global fetch (Node stdlib) — still zero dependencies.
 */

import { randomBytes, createHash } from "node:crypto";

export const OAUTH_PROVIDERS = {
  google: {
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    profile: (u) => ({ id: u.sub, email: u.email ?? null, name: u.name ?? u.email, picture: u.picture ?? null }),
  },
  github: {
    name: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    emailUrl: "https://api.github.com/user/emails", // primary email may be private
    scope: "read:user user:email",
    profile: (u) => ({ id: String(u.id), email: u.email ?? null, name: u.name ?? u.login, picture: u.avatar_url ?? null }),
  },
  microsoft: {
    name: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid email profile",
    profile: (u) => ({ id: u.sub, email: u.email ?? null, name: u.name ?? u.email, picture: u.picture ?? null }),
  },
  linkedin: {
    name: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    userUrl: "https://api.linkedin.com/v2/userinfo",
    scope: "openid email profile",
    profile: (u) => ({ id: u.sub, email: u.email ?? null, name: u.name ?? u.email, picture: u.picture ?? null }),
  },
};

/** Providers with credentials configured (drives the login-page buttons). */
export function configuredProviders(env = process.env) {
  return Object.keys(OAUTH_PROVIDERS).filter(
    (p) => env[`NIRAL_OAUTH_${p.toUpperCase()}_ID`] && env[`NIRAL_OAUTH_${p.toUpperCase()}_SECRET`]
  );
}

function credentials(provider, env = process.env) {
  const id = env[`NIRAL_OAUTH_${provider.toUpperCase()}_ID`];
  const secret = env[`NIRAL_OAUTH_${provider.toUpperCase()}_SECRET`];
  if (!id || !secret) {
    throw new Error(`oauth: set NIRAL_OAUTH_${provider.toUpperCase()}_ID and _SECRET`);
  }
  return { id, secret };
}

/**
 * Step 1 — build the redirect. Persist `state` + `verifier` in the SESSION
 * and send the browser to `url`.
 */
export function oauthStart(provider, { redirectUri, env } = {}) {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`oauth: unknown provider '${provider}'`);
  const { id } = credentials(provider, env);
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(def.authUrl);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.href, state, verifier };
}

/**
 * Step 2 — the callback. Verifies state, exchanges the code (PKCE), fetches
 * the profile. → { provider, id, email, name, picture }
 */
export async function oauthCallback(
  provider,
  { code, state },
  { state: savedState, verifier, redirectUri, env, endpoints } = {}
) {
  const def = { ...OAUTH_PROVIDERS[provider], ...(endpoints ?? {}) };
  if (!def.authUrl) throw new Error(`oauth: unknown provider '${provider}'`);
  if (!savedState || String(state) !== String(savedState)) {
    throw new Error("oauth: state mismatch — start the sign-in again");
  }
  const { id, secret } = credentials(provider, env);

  const tokenRes = await fetch(def.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`oauth: token exchange failed — ${token.error_description ?? token.error ?? tokenRes.status}`);
  }

  const userRes = await fetch(def.userUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "niral" },
  });
  if (!userRes.ok) throw new Error(`oauth: profile fetch failed (${userRes.status})`);
  const raw = await userRes.json();
  const profile = def.profile(raw);

  // GitHub keeps primary emails private — one more call fills it in
  if (!profile.email && def.emailUrl) {
    const emails = await (
      await fetch(def.emailUrl, {
        headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "niral" },
      })
    ).json().catch(() => []);
    const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) ?? emails[0] : null;
    if (primary?.email) profile.email = primary.email;
  }

  return { provider, ...profile };
}
