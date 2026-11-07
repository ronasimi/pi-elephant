import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ElephantClient, MAX_RESULT_BYTES, json } from "../src/client.ts";
import { binaryRunner, type Run } from "../src/process.ts";
const fixture = readFileSync(new URL("./fixtures/query.ndjson", import.meta.url), "utf8");
const make = (output = fixture) => {
  const calls: string[][] = [];
  const run: Run = async argv => { calls.push(argv); return argv[0] === "activate" ? "" : output; };
  return { client: new ElephantClient(run), calls };
};
const approve = { hasUI: true, confirm: async () => true };

test("real subprocess mock parses installed NDJSON shape, default provider and limits", async () => {
  const client = new ElephantClient(binaryRunner(fileURLToPath(new URL("./fixtures/elephant.mjs", import.meta.url))));
  const result = await client.query({ query: "example", limit: 1 });
  assert.deepEqual(result.providers, ["desktopapplications"]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].actions, ["start", "edit", "unpin"]);
  assert.ok(!json(result).includes("NEVER RETURN PREVIEW"));
  assert.ok(!json(result).includes("fuzzyinfo"));
});
test("CLI argv is exact, shell syntax remains data, sensitive providers only explicit", async () => {
  const { client, calls } = make("");
  await client.query({ query: '$(touch /tmp/nope) `id`', providers: ["clipboard", "runner"], exact: true, limit: 3 });
  assert.deepEqual(calls, [["query", "--json", 'clipboard,runner;$(touch /tmp/nope) `id`;3;true']]);
});
test("reject delimiters, controls, wildcard/all modes, invalid bounds before subprocess", async () => {
  const { client, calls } = make();
  for (const input of [ { query: "a;b" }, { query: "x\n" }, { query: "x\0" }, { query: "x", providers: [] },
    { query: "x", providers: ["*"] }, { query: "x", providers: ["files,runner"] }, { query: "x", limit: 0 },
    { query: "x", limit: 51 }, { query: "x", limit: 1.5 }, { query: "x".repeat(1025) } ]) {
    await assert.rejects(client.query(input));
  }
  assert.equal(calls.length, 0);
});
test("invalid protocol and unrequested providers fail closed; no refs committed", async () => {
  for (const output of ["not json", "[]", '{"item":null}', '{"unknown":1}', fixture.replaceAll("desktopapplications", "clipboard"), fixture.replace('"start"', '"bad;action"')]) {
    const { client } = make(output);
    await assert.rejects(client.query({ query: "x" }));
  }
});
test("empty CLI output produces empty results", async () => {
  const { client } = make("");
  assert.deepEqual(await client.query({ query: "x" }), { providers: ["desktopapplications"], items: [], truncated: false });
});
test("item and serialized byte bounds with explicit truncation, no private previews", async () => {
  const output = Array.from({ length: 70 }, (_, i) => json({ item: { provider: "files", identifier: String(i),
    text: "文".repeat(2000), subtext: "x".repeat(2000), actions: ["open"], preview: "SECRET" } })).join("\n");
  const { client } = make(output);
  const result = await client.query({ query: "x", providers: ["files"], limit: 50 });
  assert.equal(result.truncated, true);
  assert.ok(result.items.length > 0 && result.items.length < 50);
  assert.ok(Buffer.byteLength(json(result)) <= MAX_RESULT_BYTES);
  assert.equal(result.items[0].text.length, 512);
  assert.ok(!json(result).includes("SECRET"));
});
test("activation requires current reference, advertised action and UI", async () => {
  const { client, calls } = make();
  const { items } = await client.query({ query: "example" });
  await assert.rejects(client.activate({ reference: "invented", action: "start" }, approve), /Unknown/);
  await assert.rejects(client.activate({ reference: items[0].reference, action: "delete" }, approve), /advertised/);
  await assert.rejects(client.activate({ reference: items[0].reference, action: "start" }, { ...approve, hasUI: false }), /no UI/);
  assert.equal(calls.length, 1);
});
test("denial, aborted approval and invalid args never activate", async () => {
  const { client, calls } = make();
  const { items } = await client.query({ query: "example" });
  const input = { reference: items[0].reference, action: "start" };
  await assert.rejects(client.activate(input, { hasUI: true, confirm: async () => false }), /not approved/);
  await assert.rejects(client.activate({ ...input, arguments: "x;y" }, approve), /Invalid/);
  const controller = new AbortController();
  await assert.rejects(client.activate(input, { hasUI: true, confirm: async (_t, _m, options) => {
    controller.abort(); assert.equal(options.signal.aborted, true); return true;
  } }, controller.signal), /cancelled/);
  assert.equal(calls.length, 1);
});
test("approval shows exact payload, activation argv has five fields; reference is one-shot", async () => {
  const { client, calls } = make();
  const { items } = await client.query({ query: "example" });
  const input = { reference: items[0].reference, action: "start", arguments: "--example" };
  let message = "";
  const result = await client.activate(input, { hasUI: true, confirm: async (_title, text) => { message = text; return true; } });
  assert.ok(message.includes('"identifier":"example.desktop"'));
  assert.ok(message.includes('"arguments":"--example"'));
  assert.deepEqual(calls[1], ["activate", "desktopapplications;example.desktop;start;example;--example"]);
  assert.equal(result.status, "sent");
  await assert.rejects(client.activate(input, approve), /Unknown/);
});
test("expiry, clear and invalidation while confirming fail closed", async () => {
  let now = 0;
  const client = new ElephantClient(async () => fixture, () => now);
  let result = await client.query({ query: "example" });
  now = 300001;
  await assert.rejects(client.activate({ reference: result.items[0].reference, action: "start" }, approve), /expired/);
  result = await client.query({ query: "example" });
  await assert.rejects(client.activate({ reference: result.items[0].reference, action: "start" }, {
    hasUI: true, confirm: async () => { client.clear(); return true; },
  }), /invalidated/);
});
test("pre-aborted query cannot create references; escaped UI text cannot inject controls", async () => {
  const { client } = make();
  await assert.rejects(client.query({ query: "x" }, AbortSignal.abort()));
  assert.equal(json({ text: "\x1b[31m\u202eevil" }), '{"text":"\\u001b[31m\\u202eevil"}');
});
test("cache remains bounded to 200 references", async () => {
  const { client } = make();
  const first = (await client.query({ query: "x" })).items[0].reference;
  for (let i = 0; i < 101; i++) await client.query({ query: "x" });
  await assert.rejects(client.activate({ reference: first, action: "start" }, approve), /Unknown/);
});
test("returned structured data cannot mutate cached activation targets or actions", async () => {
  const { client, calls } = make();
  const { items } = await client.query({ query: "example" });
  items[0].identifier = "tampered.desktop";
  items[0].actions.push("delete");
  const input = { reference: items[0].reference, action: "delete" };
  await assert.rejects(client.activate(input, approve), /advertised/);
  await client.activate({ ...input, action: "start" }, approve);
  assert.equal(calls[1][1], "desktopapplications;example.desktop;start;example;");
});
test("reference expires during approval and approval exceptions never execute", async () => {
  let now = 0;
  const calls: string[][] = [];
  const client = new ElephantClient(async argv => { calls.push(argv); return fixture; }, () => now);
  const { items } = await client.query({ query: "example" });
  const input = { reference: items[0].reference, action: "start" };
  await assert.rejects(client.activate(input, { hasUI: true, confirm: async () => { throw new Error("UI failure"); } }), /UI failure/);
  await assert.rejects(client.activate(input, { hasUI: true, confirm: async () => { now = 300001; return true; } }), /expired/);
  assert.equal(calls.length, 1);
});
test("activation subprocess failure consumes reference and does not retry", async () => {
  let activations = 0;
  const client = new ElephantClient(async argv => {
    if (argv[0] === "activate") { activations++; throw new Error("transport failure"); }
    return fixture;
  });
  const { items } = await client.query({ query: "example" });
  const input = { reference: items[0].reference, action: "start" };
  await assert.rejects(client.activate(input, approve), /transport failure/);
  await assert.rejects(client.activate(input, approve), /Unknown/);
  assert.equal(activations, 1);
});
