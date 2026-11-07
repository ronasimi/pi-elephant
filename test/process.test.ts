import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaryRunner } from "../src/process.ts";
const run = binaryRunner(fileURLToPath(new URL("./fixtures/elephant.mjs", import.meta.url)));

test("mock binary: activation payload is only echoed, never executed", async () => {
  assert.deepEqual(JSON.parse(await run(["activate", "files;id;open;;"])), ["files;id;open;;"]);
});
test("mock binary: actual state output shape", async () => {
  assert.deepEqual(JSON.parse(await run(["state", "--json", "desktopapplications"])), { provider: "desktopapplications" });
});
test("missing binary and nonzero exit fail without leaking stderr", async () => {
  await assert.rejects(binaryRunner("/nonexistent/pi-elephant-test")(["query"]), /Cannot start/);
  await assert.rejects(run(["fail"]), error => error instanceof Error && !error.message.includes("PRIVATE STDERR") && error.message.includes("code 2"));
});
test("timeout and output byte limit terminate subprocess", async () => {
  await assert.rejects(run(["hang"], { timeoutMs: 100 }), /timed out/);
  await assert.rejects(run(["flood"], { maxBytes: 1024 }), /byte limit/);
});
test("pre-abort does not spawn; active cancellation terminates subprocess", async () => {
  await assert.rejects(run(["hang"], { signal: AbortSignal.abort() }), /cancelled/);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(run(["hang"], { signal: controller.signal }), /cancelled/); }
  finally { clearTimeout(timer); }
});
test("timeout escalates SIGKILL to TERM-resistant process group including child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-elephant-test-"));
  try {
    const file = join(dir, "pids.json");
    await assert.rejects(run(["tree", file], { timeoutMs: 500 }), /timed out/);
    const pids: number[] = JSON.parse(readFileSync(file, "utf8"));
    for (const pid of pids) {
      // A reparented child can briefly remain a zombie pending init's reap.
      let alive = false;
      try { alive = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0] !== "Z"; } catch { /* reaped */ }
      assert.equal(alive, false, `process ${pid} must not be running`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
