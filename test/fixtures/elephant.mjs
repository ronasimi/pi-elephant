#!/usr/bin/env node
// Mock executable ONLY. No connection to Elephant, no desktop actions.
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
if (command === "query") {
  if (args[0] !== "--json" || args.length !== 2 || args[1].split(";").length !== 4) process.exit(9);
  const payload = args[1].split(";");
  const lines = readFileSync(new URL("query.ndjson", import.meta.url), "utf8").trim().split("\n");
  console.log(lines.slice(0, Number(payload[2])).join("\n"));
} else if (command === "state") {
  process.stdout.write(readFileSync(new URL("state.ndjson", import.meta.url)));
} else if (command === "activate") {
  // Echo the wire payload for assertions; intentionally has no effects.
  console.log(JSON.stringify(args));
} else if (command === "fail") {
  console.error("PRIVATE STDERR MUST NOT LEAK"); process.exit(2);
} else if (command === "flood") {
  setInterval(() => process.stdout.write("x".repeat(4096)), 1);
} else if (command === "hang") {
  setInterval(() => {}, 1000);
} else if (command === "tree") {
  process.on("SIGTERM", () => {});
  const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: "ignore" });
  writeFileSync(args[0], JSON.stringify([process.pid, child.pid]));
  setInterval(() => {}, 1000);
} else process.exit(10);
