# Validation record

Environment: Node **v26.13.0**, installed Pi **1.5.0**, Elephant **2.22.1**.

Completed:

1. Read installed Pi `docs/extensions.md` (all 3347 lines), `docs/packages.md`,
   package README and manifest, examples README, and relevant full examples:
   `hello.ts`, `permission-gate.ts`, `timed-confirm.ts`, `truncated-tool.ts`,
   `structured-output.ts`, and `with-deps/package.json`. Inspected installed
   loader/types and local-package installation implementation. Read CLI package
   command documentation as relevant.
2. Checked destination did not exist before creating this standalone project.
3. Inspected installed Elephant help/version/package docs, providers, and
   matching-release source; see `protocol.md`. Read-only live CLI query/state
   checks confirmed actual JSON shape and the upstream no-match failure.
4. `npm install --ignore-scripts --legacy-peer-deps`: **3 packages added,
   4 audited, 0 vulnerabilities** (development dependencies only).
5. `npm test`: **21 tests, 21 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**.
   Mock binary tests do not connect to the backend. Activation fixture echoes
   argv only. Process tests include abort, timeout, byte cap, missing executable,
   nonzero exit, and killing a TERM-resistant child process group.
6. `npm run check:installed`: **PASS** — strict TypeScript 5.9.3 no-emit check
   against installed Pi 1.5.0 types; real Pi jiti extension loader loaded exactly
   `elephant_query` and `elephant_activate`, both with output schemas. No model
   requests, tool execution, or endpoint selection in this check.
7. Read-only smoke via the real installed Pi loader and actual
   `elephant_query.execute`: **PASS** — `query: ""`, `limit: 2`, defaults only to
   `desktopapplications`; two items returned, `truncated: false`, no preview
   fields; shutdown hook completed. No activation was invoked.
8. `pi install /home/ron/Projects/pi-elephant`: **exit 0, Installed**. `pi list`
   resolves the user entry to this directory. Settings comparison: **only
   `packages` changed**, appending `../../Projects/pi-elephant`; all preexisting
   entries and model/default settings preserved. No restart/reload performed.

Not tested: live activations (deliberately prohibited), real interactive/RPC
approval UI end-to-end, all optional providers, alternate Elephant versions,
alternate Pi versions or non-Linux process-group behavior. References do not
survive reload and cannot guarantee a backend item remains unchanged. See README
for privacy, upstream limitations, and inability to undo daemon-side effects.

The initial local-install verification made no commit/push, model endpoint changes,
or modifications to other projects. Next user step: `/reload` in the desired Pi session.

## Public repository preparation

- Re-ran `npm test`: **21 passed**, no failures, cancellations, or skips.
- Re-ran `npm run check:installed`: **PASS** against installed Pi **1.5.0**
  (strict typecheck and real extension loader; no tool execution or model calls).
- Reviewed all source, tests, fixtures, scripts, manifests, and documentation for
  publication. Fixtures are synthetic; no credentials or captured private data
  were found. `node_modules/` and the temporary installed-check configuration
  are excluded by `.gitignore`.
- Publication was explicitly authorized to the public `ronasimi/pi-elephant`
  GitHub repository. No other projects or Pi configuration were modified.
