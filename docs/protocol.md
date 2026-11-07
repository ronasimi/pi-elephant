# Verified Elephant protocol

## Installation evidence

- `/usr/bin/elephant version`: **2.22.1**.
- `pacman -Qi elephant`: package **elephant-bin 2.22.1-1**.
- Installed README read in full: `/usr/share/doc/elephant-bin/README.md`.
- CLI help inspected for `query`, `activate`, `state`, and `listproviders`.
- `/usr/bin/elephant` SHA-256:
  `2252a84784c33c7ca43534982ab1935e5bb22d9c07af61257fbef2f4e439b53c`.
- Source reviewed at upstream tag **v2.22.1**, commit
  **8f1e21d6efe40b8b3953f95b9574f99f717caf91** (GitHub tree and commit APIs). Source version
  file also reads `2.22.1`. This is matching-release source, not a reproducible
  build attestation for the installed binary.

The installed README is useful but partly stale (e.g. `generatedoc` vs actual
`generate doc`); actual CLI source and read-only live output were authoritative.

## CLI payloads

All links below are pinned to the reviewed commit:

- [CLI commands](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/cmd/elephant/elephant.go)
- [query client](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/client/query.go)
  lines 34–61: semicolon split, **3 or 4** fields, comma-separated providers,
  integer limit, optional boolean `exactsearch`. Use:

  ```text
  argv = ["query", "--json", "desktopapplications,files;search text;20;false"]
  ```

  `--json` is required despite misleading help default text: the command passes
  `cmd.Bool("json")`, whose unset value is false. The extension does not use
  `--async`; normal query stops at status 255. Output is **NDJSON, one
  QueryResponse envelope per item**, not a JSON array. Empty/default fields are
  omitted by Go `encoding/json`.

- [activation client](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/client/activate.go)
  lines 14–23: split into **five** fields, with no escaping or length checking:

  ```text
  argv = ["activate", "provider;identifier;action;original query;argument string"]
  argv = ["activate", "files;some-identifier;open;;"]
  ```

  Trailing empty fields are significant. `arguments` is one string, not an argv
  array. The protobuf's `single` field is never set by this CLI. The client only
  sends bytes and closes (lines 30–48); it does not read an acknowledgment. The
  extension never sends this to the real binary during verification.

- [state client](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/client/providerstate.go)
  lines 16–19: **a provider name alone**, not a semicolon-delimited query:

  ```text
  argv = ["state", "--json", "desktopapplications"]
  ```

  NDJSON ProviderStateResponse has optional `states`, `actions`, `provider`.
  Live output here: `{"provider":"desktopapplications"}`. This does NOT imply
  applications have no actions: item actions are returned by queries. No state
  fallback or generic activation action is guessed by the extension.

## Response schemas and wire framing

Reviewed definitions:

- [query.proto](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/pkg/pb/query.proto)
- [activate.proto](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/pkg/pb/activate.proto)
- [providerstate.proto](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/pkg/pb/providerstate.proto)

A query envelope has `query`, `item`, `qid`. An item has `identifier`, `text`,
`subtext`, `icon`, `provider`, `score`, `fuzzyinfo`, numeric `type`, `mimetype`,
`preview`, `preview_type`, `state`, `actions`. The extension exposes only its
small documented subset and adds an opaque local activation reference.

For context, the CLI opens
`$XDG_RUNTIME_DIR/elephant/elephant.sock`, falling back to
`$TMPDIR/elephant/elephant.sock` via Go `os.TempDir()`, not the README's old
`/tmp/elephant.sock` example. Its request framing is:

```text
request-type byte | format byte (1 = JSON) | uint32 big-endian length | JSON
```

Request types: query 0, activate 1, state 4. Responses use a one-byte type plus
uint32 length and payload (no second format byte). Query item types are 0/1;
query done 255; no results 254; provider state 3; state done 253. The extension
uses the verified CLI, **not a new socket/protobuf implementation**.

Reviewed handlers:
[query](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/handlers/queryrequesthandler.go),
[state](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/handlers/staterequesthandler.go),
[activation](https://github.com/abenz1267/elephant/blob/8f1e21d6efe40b8b3953f95b9574f99f717caf91/internal/comm/handlers/activationrequesthandler.go).
Desktopapplications/files query implementations and the windows README were also
reviewed to confirm item-specific action lists and preview sensitivity.

## Read-only live checks

```sh
elephant state --json desktopapplications
# {"provider":"desktopapplications"}
elephant query --json 'desktopapplications;;2;false'
# two envelopes, with item.provider, identifier, text, state, actions, qid
# e.g. actions: ["start","edit","unpin"] / ["start","edit","pin"]
```

No-match queries for `org.gnome.Calculator` and `firefox` on this installation
exited with `panic: unexpected end of JSON input`, stack at `client/query.go:119`.
Source explains it: handler writes zero-length status 254, while the CLI only
short-circuits 255 and tries `json.Unmarshal` on the empty 254 payload. The
extension preserves nonzero exits as errors. It does not guess that every panic,
partial output, or arbitrary protocol failure is an empty result.

Fixtures in `test/fixtures` are synthetic, use the verified field shapes, and
contain no captured personal clipboard, filenames, or window titles.
