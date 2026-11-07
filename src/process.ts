import { spawn } from "node:child_process";

export interface RunOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number }
export type Run = (argv: string[], options?: RunOptions) => Promise<string>;

// A short-lived CLI client only: never start/restart the Elephant service.
export function binaryRunner(binary = "/usr/bin/elephant"): Run {
  return (argv, { signal, timeoutMs = 5000, maxBytes = 1024 * 1024 } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Elephant call cancelled")); return; }
    const child = spawn(binary, argv, { shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let failure: Error | undefined;
    let size = 0;
    const stdout: Buffer[] = [];
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => {
      if (child.pid) {
        try { process.kill(-child.pid, sig); } catch { /* already exited */ }
      }
    };
    const stop = (message: string) => {
      if (failure) return;
      failure = new Error(message);
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 250);
    };
    const abort = () => stop("Elephant call cancelled");
    const timer = setTimeout(() => stop("Elephant call timed out"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    // Cover cancellation between the pre-spawn check and listener registration.
    if (signal?.aborted) abort();
    const collect = (chunk: Buffer, keep: boolean) => {
      size += chunk.length;
      if (size > maxBytes) stop("Elephant output exceeded the byte limit");
      if (!failure && keep) stdout.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.on("error", () => { failure ??= new Error("Cannot start Elephant binary"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (escalation) { clearTimeout(escalation); kill("SIGKILL"); }
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Elephant CLI exited with code ${code}. In 2.22.1 a no-match query can panic; try a broader query. Raw stderr is withheld for privacy.`));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}
