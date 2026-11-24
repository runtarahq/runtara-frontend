# Sealing connection secrets in the console

A brief for the console's side. The server's side is merged on runtara's `main`
(not released); what it does is in runtara's
`docs/sealed-intake.md`. A local server with it runs on `http://localhost:7311`
(`runtara/.data/sealed/run-server.sh`), and its OpenAPI is at
`http://localhost:7311/api/runtime/openapi/docs.json`.

## Why

The console sends a connection's secrets readable in the request body. They are sealed
when they reach the engine, so until then they are readable in whatever carries the
request: a proxy, a request log, the server's API process.

The server now refuses a readable secret. The console seals every secret before it
leaves the browser, and nothing between the browser and seal can read it.

The two ship together: this server refuses saves from a console that does not seal.

## The flow

For a save that enters or replaces at least one secret:

1. **Build the request once**, as it will be saved, with `{"$entered": true}` in place
   of each secret's value.
2. **Ask for an offer** with that request as the body:
   - a new connection: `POST /api/runtime/connections/offer`
   - an update: `POST /api/runtime/connections/{id}/offer`
3. **Seal the secrets** under the offer, as one JSON object.
4. **Save the same request**, adding `sealedSecrets` (the envelope) and, for a new
   connection, `connectionId` (the id the offer gave).

A save that enters no secret is what it is today: no offer, no `sealedSecrets`.

### The offer's answer

```json
{
  "success": true,
  "connectionId": "0f78f802-7835-43ab-8b03-b32b1ae23981",
  "offer": {
    "public_key": "…",
    "kid": "…",
    "keyset": "…",
    "item": "…",
    "field": "intake",
    "policy": {}
  },
  "fields": { "token": "token" },
  "notAfter": 1795504709
}
```

- `offer` goes to the sealer as it is. The console need not understand it.
- `fields` maps each secret the request marks as entered to the name to give it in the
  object that is sealed. Always use it: the names are the same, except for an MCP
  connection's extra headers.
- `notAfter` is when the offer stops being taken, in seconds since the Unix epoch: five
  minutes on.
- `offer` is null if the request marked nothing as entered.

### Sealing

seal's WASM module, from seal's release, as a dependency by URL the way
`runtara-validation-wasm` is:

```json
"seal-wasm": "https://github.com/runtarahq/seal/releases/download/v0.3.1/seal-wasm.tar.gz"
```

Import the `web` build and pass it the module's URL, as the validation loader does
(`src/shared/lib/rust-validation-wasm.ts`):

```ts
import init, { seal } from 'seal-wasm/web';
import wasmUrl from 'seal-wasm/web/seal_format_bg.wasm?url';

await init({ module_or_path: wasmUrl });
const object: Record<string, string> = {};
for (const [name, value] of Object.entries(secrets))
  object[fields[name]] = value;
const bytes = new TextEncoder().encode(JSON.stringify(object));
const envelope = JSON.parse(
  seal(
    offer.public_key,
    offer.kid,
    offer.keyset,
    offer.item,
    offer.field,
    bytes,
    JSON.stringify(offer.policy)
  )
);
bytes.fill(0);
```

`envelope` is the value of `sealedSecrets`. A secret the user left blank is left out of
the object and is not marked as entered. The module must be of the seal the server
runs: an older one refuses the offer's policy.

It loads under Node and in the console's Vite build (both checked): Vite emits the
module as an asset, and an envelope sealed in Chrome is taken by the server. The
loader is `src/shared/lib/seal-wasm.ts`.

## Create

`src/features/connections/pages/CreateConnection/index.tsx` (`handleSubmit`):

```jsonc
// POST /connections/offer, then POST /connections with the two fields added
{
  "title": "Orders",
  "integrationId": "http_bearer",
  "connectionParameters": {
    "base_url": "https://api.example.com",
    "token": { "$entered": true },
  },
  "connectionId": "<from the offer>", // save only
  "sealedSecrets": {}, // save only: the envelope
}
```

Which fields are sent sealed: the connection type's `sealedFields`
(`GET /connections/types/{id}`, and each type in the listing). It is not every field
the form marks `secret`: the server reads a certificate or a client's id, and they are
marked secret only to keep them off the screen. The console follows `sealedFields`
(`sealedFieldsOf` in `src/features/connections/sealing/enter-secrets.ts`) and names no
field itself; a type without it is of a server that takes no sealed secret, and the
save fails with a message. Besides those, each value of an MCP connection's
`extra_headers` is sent sealed.

## Update

`src/features/connections/pages/Connection/update-payload.ts` builds the patch. A
secret being replaced holds the marker where its value was:

