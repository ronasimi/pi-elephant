import { randomUUID } from "node:crypto";
import type { Run } from "./process.ts";

export const DEFAULT_PROVIDERS = ["desktopapplications"];
export const MAX_RESULT_BYTES = 32768;
const TTL = 5 * 60 * 1000;
export interface QueryInput { query: string; providers?: string[]; limit?: number; exact?: boolean }
export type Item = {
  reference: string; provider: string; identifier: string; text: string; subtext: string;
  actions: string[]; state: string[];
}
export type QueryResult = { providers: string[]; items: Item[]; truncated: boolean }
export interface ActivationInput { reference: string; action: string; arguments?: string }
export interface Approval {
  hasUI: boolean;
  confirm: (title: string, message: string, options: { signal: AbortSignal; timeout: number }) => Promise<boolean>;
}
interface Cached { item: Item; query: string; expires: number }

function field(value: unknown, name: string, max: number, empty = true): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value) || /[;\x00-\x1f\x7f-\x9f]/u.test(value)) {
    throw new Error(`Invalid ${name}: bounded text without semicolons or control characters required`);
  }
  return value;
}
function provider(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]*(?::[a-zA-Z0-9_-]+)?$/.test(value) || value.length > 96) {
    throw new Error("Select explicit provider names, not wildcards or delimiters");
  }
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw new Error("Invalid Elephant string array");
  return value as string[];
}
// JSON escaping prevents terminal controls and bidirectional text from disguising approval fields.
export function json(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export class ElephantClient {
  private cache = new Map<string, Cached>();
  private run: Run;
  private now: () => number;
  constructor(run: Run, now = Date.now) { this.run = run; this.now = now; }
  clear() { this.cache.clear(); }
  private prune() {
    for (const [key, value] of this.cache) if (value.expires <= this.now()) this.cache.delete(key);
  }
  async query(input: QueryInput, signal?: AbortSignal): Promise<QueryResult> {
    const query = field(input.query, "query", 1024);
    const selected = input.providers ?? DEFAULT_PROVIDERS;
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 8) throw new Error("Select 1–8 providers");
    const providers = [...new Set(selected.map(provider))];
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be 1–50");
    if (input.exact !== undefined && typeof input.exact !== "boolean") throw new Error("exact must be boolean");
    const output = await this.run(["query", "--json", `${providers.join(",")};${query};${limit};${input.exact ?? false}`], { signal });
    signal?.throwIfAborted();
    const result: QueryResult = { providers, items: [], truncated: false };
    const pending: Cached[] = [];
    for (const line of output.split("\n").filter(l => l.trim())) {
      let response: unknown;
      try { response = JSON.parse(line); } catch { throw new Error("Invalid Elephant JSON response"); }
      if (!record(response)) throw new Error("Invalid Elephant response envelope");
      if (response.item === undefined) {
        if (Object.keys(response).some(k => !["query", "qid"].includes(k))) throw new Error("Invalid Elephant response envelope");
        continue;
      }
      if (!record(response.item)) throw new Error("Invalid Elephant item");
      const raw = response.item;
      const p = provider(raw.provider);
      if (!providers.includes(p)) throw new Error("Elephant returned an unrequested provider");
      const identifier = field(raw.identifier, "identifier", 2048, false);
      const rawActions = strings(raw.actions);
      const rawState = strings(raw.state);
      const actions = rawActions.slice(0, 32).map(a => field(a, "action", 128, false));
      const text = typeof raw.text === "string" ? raw.text : "";
      const subtext = typeof raw.subtext === "string" ? raw.subtext : "";
      const item: Item = { reference: randomUUID(), provider: p, identifier, text: text.slice(0, 512),
        subtext: subtext.slice(0, 512), actions, state: rawState.slice(0, 16).map(s => s.slice(0, 128)) };
      if (text.length > 512 || subtext.length > 512 || rawActions.length > 32 || rawState.length > 16 || rawState.some(s => s.length > 128)) result.truncated = true;
      if (result.items.length >= limit || Buffer.byteLength(json({ ...result, items: [...result.items, item] })) > MAX_RESULT_BYTES - 64) {
        result.truncated = true;
        continue;
      }
      result.items.push(item);
      pending.push({ item: structuredClone(item), query, expires: this.now() + TTL });
    }
    this.prune();
    for (const value of pending) this.cache.set(value.item.reference, value);
    while (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  async activate(input: ActivationInput, approval: Approval, signal?: AbortSignal) {
    const reference = field(input.reference, "reference", 64, false);
    const action = field(input.action, "action", 128, false);
    const args = field(input.arguments ?? "", "arguments", 1024);
    this.prune();
    const cached = this.cache.get(reference);
    if (!cached) throw new Error("Unknown or expired reference; query again (references last five minutes)");
    if (!cached.item.actions.includes(action)) throw new Error("Action was not advertised for this item");
    if (!approval.hasUI) throw new Error("Activation requires interactive user approval; no UI available");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 60000);
    try {
      if (signal?.aborted) abort();
      const { provider, identifier, text } = cached.item;
      const allowed = await approval.confirm("Approve Elephant action?", json({ provider, identifier, text, action, query: cached.query, arguments: args }) +
        "\nThis may launch programs, modify data, paste, or execute commands. Approve this action only?", { signal: controller.signal, timeout: 60000 });
      if (controller.signal.aborted || !allowed) throw new Error("Activation not approved or cancelled");
      // Re-check after waiting: shutdown, tree navigation, or expiry invalidates approval.
      if (this.cache.get(reference) !== cached || cached.expires <= this.now()) throw new Error("Reference expired or invalidated while awaiting approval; query again");
      signal?.throwIfAborted();
      // One-shot: a retry or another call must query and obtain approval again.
      this.cache.delete(reference);
      await this.run(["activate", `${provider};${identifier};${action};${cached.query};${args}`], { signal });
      return { status: "sent" as const, provider, identifier, action,
        message: "Activation request sent. Elephant CLI does not acknowledge action success; do not automatically retry." };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
