/**
 * Niral (நிரல்) — the zero-dependency full-stack web framework by ZyoraLabs.
 * Public API (M1: parse · M2: compileClient · M4: router + SSR).
 */

export { parse } from "./compiler/parser.js";
export { compileClient, collectServerExports, parseComponent } from "./compiler/codegen.js";
export { stripTypes } from "./compiler/typescript.js";
export { parseJsx } from "./compiler/jsx.js";
export { collectDeclarations, rewriteScript, rewriteExpr } from "./compiler/rewrite.js";
export { NiralError, codeFrame, offsetToLineCol } from "./compiler/errors.js";
export { scopeStyle, styleScopeId, componentCss, componentScope } from "./compiler/style.js";
export * as ast from "./compiler/ast.js";
export { scanRoutes, matchRoute } from "./server/router.js";
export { renderComponent, renderFile, loadComponent } from "./server/render.js";
export { createDocument, serialize, serializeChildren } from "./server/dom-shim.js";
export { loadServerModule, executeRpc, callServerFn } from "./server/rpc.js";
export { signSession, verifySession, readSession, sessionCookie, newSecret } from "./server/session.js";
export { build } from "./build/build.js";
export { exportStatic } from "./build/export.js";
export { hashPassword, verifyPassword, totpSecret, totpUri, totpVerify, loginUser, logoutUser, satisfiesAuth } from "./server/auth.js";
export {
  registrationOptions, authenticationOptions, webauthnChallenge,
  verifyRegistration, verifyAuthentication,
} from "./server/webauthn.js";
export { sendMail, buildMime, parseSmtpUrl } from "./server/mail.js";
export { OAUTH_PROVIDERS, configuredProviders, oauthStart, oauthCallback } from "./server/oauth.js";
export { v, validate, withSchema, ValidationError } from "./shared/validate.js";
export { parseCron, nextCronTime, createJobRunner } from "./server/jobs.js";
export { parseMultipart, multipartBoundary } from "./server/uploads.js";
export { createProdServer } from "./server/prod.js";
export {
  remoteSnapshotConfig, encryptSnapshot, decryptSnapshot, signS3Request,
  listRemoteSnapshots, pushRemoteSnapshot, snapshotRemote,
  pullRemoteSnapshot, restoreRemoteSnapshot,
} from "./server/remote-snapshot.js";