```jsonc
// POST /connections/{id}/offer, then PUT /connections/{id} with sealedSecrets added
{
  "version": "<editProjection.version>",
  "connectionParameterPatch": {
    "set": { "base_url": "https://api.example.com/v2" },
    "write": { "token": { "$entered": true } },
    "clear": [],
  },
  "sealedSecrets": {}, // save only
}
```

Secrecy is independent of access: mark the fields the type says are secret, not
everything in `write`. A secret left alone is not in the patch. Clearing one is still
`clear`.

## Fields that are not one string

- **A Postgres URL.** The password is the secret, sealed under `database_url`. The URL
  without its password goes beside it as `database_target`, as the user typed it
  (`postgres://app@db.example.com/orders?sslmode=require`): in `connectionParameters`
  on create, in the patch's `set` on update. The server checks it (it must state its
  `sslmode`) and refuses one that still holds a password. The console only removes the
  password; it does not judge the URL.
- **An MCP connection's extra headers.** Each value is a secret. A header being
  entered holds the marker in the `extra_headers` map; one left blank is kept as it is
  held. In `fields` it appears as `extra_headers.<name>`, with the name to seal it
  under.
- **Files** (a service account's JSON, a private key) are read as text and sealed as
  any other value.
- **Limits.** One save enters at most 16 secrets, in at most 64 KiB sealed. The server
  refuses more with a message; the console says so before asking for an offer. The
  sealer itself refuses secrets and policy of more than about 48 KiB together, before
  anything is sent, and the console says that too.

## What must hold

- **One request, both calls.** The server derives where each secret may go from the
  request's other fields, at the offer and again at the save, and the save is refused
  if they differ. Build the body once and send that one value to both.
- **Retry a stale offer once.** A save can answer 409 with `"error": "OFFER_STALE"`:
  the offer is past its time, or the server was deployed in between. Ask for a new
  offer, seal again and save again, without asking the user. A second one is shown.
  Every other 409 is what it is today (a title taken, a connection changed).
- **A version conflict on update needs a new offer too**, since the request changes.
- **No readable fallback.** If the sealer does not load or the offer fails, the save
  fails with a message. The console never sends the secret readable instead: the
  server would refuse it anyway.
- **Hold a secret briefly.** Seal from bytes and overwrite them; clear the form's
  secret inputs after a save, as the edit form does.
- **A secret never reaches a log, an error report, a query cache or the URL.** Do not
  keep the envelope either.
- **Ask for the offer at submit**, not when the form opens.

## What the user sees

- Saving takes one more request. The save bar's pending state covers offer, seal and
  save.
- The offer refuses what the save would: a blank title, a URL that is not `https`, a
  connection type that cannot be stored. Show its message as the save's is shown.
- A private key that does not match its certificate (`http_mtls`) is no longer refused
  at save: the server cannot read the key. It fails when the connection is first used.
- Nothing else. No field, label or step is added to the forms.

## Queries and the generated API

- `offerForCreate` and `offerForUpdate` in `src/features/connections/queries/index.ts`.
- `createConnection` and `updateConnection` take `sealedSecrets`, and create takes
  `connectionId`.
- `src/generated/RuntaraRuntimeApi.ts` regenerated from the server's OpenAPI. Do not
  edit it by hand. Until the server is released, generate from the local server.

## Tests

- The sealing helper against the real WASM module under Node, as
  `rust-workflow-validation.test.ts` loads the validation one.
- Create and update against a mock backend: the save and the offer hold no secret value
  (assert on the serialised bodies, for every secret field of every connection type the
  fixtures have), and the two bodies are the same but for `sealedSecrets` and
  `connectionId`.
- No fallback: with the loader failing, no save request is sent.
- `OFFER_STALE` is retried once; a second is shown. A 409 that is not is not retried.
- The Postgres split: the password out, the rest as typed.
- Against the local server: save a connection of each kind (a plain secret, Postgres,
  MCP with extra headers, an OAuth client secret), then edit each.

## What this does not protect against

- **A substituted offer.** The offer reaches the console through the API. Something in
  between that swaps it reads what is sealed to it. This work stops capture, not that.
- **The console's own code.** A compromised build or a script injected into the page
  reads the secret as it is typed.

## Open questions

- How the console's build is told which seal the server runs, so that it takes the
  matching WASM module. Today both are pinned to 0.3.1 by hand.
- OAuth connections on a tenant's own app: the client secret is an ordinary secret
  field and takes this path. Confirmed: authorize and reconnect name the connection by
  id and send no parameter of it.
- An http_bearer token of about 48 KiB seals and is then refused at save with "the
  intake envelope does not hold every secret the request marks as entered, each as
  text", which does not say what is wrong.
