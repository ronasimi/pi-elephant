import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Use actual managed Pi types and its real jiti loader, not an independently installed host.
const install = join(homedir(), ".pi/agent/install");
const modules = process.env.PI_NODE_MODULES ?? join(install, "releases", readFileSync(join(install, "current-version"), "utf8").trim(), "node_modules");
const host = join(modules, "@earendil-works/pi-coding-agent");
const config = resolve(".tsconfig.installed.json");
writeFileSync(config, JSON.stringify({ compilerOptions: {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
  noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
  paths: { "@earendil-works/pi-coding-agent": [join(host, "dist/index.d.ts")], "typebox": [join(modules, "typebox/build/index.d.mts")] },
}, include: ["src/**/*.ts", "test/**/*.ts"] }));
try {
  const check = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", config], { stdio: "inherit" });
  assert.equal(check.status, 0, "TypeScript compatibility check failed");
} finally { unlinkSync(config); }
const { loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")).href);
const loaded = await loadExtensions([resolve("src/index.ts")], process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const tools = [...loaded.extensions[0].tools.values()].map(t => t.definition ?? t);
assert.deepEqual(tools.map(t => t.name), ["elephant_query", "elephant_activate"]);
for (const tool of tools) assert.ok(tool.outputSchema, `${tool.name}: structured output schema`);
console.log(`Installed Pi ${JSON.parse(readFileSync(join(host, "package.json"))).version}: strict typecheck and real extension loader PASS (2 tools, no tool execution or model calls)`);
