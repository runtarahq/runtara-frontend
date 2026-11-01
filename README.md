# Runtara Frontend

The Runtara console: a React + Vite + TypeScript SPA for the
[Runtara](https://github.com/runtarahq/runtara) runtime. `runtara-server`
embeds a release of it (`--features embed-ui`); it also runs from a plain
static host (see [Static hosting](#static-hosting)).

## Quick start

```bash
npm install        # Node version pinned in `.node-version`
cp .env.example .env
# fill in VITE_RUNTARA_API_BASE_URL and the VITE_OIDC_* values
npm run dev        # http://localhost:8081
```

## Versions and releases

The console follows runtara's versions: console `X.Y.*` works with runtara
`X.Y.*`, and with the minor on either side while a release rolls out. Patch
releases are independent, so a console fix ships without a server release.

- **What it builds against.** The browser validation WASM comes from the
  `runtara-validation-wasm` dependency, a tarball attached to a runtara release
  (see `package.json`). `npm run generate-api-runtime-release` regenerates
  `src/generated/RuntaraRuntimeApi.ts` from the same release's `openapi.json`.
  Moving to a new runtara minor means bumping that URL and regenerating.
- **Releasing.** Set `version` in `package.json`, merge, and push the tag
  `vX.Y.Z`. The release workflow builds with `VITE_RUNTARA_VERSION` set and
  publishes `runtara-frontend-X.Y.Z.tar.gz` (the contents of `dist/`) with its
  `.sha256`.
- **Embedding in runtara.** runtara pins a release by version and checksum in
  `crates/runtara-server/frontend.lock`; its build fetches that tarball.

## Dev loops

**Console only** → `npm run dev` (:8081). HMR. Needs `.env.local` for the API
base and auth mode (`VITE_RUNTARA_AUTH_MODE=local` against a local-auth
server).

**Console against the real server surface** — mount prefix, injected
`<base href>`, CSP, single origin, no CORS — → keep a watcher going and point
a runtara server at this checkout's `dist/`:

```bash
npm run build:watch
```

```bash
RUNTARA_UI_DIST_DIR=/path/to/runtara-frontend/dist cargo run -p runtara-server --release
```

The server reads `dist/` per request, so a save plus a browser reload is the
whole loop, and it takes precedence over an embedded copy.

## Runtime configuration

The bundle is **mount-agnostic and tenant-agnostic**: one build deploys
anywhere. At startup, `runtara-server` injects `<base href>` and
`window.__RUNTARA_CONFIG__` into `index.html` from `RUNTARA_UI_*` env vars:

| Runtime env (`RUNTARA_UI_*`)  | Build-time fallback (`VITE_*`)                 | Consumer                |
| ----------------------------- | ---------------------------------------------- | ----------------------- |
| `RUNTARA_UI_OIDC_AUTHORITY`   | `VITE_OIDC_AUTHORITY`                          | OIDC                    |
| `RUNTARA_UI_OIDC_CLIENT_ID`   | `VITE_OIDC_CLIENT_ID`                          | OIDC                    |
| `RUNTARA_UI_OIDC_AUDIENCE`    | `VITE_OIDC_AUDIENCE`                           | OIDC                    |
| `RUNTARA_UI_API_BASE_URL`     | `VITE_RUNTARA_API_BASE_URL`                    | API client              |
| `RUNTARA_UI_PLAUSIBLE_DOMAIN` | `VITE_RUNTARA_PLAUSIBLE_DOMAIN`                | Analytics (opt-in)      |
| `RUNTARA_UI_PLAUSIBLE_HOST`   | `VITE_RUNTARA_PLAUSIBLE_HOST`                  | Analytics (opt-in)      |
| server build stamp            | `VITE_RUNTARA_VERSION` / `VITE_RUNTARA_COMMIT` | Sidebar version display |

Config resolution lives in [`src/shared/config/runtimeConfig.ts`](src/shared/config/runtimeConfig.ts).
Vite dev server and tests use the build-time fallbacks; the embedded
server overrides them.

### Static hosting

`dist/` also runs from a plain static host (a CDN). With no injected config,
the SPA reads `config.json` from the site root
([`staticConfig.ts`](src/shared/config/staticConfig.ts)): the same keys as
`window.__RUNTARA_CONFIG__` (`authMode`, `oidcAuthority`, `oidcClientId`,
`oidcAudience`, `oidcOrganizations`, `apiBaseUrl`, `eventsBaseUrl`,
`plausibleDomain`, `plausibleHost`), plus `mountPath` (default `/ui/`). The
tenant is the first path segment under the mount (`/ui/acme/…`), and
entitlements come from `GET /api/runtime/entitlements`. The version shown is
the bundle's own `VITE_RUNTARA_VERSION`, so set it when building; a server
more than one minor version away from it gets a warning (with no version
set, nothing is checked).

The host has to:

- serve `dist/` at the site root (`<base href="/">` is what `./assets/*`
  resolve against);
- answer every unknown path with `index.html` (SPA fallback);
- serve `index.html` and `config.json` with `Cache-Control: no-cache`, and
  `assets/*` as immutable;
- set the CSP itself. `index.html` has two inline scripts, the empty config
  placeholder and the theme script; both are fixed, so their hashes are too.
  The OAuth landing page (`oauth-complete.html`) needs `script-src 'self'` and,
  for its `<style>` block, `style-src 'unsafe-inline'`.

Serve `/api/*` and `/health` from the same origin (a proxy to runtara-server)
and leave `apiBaseUrl` unset. On another origin the server needs
`CORS_ALLOWED_ORIGINS` set to the console's origin and `RUNTARA_UI_PUBLIC_URL`
to where the console is served, so the OAuth callback sends the consent popup
to the console's `oauth-complete.html`.

## Scripts

- `npm run dev` — Vite dev server on `:8081`
- `npm run build` — TypeScript check + production bundle into `dist/`
- `npm run preview` — serve the production bundle locally
- `npm run lint` — ESLint
- `npm test` — Vitest
- `npm run test:e2e` — Playwright (see `e2e/README.md`)
- `npm run generate-api-runtime-release` — regenerate the runtime API client from the pinned runtara release's `openapi.json`
- `npm run generate-api-runtime-local` / `generate-api-management-local` — regenerate TypeScript API clients from a running server

## Project layout

```
src/
├── features/   # domain modules (workflows, connections, objects, triggers, …)
├── shared/     # cross-feature UI, hooks, stores, queries, config
├── generated/  # swagger-typescript-api output — do not hand-edit
├── router/     # React Router definitions
└── test/       # vitest setup & utilities
```

## License

AGPL-3.0-or-later. See [`LICENSING.md`](LICENSING.md).
