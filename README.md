# Runtara Frontend

The Runtara console: a React + Vite + TypeScript SPA for the
[Runtara](https://github.com/runtarahq/runtara) runtime. It is deployed apart
from `runtara-server`: as its container image
(`ghcr.io/runtarahq/runtara-frontend`, see [Docker image](#docker-image)) or
from a plain static host (see [Static hosting](#static-hosting)).

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
  `.sha256`, and the image `ghcr.io/runtarahq/runtara-frontend:X.Y.Z` (and
  `:latest`, unless the tag is a prerelease) for `linux/amd64` and
  `linux/arm64`. runtara's evaluation `docker-compose.yml` runs `:latest`.

## Dev loops

**Console only** → `npm run dev` (:8081). HMR. Needs `.env.local` for the API
base and auth mode (`VITE_RUNTARA_AUTH_MODE=local` against a local-auth
server).

**Console as deployed** — the image's nginx, rendered `config.js`, CSP, the
API on another origin — → build the image and run it against a local server
started with `CORS_ALLOWED_ORIGINS=http://localhost:8080` and
`RUNTARA_UI_PUBLIC_URL=http://localhost:8080/`:

```bash
docker build -t runtara-frontend .
docker run --rm -p 8080:8080 \
  -e RUNTARA_UI_AUTH_MODE=local \
  -e RUNTARA_UI_API_BASE_URL=http://localhost:7001 \
  runtara-frontend
# http://localhost:8080/ui/
```

## Runtime configuration

The bundle is **mount-agnostic and tenant-agnostic**: one build deploys
anywhere. `index.html` loads `config.js` before the app; it sets
`window.__RUNTARA_CONFIG__`, which
[`src/shared/config/runtimeConfig.ts`](src/shared/config/runtimeConfig.ts)
reads, falling back to the build-time `VITE_*` value for any key it lacks. The
copy in `public/` sets nothing, which is what `vite dev` and the tests run
with.

### Docker image

`ghcr.io/runtarahq/runtara-frontend` serves `dist/` with nginx on port 8080,
the console's pages under `/ui/` (a tenant's at `/ui/<tenant>/`). At every
start, [`docker/render-config.sh`](docker/render-config.sh) renders
`config.js` and the CSP from env vars, and refuses to start on a config it
cannot serve:

| Env                             | `config.js` key     | Default / notes                                        |
| ------------------------------- | ------------------- | ------------------------------------------------------ |
| `RUNTARA_UI_AUTH_MODE`          | `authMode`          | `oidc`; or `local`, `trust_proxy` — match the server's |
| `RUNTARA_UI_API_BASE_URL`       | `apiBaseUrl`        | the server's URL; unset only if one host routes `/api` |
| `RUNTARA_UI_EVENTS_BASE_URL`    | `eventsBaseUrl`     | where webhooks are delivered, if not the API's host    |
| `RUNTARA_UI_TENANT_ID`          | `tenantId`          | the tenant of a server without an IdP                  |
| `RUNTARA_UI_STRIP_ORG_ID`       | `stripOrgId`        | `true` for a single-tenant server                      |
| `RUNTARA_UI_OIDC_AUTHORITY`     | `oidcAuthority`     | required with `oidc`                                   |
| `RUNTARA_UI_OIDC_CLIENT_ID`     | `oidcClientId`      | required with `oidc`                                   |
| `RUNTARA_UI_OIDC_AUDIENCE`      | `oidcAudience`      |                                                        |
| `RUNTARA_UI_OIDC_ORGANIZATIONS` | `oidcOrganizations` | `false` when the IdP has no Auth0 Organizations        |
| `RUNTARA_UI_PLAUSIBLE_DOMAIN`   | `plausibleDomain`   | turns analytics on                                     |
| `RUNTARA_UI_PLAUSIBLE_HOST`     | `plausibleHost`     | `https://plausible.io`                                 |
| `RUNTARA_UI_MOUNT_PATH`         | `mountPath`         | `/ui/`                                                 |

The server needs the console's origin in `CORS_ALLOWED_ORIGINS` and as
`RUNTARA_UI_PUBLIC_URL`, so the OAuth callback sends the consent popup to the
console's `oauth-complete.html`. `GET /healthz` answers `ok` for health checks.
The version shown is the image's own (`--build-arg VERSION=X.Y.Z`); a server
more than one minor version away from it gets a warning.

### Static hosting

`dist/` also runs from a plain static host (a CDN). Either replace
`config.js` with one that sets `window.__RUNTARA_CONFIG__` to the settings
below plus `"hosting": "static"`, or leave it and the SPA reads `config.json`
from the site root
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
- serve `index.html`, `config.js` and `config.json` with
  `Cache-Control: no-cache`, and
  `assets/*` as immutable;
- set the CSP itself. `index.html` has one inline script, the theme script,
  which is fixed, so its hash is too (`docker/inline-script-hashes.mjs`
  prints it); `config.js` is covered by `'self'`.
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
