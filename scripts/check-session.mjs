import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
  const filePath = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (request) => {
    throw new Error(`Unexpected import ${request} while checking ${relativePath}.`);
  };
  new Function("require", "module", "exports", output)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const SECRET_A = "a".repeat(48);
const SECRET_B = "b".repeat(48);

process.env.STAFF_SESSION_SECRET = SECRET_A;
const { createSessionToken, readSessionRole, SESSION_TTL_SECONDS } =
  loadTypeScriptModule("lib/auth/session.ts");

const now = Date.now();
const staffToken = await createSessionToken("staff", now);
const adminToken = await createSessionToken("admin", now);

assert.equal(await readSessionRole(staffToken, now), "staff", "valid staff token should verify");
assert.equal(await readSessionRole(adminToken, now), "admin", "valid admin token should verify");

// Role escalation: swapping "staff" for "admin" invalidates the signature.
const escalated = staffToken.replace(/^staff\./, "admin.");
assert.equal(await readSessionRole(escalated, now), null, "role tampering must be rejected");

// Expiry extension is signed too.
const [role, expiresAt, signature] = staffToken.split(".");
const extended = `${role}.${Number(expiresAt) + 86_400_000}.${signature}`;
assert.equal(await readSessionRole(extended, now), null, "expiry tampering must be rejected");

// Expired but otherwise valid.
assert.equal(
  await readSessionRole(staffToken, now + (SESSION_TTL_SECONDS + 1) * 1_000),
  null,
  "expired token must be rejected",
);

// Forged with a different secret.
process.env.STAFF_SESSION_SECRET = SECRET_B;
const forged = await createSessionToken("admin", now);
process.env.STAFF_SESSION_SECRET = SECRET_A;
assert.equal(await readSessionRole(forged, now), null, "token from another secret must be rejected");

for (const junk of [undefined, null, "", "admin", "admin.999", "a.b.c", `${role}.${expiresAt}.!!!`]) {
  assert.equal(await readSessionRole(junk, now), null, `malformed token rejected: ${String(junk)}`);
}

// A missing or too-short secret must fail loudly rather than silently allow access.
process.env.STAFF_SESSION_SECRET = "short";
await assert.rejects(() => readSessionRole(staffToken, now), /STAFF_SESSION_SECRET/);
process.env.STAFF_SESSION_SECRET = SECRET_A;

console.log("session checks passed");
