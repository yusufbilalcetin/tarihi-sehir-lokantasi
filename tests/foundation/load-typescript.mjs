import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

/** Minimal in-memory CommonJS loader for dependency-free foundation tests. */
export function loadTypeScriptModule(relativePath, cache = new Map()) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;

  const output = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  cache.set(absolutePath, moduleRecord);

  const localRequire = (request) => {
    if (request.startsWith("node:")) return nativeRequire(request);
    if (request.startsWith(".")) {
      const resolved = path.resolve(path.dirname(absolutePath), request);
      const withExtension = path.extname(resolved) ? resolved : `${resolved}.ts`;
      return loadTypeScriptModule(path.relative(process.cwd(), withExtension), cache);
    }
    return nativeRequire(request);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}
