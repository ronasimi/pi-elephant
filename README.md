# pi-elephant

Local Pi extension for the installed Elephant backend used by Walker. It talks to
`/usr/bin/elephant`, not Walker's UI. No model/provider settings or endpoints are
selected or changed; it uses the current parent Pi model like any other tool.

## Installation

Already installed in this user's Pi configuration with:

```sh
pi install /home/ron/Projects/pi-elephant
```

Pi recorded `../../Projects/pi-elephant` in `~/.pi/agent/settings.json` → `packages`
(relative to that settings file). This is a conventional **local package** install:
Pi loads the source in place; it does not copy it, run npm hooks, or restart Pi or
Elephant. Keep this directory available. Run **`/reload` in the current Pi session**
to discover the tools. A fresh session also loads them. No reload was forced.

To remove:

```sh
pi remove /home/ron/Projects/pi-elephant
```

## Tools

### `elephant_query` — queries, not activations

```json
{"query":"terminal","limit":10}
```

Defaults to **`desktopapplications` only**, limit 20, fuzzy search. `query: ""`
lists entries. Select other providers explicitly, e.g.:

```json
{"query":"report","providers":["files"],"limit":5,"exact":false}
```

Returns structured `{ providers, items, truncated }` in both model-facing JSON and
Pi `structuredContent`. Each item has `reference`, `provider`, `identifier`, `text`,
`subtext`, `actions`, and `state`. Only advertised item actions are used; state is
item state, not an extra provider-state request. No icons, fuzzy-match positions,
file/clipboard previews, or binary data are returned. No files are opened to render
previews. Provider state was inspected for protocol verification but is not a
third tool or an action fallback.

Limits:

- 1–8 explicit provider names, no wildcard or implicit all-provider query.
- 1–50 returned items; 32 KiB serialized JSON total, including escaping.
- Text/subtext: 512 characters each; identifier: at most 2048 characters (never
  silently truncated); at most 32 actions (128 characters each) and 16 states
  (128 characters each). `truncated` signals dropped/truncated result data.
- Query: 1024 characters. CLI-delimited fields reject semicolons and controls,
  since Elephant's CLI has no escaping for them.
- 5-second CLI timeout; 1 MiB combined stdout/stderr cap. Oversize protocol output
  fails rather than returning incomplete JSON. No async watch is started.

Observed installed provider names: `desktopapplications`, `files`, `windows`,
`clipboard`, `runner`, `symbols`, `archlinuxpkgs`, `snippets`, `unicode`,
`providerlist`, `websearch`, `wireplumber`, `bluetooth`, `calc`, `playerctl`.
Provider availability and behavior still depend on the running Elephant service,
its configuration, and compositor support. Explicit named menus (`menus:name`) are
accepted, but no menus were reported by `listproviders` on this installation.
Unknown/disabled providers are not pre-discovered and can fail at query time.

### `elephant_activate` — one individually approved action

First query. Then pass a returned reference and one of its exact action strings:

```json
{"reference":"<reference from elephant_query>","action":"start"}
```

Optional `arguments` is a provider-specific string (at most 1024 characters).
There is no guessed/default action, arbitrary raw identifier activation, or
model-supplied `approved: true` bypass. References expire after five minutes, are
bounded to the latest 200 results, and are cleared on tree navigation, session
replacement, shutdown, or `/reload`. Query again if expired or evicted.

Every activation prompts with the exact provider, identifier, display label,
action, original query, and arguments. Controls/bidirectional characters are
escaped in the prompt. Confirmation expires after 60 seconds. Denial, Escape,
abort, UI failure, reference invalidation, or absence of UI fails closed. TUI and
RPC UI confirmation are supported; print/JSON modes cannot activate. Activations
are sequential and references are consumed before dispatch, even on CLI failure.

The result is **`status: "sent"`**, never “action succeeded”: the CLI only writes
the request and does not wait for the daemon's activation response. Do not
automatically retry a failed/timed-out action; it may already have executed.

## Privacy and safety boundary

- Queries never call `activate`. However, **read-only means no activation by this
  extension, not a sandbox or a guarantee that every provider is side-effect-free**.
  Provider queries may invoke helpers, perform calculations, run custom menu code,
  or reach the network. Only desktop applications are queried by default. The
  query tool deliberately makes no universal read-only/open-world annotation
  promise to permission extensions, since callers can explicitly select providers.
- File paths, window titles, application metadata/history states, clipboard text,
  and snippets can contain secrets. Returned metadata reaches the selected Pi
  model/provider and may persist in Pi sessions, logs, exports, or shared sessions.
  No previews are exposed, but `text`/`subtext` themselves may contain content.
- **Clipboard, runner, password stores, snippets, custom menus, and other sensitive
  providers require explicit selection.** Tool guidance tells the model to select
  them only on explicit user request. Selection is not a second human approval
  gate: reviewing sensitive query requests remains your responsibility.
- Results are untrusted data, not instructions. Activation approval is required
  even for apparently harmless actions such as focusing a window or opening a
  file. Depending on provider/action, approval can permit launching commands,
  pasting, deleting history, changing packages/devices, or modifying files.
- CLI subprocesses use an absolute executable and argv with **no shell**. The
  backend/providers may themselves use shells according to their configuration;
  this extension does not restrict that. Optional arguments are shown for review,
  not interpreted or declared harmless by the extension.
- The extension writes no query/result files and no persistent reference cache.
  It withholds raw stderr on errors; stdout is only parsed for whitelisted result
  fields. Pi and Elephant have their own persistence/history policies.
- Timeout, cancellation, output overflow, and session shutdown terminate the CLI
  process group with SIGTERM, escalating to SIGKILL after 250 ms. This closes the
  client connection; **it cannot undo work already accepted by Elephant** or stop
  independent daemon/provider work or applications launched by the daemon.
- Like all Pi extensions this runs with your OS permissions. Other tools (e.g.
  bash), extensions, and a trusted RPC client are outside this approval boundary.

## Known upstream limitation

Elephant **2.22.1** can panic on a no-match query (`unexpected end of JSON input`):
its CLI tries to JSON-decode the zero-length “no results” status frame. This was
reproduced without activating anything. The extension reports the nonzero exit,
with a broader-query hint, rather than silently swallowing protocol errors or
pretending a crash is a successful empty search. Empty successful CLI output is
handled as an empty result. No Elephant code or configuration was modified.

## Development and verification

```sh
cd /home/ron/Projects/pi-elephant
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run check:installed
```

There are no runtime npm dependencies: Pi supplies `typebox` and host API imports.
Development installs only TypeScript and Node types. `check:installed` resolves the
managed Pi version from `~/.pi/agent/install/current-version`, performs strict
`tsc --noEmit` checks against that installation, then loads the extension with its
real jiti loader. For a different Pi layout, set `PI_NODE_MODULES` to its
`node_modules` directory. It never executes tools or contacts a model.

Tests use synthetic NDJSON based on the verified protocol and a mock executable
that never connects to Elephant. Mock activation only echoes argv. They cover
protocol parsing, data bounds, safe defaults, delimiter injection, approval,
expiry/invalidation, one-shot dispatch, failure privacy, process limits, aborts,
and TERM-resistant process-tree cleanup. **Never run real activations in tests.**

See [protocol evidence](docs/protocol.md) and [validation record](docs/validation.md).
