# Remote providers

dango loads its content providers from a separate, trusted repository. The default
registry is `https://raw.githubusercontent.com/serifpersia/dango-providers/main/registry.json`.
Set `PROVIDER_REPO_URL` to override it. Refresh runs at startup, every six hours
(`PROVIDER_REPO_REFRESH_MS`), and through the owner-only `POST /api/providers/refresh`.
Concurrent refreshes share one load. Provider updates do not require a dango release.

## Updates and recovery

The installation-wide `<data>/remote-providers` directory contains:

- `registry.json`: the latest registry that passed validation.
- `active.json`: the last successfully loaded entry for each provider still present
  and enabled in the registry, including its matching metadata and proxy rules.
- `<id>-<version>-<sha256>.mjs`: verified module bytes. Including the hash prevents
  an attempted update from overwriting a working module with the same version.

Modules and manifests are written to temporary files and renamed into place.
Invalid registry downloads never replace the cached registry. A network or registry
validation failure uses the cached registry; if none is usable, the live maps stay
unchanged. A valid empty registry clears the live maps.

Each module must pass its SHA-256 check, dango compatibility check, import, factory,
and provider shape checks. A failed update tries the last verified cached version;
the catalog reports `serving cached <version>: <error>`. That fallback and its
metadata survive repeated refreshes and restarts. Files used by the current registry
or retained fallback entries are kept; superseded files are pruned. Existing caches
using `<id>-<version>.mjs` migrate after hash verification.

Removing a registry entry removes it from the live maps on the next successful
refresh. Disabling an entry also removes it unless explicitly enabled. Keep provider
IDs stable across fixes so saved selections continue to refer to the same provider.
Run only one dango server per installation data directory.

## Contract

Registry and provider versions are separate. Registry `version` is a non-negative
integer. Provider `version` and optional `minDango` use `major.minor.patch`.
dango checks `minDango` before executing a module or creating a template embed.
Incompatible updates may fall back only to a compatible cached version.

`kind` selects `anime`, `asmr`, `manga`, or `tv`. Module factories receive the host
context defined by `RemoteCtx` in `server/src/providers/remote-loader.ts`.
Provider method contracts live in `provider.interface.ts`, `manga/manga.types.ts`,
`tv.types.ts`, and `asmr/asmr.types.ts`. Browse metadata and module facet exports
drive filter controls; registry proxy rules configure upstream requests.

The providers repository contains authoring instructions, `ctx.d.ts`, release
checks, and live-site probes. Its host check loads every factory through the actual
dango loader and typechecks the declared context against dango's context. It does
not make playback requests. Run live probes separately when fixing a site.

## Trust

Provider modules execute with the Node process's permissions. The host context is
an API contract, not a security sandbox. Use repositories you trust as much as a
dango software update. SHA-256 checks consistency with the registry; it is not an
independent publisher signature. Loader promise timeouts cannot stop synchronous
loops in trusted module code. Providers that evaluate upstream scripts must bound
that execution and keep it off the server's event loop.
