# Architecture audit and refactoring plan

Audit of runtara-frontend 10.0.0 at commit `3935377`, 2026-11-19.

The platform shell (runtime config, deployment, tenancy, test discipline) is in
good shape, and the layering between `src/shared` and `src/features` holds. The
structural debt is concentrated in the workflow editor, which is 55% of the
code, and in three contracts that nothing enforces: the generated API client,
the edition extension point, and the audit regression suite.

[`implicit-state.md`](implicit-state.md) covers behavioural defects in the
implicit state machines. This document covers structure and does not repeat
those findings.

## How to read this document

The high- and medium-priority items have since been worked on; each has a
**Status** paragraph saying what was done and what remains. The findings above
each status describe the code as it was at the audit, and their paths and line
numbers are of that code.

- Paths are relative to the repository root. `WF` stands for
  `src/features/workflows`, and `WE` for `WF/components/WorkflowEditor`.
- Counts are greps over non-test, non-generated source unless stated.
- The shared platform layer and the health checks were read and run directly.
  The workflows, editor, other-feature and build/CI findings come from three
  delegated reads; their main claims were spot-checked, but not every line
  reference was re-verified. Check a reference before acting on it.
- A consequence marked _inferred_ follows from the code but was not observed.

## Health snapshot

| Check                      | Result                                                  |
| -------------------------- | ------------------------------------------------------- |
| `npx tsc -b`               | passes                                                  |
| `npm run lint`             | 0 errors, 21 warnings                                   |
| `npm run knip`             | clean                                                   |
| `npm test`                 | 1718 tests in 189 files pass (13 s)                     |
| `npm run build`            | passes; one 506 kB chunk warning (the lazy editor page) |
| Playwright (mocked, audit) | not run for this audit                                  |

Size: about 143k lines of TS/TSX in 604 files.

| Module                        | Lines  |
| ----------------------------- | ------ |
| `features/workflows`          | 78,385 |
| `shared/components`           | 13,025 |
| `generated`                   | 9,344  |
| `features/objects`            | 7,813  |
| `features/connections`        | 6,728  |
| `features/operations`         | 4,540  |
| `features/triggers`           | 3,976  |
| `features/invocation-history` | 3,119  |
| `features/analytics`          | 2,426  |
| `features/settings`           | 807    |

Tests: 189 unit test files (31.5k lines), 78 Playwright spec files.

## Strengths to preserve

- **Layering holds.** `src/shared` has no imports from `src/features`. Only 3
  imports climb three or more directories; 1,729 use the `@/` alias.
- **One bundle deploys anywhere.** Runtime config comes from `config.js` or
  `config.json` (`src/shared/config/runtimeConfig.ts`, `staticConfig.ts`), and
  the base is mount- and tenant-agnostic (`appBase.ts`).
- **The container is well set up.** The entrypoint fails closed on a config it
  cannot serve, the CSP is strict with a build-time inline-script hash
  (`docker/render-config.sh`, `docker/inline-script-hashes.mjs`), and the image
  is non-root with a health check.
- **The DSL conversion is pure and heavily tested.** `WF/utils/execution-graph/`
  has no React or store imports and 106 tests, many of them round-trip
  (`WE/CustomNodes/utils.test.ts`).
- **The canvas layout engine is hand-rolled, pure and tested**
  (`WE/CustomNodes/layout/`, about 2,500 lines, no dagre or elk).
- **Query keys are mostly centralised** in `src/shared/queries/query-keys.ts`:
  115 factory uses against 29 inline arrays.
- **Dirty tracking is coherent.** `markDirty` and `dirtyRevision` are the single
  entry points, and saves are single-flight.
- **Chat streaming is well designed**: resume by sequence number, idempotent
  sends, one abort controller (`WF/pages/Chat/useChatStream.ts`).
- **Every route is lazy-loaded** (`src/router/index.tsx`), and node components
  are memoised with fine-grained store selectors.
- **Pure logic is routinely extracted into tested sibling modules**, and
  comments record why each guard exists.
- **CI gates seven checks on a PR**: lint, format, `tsc -b`, unit, knip, build,
  mocked Playwright, plus an image smoke test.

## High priority

### H1. No step-type registry

Step type is dispatched by string comparison roughly 130–140 times across 33
files. The largest sites:

- `WF/utils/execution-graph/serialize-steps.ts`: `serializeSteps` is one loop
  body of about 1,170 lines with about 14 `if (stepType === …)` blocks.
- `WF/utils/execution-graph/deserialize-steps.ts`: `normalizeNodesAndEdges` is
  one object literal with 11 spread-IIFEs.
- `WE/NodeForm/NodeFormItem.tsx`: 18 comparisons, including a 13-branch
  if-chain and zod `superRefine` branches.
- `WE/step-summary.ts` and `WF/components/StepTypeIcon/index.tsx`: 14 each.

The only table is `STEP_TYPES` in `WF/config/workflow.ts`, which maps step type
to node type. Adding a step type with its own form touches 10–14 files:
`config/workflow.ts`, `WE/index.tsx` (`nodeTypes`), a new
`NodeForm/<X>StepField.tsx`, `NodeFormItem.tsx`, `serialize-steps.ts`,
`deserialize-steps.ts`, `step-summary.ts`, `step-details.ts`,
`StepTypeIcon/index.tsx`, `NodeForm/StepOutputPanel.tsx`, `NodeForm/shared.ts`,
`InputMappingField/index.tsx`, and sometimes `utils/container-scope.ts` and
`NodeForm/StepPickerModal.tsx`.

A plain `Agent` capability step needs none of these; it is driven by server
metadata.

**Refactoring.** Introduce a per-step-type descriptor registered in one place:
node component, size, form field component, zod refinement, `serialize`,
`deserialize`, summary, details, icon, output shape. Migrate one step type at a
time; the round-trip tests already pin behaviour. Do H2 first, so descriptors
are typed.

**Status: done.** Five tables hold one entry per DSL step type, each typed
`{ [T in StepType]: … }` over the generated client's step types, so the
compiler names the table a new step type is missing from:

- `WF/step-types/catalog.ts`: node type, display name, summary, badge,
  durable, retries, and which fields the DSL keeps for it (agent, connection,
  input schema, direct fields).
- `WF/step-types/ui.tsx`: icon and the main-tab form.
- `WF/step-types/form-rules.ts`: what its form refuses to save.
- `WF/utils/execution-graph/step-serializers.ts` and `step-deserializers.ts`:
  one function per step type, taken out of the two monoliths as they were.

`serializeSteps` and `normalizeNodesAndEdges` keep what every step shares, and
read the catalog for what differs. The node-type lookup, `StepTypeIcon`, the
node form's choice of field and its validation, its durable and retry sets
and the card summary read the tables. A step type's form no longer checks
that it is shown for its own type.

No code decides what to do for a step by comparing its type's name. Of the
141 comparisons at the audit, the workflow code has two, both definitions:
`isStepOf(step, 'Agent')`, the typed guard that narrows a DSL step so the
fields only that type has can be read, and `isLegacyStartStep()`. What used
to be asked by name is asked of the catalog: whether a step takes an agent,
calls a workflow, ends its path, nests a graph, and what its body sees of the
data around it. `WF/queries/chat.ts` compares runtime event kinds, which are
not DSL step types.

### H2. The DSL is typed by hand, and the hand-written types are wrong

`WF/types/execution-graph.ts` gives every step
`inputMapping?: Record<string, string>` and a Split-shaped `config`. That forces
about 100 `any`s in the converter (`serialize-steps.ts`, `deserialize-steps.ts`,
`serialize.ts`) and 14 `stepType as string` casts. The feature holds about 400
of the 480 `any`s in non-test source.

The generated client already has a full `Step` union
(`src/generated/RuntaraRuntimeApi.ts:4327`) that the converter does not use. One
reason is that `executionGraph` is generated as `any` on the workflow DTOs
(`:1119`, `:4876`), although an `ExecutionGraph` type exists (`:5240`).

`node.data` is also a hybrid of DSL step and form state. The deserializer
injects UI fields (`splitParallelism`, `whileCondition`, `subgraphMeta`), and
the serializer strips them with a 15-name destructure
(`serialize-steps.ts:42-93`). A new UI field missing from that list would leak
into the saved DSL (_inferred_).

**Refactoring, as proposed at the audit** (all three are done; the status
below says how each was):

1. Have the generated client type `executionGraph` as `ExecutionGraph`
   instead of `any`.
2. Type the converter against the generated `Step` union and delete the
   hand-written step types.
3. Separate a node's form-only fields from the step's own, so that saving a
   step cannot carry one into the DSL.

**Status: done.**

- `DslStep` is the generated `Step` union and `StepType` its discriminant
  (`WF/types/execution-graph.ts`); the hand-written step and config types are
  gone, with the `stepType as string` casts.
- Each per-step deserializer takes its step typed as the generated client
  defines it, so what it reads from the DSL is checked.
- Each per-step serializer takes the step it finishes typed the same way, and
  builds its config as the client's `SplitConfig`, `SwitchConfig` and so on,
  so what it writes is checked.
- `step-types.roundtrip.test.ts` holds a typed fixture of every step type and
  takes each through load and save.

On step 3, the node's data is split by type, not by nesting. `StepNodeData`
is the step's own fields beside `StepFormOnlyFields`, which declares every
field a node holds for its form only; `FORM_ONLY_STEP_FIELDS`, the one list
taken off a step on save, does not compile unless it names each of them, and
the round-trip test saves every step type with all of them set. Two
alternatives were weighed and not taken:

- Nesting them under `node.data.ui` would rename the node form's fields,
  which react-hook-form addresses by flat name in about 30 files, for a
  guarantee the type check and the test already give.
- Saving only the fields the DSL type lists (an allow-list) would drop a
  field a newer server added from every step this console saves. The console
  is meant to work one minor apart from the server, so it keeps what it does
  not know.

On step 1, the generated client types `executionGraph` as the DSL's
`ExecutionGraph` on the workflow DTOs. The generator
(`scripts/generate-api-runtime-release.mjs`) points the field at the
`ExecutionGraph` definition the release's schema has, where that schema
leaves it free-form, before the client is made from it.

### H3. Three contracts are unenforced

**Generated API client.**

- No CI step regenerates `RuntaraRuntimeApi.ts` and diffs it against the pinned
  release. The file carries no source-version stamp.
- `RuntaraManagementApi.ts` is still live (`src/shared/queries/billing.ts`, and
  `/health` in `useHealthCheck.ts` and `maintenance-page.tsx`) but can only be
  regenerated from a local server (`generate-api-management-local`).
- Console, WASM and API client versions are aligned by README procedure only.

**Edition.**

- `tsc` always resolves `@edition` to `./src/edition`, which is empty, so
  `routes`, `open`, `menu`, `settings`, `footer`, `useTenants` and
  `noWorkspace` are never exercised by build, tests or e2e.
- There is no example edition, contract test, or CI job with
  `RUNTARA_EDITION_DIR` set. The `Edition` type and everything reachable
  through `@/` are an unversioned API.
- `vitest.config.ts` lacks the `editionPackages` plugin that `vite.config.ts`
  has, and resolves a relative `RUNTARA_EDITION_DIR` against `__dirname` rather
  than the working directory.

**Audit suite.** `e2e/audit/` holds 133 tests. Only one `knownDefect()` call
remains (`shared.audit.spec.ts`), so the rest are plain regression tests, yet no
workflow runs them. The config comment still says they assert defects that
exist today.

**Refactoring.**

1. CI job: run `npm run generate-api-runtime-release` and fail on a diff. Stamp
   the generated file with the release it came from.
2. Publish the management `openapi.json` with a release, or move the two
   remaining uses onto the runtime client and delete the management client.
3. Add an example edition under `e2e/` or `test/` that uses every `Edition`
   field. Build, type-check and run a mocked spec against it in CI. Share the
   edition resolution between `vite.config.ts` and `vitest.config.ts`.
4. Run the audit suite nightly, or on PRs if 16 minutes is acceptable, and
   update its config comment.

**Status: done.**

- `npm run check-api-runtime-release` regenerates the client aside and diffs
  it, and CI gates on it. It found drift at once: the client checked in is
  ahead of runtara v10.0.0 (API key scopes, revoking a user's keys). What it
  has beyond the release is recorded in `scripts/api-runtime.pending.patch`
  (`npm run record-api-runtime-pending`), which the check applies first, so
  the known difference passes and any other fails. Delete the patch with the
  bump to the release that carries it; the check fails on one that no longer
  applies.
- The management client is gone. It could only be regenerated from a running
  server, and was kept for two calls: the billing portal and the health
  check. They are written out and tested in `src/shared/queries/server.ts`.
- `examples/edition` fills in every part of `Edition`. `npm run test:edition`
  type-checks the console with it and runs its contract tests, and CI also
  bundles with it. `edition.config.ts` is the one place the build and the
  tests resolve an edition.
- `.github/workflows/audit.yml` runs the audit suite on `main`, nightly and on
  demand.

### H4. Two parallel HTTP stacks

- Auth is not an interceptor. `useCustomQuery` and `useCustomMutation` pass the
  token into every query function (`src/shared/hooks/api.ts`, typed `any`), and
  each function builds headers itself: 78 `createAuthHeaders` call sites.
- Nine raw `fetch()` calls bypass the axios client: `WF/queries/index.ts:480,
534, 592, 937, 965`, `WF/queries/chat.ts:49, 88, 117`, and
  `WE/NodeForm/AiAgentStepField.tsx:69`. They skip the 401-redirect and
  503-maintenance interceptors (`src/shared/queries/index.ts`), build auth
  headers inconsistently, and produce four error shapes.
- `rebuildWorkflowVersion` is `void fetch(...)` by design (the response blocks
  for about 30 s), so a network failure there is never seen.
- The WASM loader reads the OIDC token straight from `localStorage`
  (`src/shared/lib/rust-validation-wasm.ts`) and makes one request per agent.
- 9 calls go through untyped `RuntimeREST.instance.*` instead of the generated
  methods.

**Refactoring.**

1. Add one request interceptor that attaches the current token from the OIDC
   user manager. Query functions then stop taking a token; remove the parameter
   feature by feature.
2. Add one `fetch` wrapper for streaming and long-running calls that shares the
   base URL, auth header, 401 and 503 handling, and one error type.
3. Move the `AiAgentStepField` fetch to `features/connections/queries`.

**Status: done.**

- `currentAccessToken()` (`src/shared/auth/access-token.ts`) is the one place
  the stored token is read.
- The generated clients attach it in a request interceptor, unless the caller
  set an `Authorization` header.
- `runtimeFetch()` (`src/shared/queries/runtime-fetch.ts`) is `fetch` for the
  runtime API, with the tenant's base URL, the token, and the same handling of
  a 401 and a 503 as the interceptor (`reportResponseStatus`).
- The nine raw `fetch` calls and the validator's loader go through it. The
  model lookup moved to the connections queries.
- No query function takes a token: 83 signatures lost the parameter,
  `useCustomQuery`, `useTableQuery` and `useCustomMutation` no longer pass
  one, and `createAuthHeaders` is gone.

- Four of the nine calls that went around the generated methods use them
  (bulk create and update, CSV export, the OAuth authorize URL). The other
  five go through the client's HTTP instance with their response typed,
  because the pinned release's schema has no method that fits: the two CSV
  imports are declared without a JSON body, the pending-confirmation routes
  are not in it yet, and `operationsRequest` is the operations feature's one
  typed entry to its routes.

A component that gates on having a session (the run buttons, the OAuth flow)
reads the token from `useToken()` to know there is one; it does not send it.

### H5. God modules in the editor

| Module                                      | Lines | What is fused                                                                                                                |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `WF/pages/Workflow/index.tsx`               | 1,635 | 13 `useState`, 9 effects, 6 mutations, 34 `getState()` calls; no tests                                                       |
| `WE/index.tsx`                              | 1,640 | One component (`:228-1640`) with 18 callbacks, 9 effects, 7 memos                                                            |
| `WF/stores/workflowStore.ts`                | 1,460 | About 60% canvas geometry: `insertNodeBetween` and `onNodesChange` are 300 lines each, with a duplicated parent-expand block |
| `WF/pages/Workflow/useWorkflowExecution.ts` | 635   | A 300-line effect copying polled run status into `executionStore`; no tests                                                  |

Seams in `pages/Workflow/index.tsx`, as found at the audit (every one below,
and those of `WE/index.tsx`, has since been taken out; see the status):

- compilation watch and rebuild (`:124-359`, `:1136-1162`)
- version switching (`:446-507`)
- the save pipeline, a 280-line `submitWorkflow` (`:714-990`)
- import and export (`:1164-1412`)
- the unsaved-changes guard (`:146-228`)
- two near-identical execute handlers (`:1005-1092`)

Seams in `WE/index.tsx`: step create, insert and parallel-branch flows
(`:811-1116`), node save with validation and rename (`:1122-1210`),
pending-node commit (`:1220-1358`), viewport fitting (`:551-663`).

**Refactoring.** Follow the pattern `useWorkflowExecution` and
`useWorkflowSettings` already set: one hook per seam, tested on its own. Move
the store's geometry into pure functions of `(nodes, edges)` beside the layout
engine; `renameStep` must stay atomic in the store. Write tests for the save
pipeline before moving it.

**Status: done.**

| Module                                      | Lines at the audit | Lines now | What moved out, each with tests                                                                                                                                                      |
| ------------------------------------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WF/pages/Workflow/index.tsx`               | 1,635              | 893       | `save-workflow.ts`, `workflow-settings.ts`, `import-workflow.ts`, `use-compilation-watch.ts`, `use-workflow-load.ts` (loading and version switching), `use-unsaved-changes-guard.ts` |
| `WE/index.tsx`                              | 1,640              | 1,208     | `pending-step.ts` (placing and wiring a picked step), `use-canvas-fit.ts` (viewport fitting), `apply-step-edit.ts`                                                                   |
| `WF/stores/workflowStore.ts`                | 1,460              | 902       | `canvas-geometry.ts` (`insertStepBetween`, `applyCanvasNodeChanges`, `expandParentToFitChildren`)                                                                                    |
| `WF/pages/Workflow/useWorkflowExecution.ts` | 635                | 635       | Nothing moved; it now has tests of its own (11)                                                                                                                                      |

The hooks taken out of the page run where the code they replace ran, so its
effects fire in the order they did.

What the three modules hold now is the orchestration of the pieces above.
The page's two run handlers are one (`startRun`, with `run-failure.ts` for
what a refusal says), and writing a step edit is `apply-step-edit.ts`.

## Medium priority

### M1. Graph state takes four hops

The query function converts DSL to canvas nodes, so the React Query cache holds
a view model (`WF/queries/index.ts:343`). The page passes them as props, an
effect JSON-hashes them and calls `syncFromReactFlow` (`WE/index.tsx:533-549`),
and React Flow is controlled from zustand. Load is settled by timers: 100 ms to
clear dirty, 150 ms to end version switching
(`WF/pages/Workflow/index.tsx:433-474`).

**Refactoring.** Keep the DTO in the query cache and convert in one explicit
"load into editor" action keyed by workflow id and version. That removes the
hash effect and both timers.

**Status: done.** `getWorkflowWorkflow` returns the graph as the server sent
it, and the query cache holds no canvas nodes. `use-workflow-load.ts` hands a
fetched graph to the store's `setExecutionGraph`, which draws it and starts it
clean; an import goes in the same way. The effect is keyed by the graph
object, which the query client keeps the same while its content is, so a
refetch that brings nothing new leaves the canvas alone, as the hash did. The
editor takes no `nodes` or `edges`, `syncFromReactFlow` is gone, and so are
both timers: a version switch ends when its fetch does. The query module no
longer imports a component, and `src/test/architecture.test.ts` keeps query
modules from importing any. Audit spec WF-8 opens a workflow with a container
step and checks it has nothing to save.

The workflow's settings (variables, schema fields) are still shaped in the
query function. They are plain data, not a view of the canvas.

### M2. Duplicated and scattered editor state

- Validation errors live in both `workflowStore` and `validationStore`; node
  components subscribe to both, and save writes both. `validationStore` also
  owns bottom-panel tab state.
- Workflow settings (name, variables, schemas, timeouts) sit in page `useState`
  as `stagedWorkflowChanges`. The staged-over-server merge is written three
  times: `useWorkflowSettings.ts:47-78`, `index.tsx:742-869`, `:1169-1239`.
- Node-form state is split across react-hook-form, `useNodeFormStore` and
  direct writes to `useWorkflowStore.stagedNodeIds`.
- `timelineStore` is a hand-rolled paginated cache with one consumer.
- The store's `executionGraph` copy, `getReactFlowElements`,
  `setSelectedNodes` and `setSelectedEdges` have no reader outside the store.

**Refactoring.** One validation store. Move staged settings into the workflow
store behind one merge function. Replace `timelineStore` with
`useInfiniteQuery`. Delete the dead store members.

**Status: done.**

- Validation errors live in `validationStore` alone; a step rename moves its
  messages there (`renameStep`).
- The store's `executionGraph` copy, `getReactFlowElements`, `setSelectedNodes`
  and `setSelectedEdges` are gone.
- The staged-over-server merge is one function, `mergeWorkflowSettings`
  (`WF/pages/Workflow/workflow-settings.ts`): the settings dialog, a save, an
  export and the cache patch after a save all call it.
- `timelineStore` is gone. `useHierarchicalTimeline` reads the top-level steps
  with an infinite query and each open step's children with a query of their
  own. The store's poll replaced every loaded page with the first; the query
  refetches all of them.

- The staged settings are a store of the editor, `useStagedSettings`
  (`WF/pages/Workflow/staged-settings.ts`), with staging, an import,
  discarding and settling after a save as its actions. A step is marked as
  holding form edits through `markNodeStaged`, not by writing a set.

What stays apart is by design: the step form's values are react-hook-form's,
and its mapping rows are `useNodeFormStore`'s, which the mapping editor reads
between renders.

### M3. Stores are module singletons with manual reset

All six workflow stores are module-level. Reset is a page effect keyed on
`workflowId` (`WF/pages/Workflow/index.tsx:398-423`); `nodeFormStore` and panel
state are not reset there. Two editors cannot coexist, and `WE/canvas-bridge.ts`
is another module singleton for the same reason. There are 64 imperative
`getState`/`setState` calls, 5 of them raw `setState` from components.

**Refactoring.** Create the stores per editor instance behind a context
provider (zustand's `createStore` with `useStore`), so reset is unmount. Route
the raw `setState` calls through actions first.

**Status: done, with one limit.** `editorStore` (`WF/stores/editor-scope.ts`)
declares a store that is created when an editor first needs it and dropped
when that editor unmounts. The workflow page wraps itself in
`EditorStoresProvider`, keyed by the workflow id, so another workflow starts
from new stores and the reset effect is gone. The workflow, validation,
execution and step-form stores and the canvas bridge are declared this way,
which covers the two the reset missed. The seven raw `setState` calls go
through actions (`editNodes`, `revertNodes`, `clearNodeStatuses`).

The limit: components read the stores of the provider above them, but code
outside React (67 `getState` calls) reaches the stores of the editor on
screen. Two editors side by side would each render their own state and share
that path. Nothing mounts two; passing a store to every imperative caller is
the remaining step if something does. `chatStore` is still a module store:
the chat page remounts between its two routes and relies on it.

### M4. Features depend on the app entry

12 feature files import `queryClient` from `@/bootstrap`, a module that calls
`createRoot` and starts analytics on import.

**Refactoring.** Move the client to `src/shared/lib/query-client.ts`, or use
`useQueryClient()` inside components and hooks.

**Status: done.** The client is `src/shared/queries/query-client.ts`; nothing
but `main.tsx` imports the app entry, and a test holds that.

### M5. Feature import cycles

| From → to                       | Imports | Symbols                                                                               |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| operations → invocation-history | 4       | `RunStatusPill`, `formatRunDuration`, `RUN_STATUS_OPTIONS`                            |
| invocation-history → operations | 5       | `describeFailure`, `queryRunSummary`, `StateValue`, `ReplayButton`, `RefreshControls` |
| operations → workflows          | 9       | `ActionForm`, `InputRetryPanel`, `useManagedInputSubmissions`, `form-schema-adapter`  |
| workflows → operations          | 2       | `useVersionStateSchema`, `stateLabel`                                                 |
| invocation-history → workflows  | 11      | Replay/Resume/Stop buttons, `canResume`, `executionDisplayName`, `getWorkflows`       |
| workflows → invocation-history  | 4       | `getAllExecutions`, `ParentRunLink`, `ChildRunsCard`                                  |

There are two different `ReplayButton` components
(`WF/components/ReplayButton`, `src/features/operations/components/shared.tsx:161`).
One-way edges (triggers, objects and workflows reading connections; triggers
reading workflows) are fine.

**Refactoring.** Extract a `runs` module (in `src/shared` or as a feature that
the three depend on) for the status pill, run links, duration, status options,
display name, suspension helpers, the Stop/Resume/Replay buttons and state
labels. Then add an import-boundary lint rule (L6) so the cycles stay gone.

**Status: done.** `src/features/runs` holds what the three features share
about a run: its status pill and links, duration, label, suspension rules,
state values, failure description, the request helper and the replay and
refresh controls. It imports none of the three; workflows uses runs, and the
history and operations use runs and workflows. There is one `ReplayButton`.
`src/test/architecture.test.ts` fails on a feature cycle, on shared code
importing a feature, and on `runs` importing another feature.

### M6. First load carries editor weight

- `src/bootstrap.tsx` mounts a root `ReactFlowProvider`, which pulls the xyflow
  chunk (57 kB gzipped) into the initial load of about 311 kB gzipped JS. The
  editor wraps its own provider (`WE/index.tsx:222`).
- `bootstrap.tsx` also preloads the validation WASM (4.0 MB, 1.26 MB gzipped)
  on every page.

**Refactoring.** Remove the root provider; anything outside the editor that
needs the canvas already goes through `canvas-bridge.ts`. Start the WASM load
when a route that validates is entered, or on idle. Turn on
`reportCompressedSize` and add a bundle-size check to CI.

**Status: done.** The root `ReactFlowProvider` and the eager WASM load are
gone; the validator is fetched when the editor or a schema-driven form opens.
First load is about 250 kB gzipped, from 311. `scripts/check-bundle-size.mjs`
runs in CI after the build and fails over 280 kB, or if the editor or
validator chunk is in the first load.

### M7. `keepPreviousData` is the default for every query

`useCustomQuery` and `useTableQuery` set `placeholderData: keepPreviousData`
(`src/shared/hooks/api.ts`). A query whose key changes then shows the previous
entity's data until the new one arrives (_inferred_ as a risk on detail pages;
it is the right behaviour for paginated lists).

**Refactoring.** Make it opt-in, and keep it on in `useTableQuery`.

**Status: done.** `useCustomQuery` no longer keeps previous data;
`useTableQuery` does. The four queries that wanted it ask for it, two of them
through `keepPreviousWithin`, which keeps it only within one list.

### M8. Config is resolved as import side effects

`runtimeConfig.ts`, `appBase.ts` and `oidcConfig.ts` compute their values at
import. This forces the two-stage boot in `src/main.tsx`, makes `oidcConfig.ts`
throw at import without OIDC settings (hence the stubs in `vitest.config.ts`),
and creates the cycle hazard that `src/shared/edition/types.ts` documents by
hand.

**Refactoring.** Low urgency, since the constraint is documented and works. If
touched: resolve config once in `main.tsx` and pass it down, or at least guard
the edition cycle with a lint rule.

**Status: done by the second option.** The OIDC settings are built by
`createOidcConfig`,
which the app entry calls as it boots, so importing the module no longer
throws and the test stubs in `vitest.config.ts` are gone. The edition cycle is
guarded: a test follows what each of this repository's editions imports and
fails if it reaches `appBase` or the OIDC settings.

`runtimeConfig.ts` and `appBase.ts` still compute their values at import, and
`main.tsx` still loads the deployment's config before importing the app. That
is the first option of the refactoring above, not taken: the second, the
guard, was, and the import that threw is gone.

### M9. Four form-from-description implementations

1. `src/shared/forms` (`FormRenderer`, `FieldControl`, WASM validation): the
   real schema-driven engine, 13 importing files.
2. `src/shared/components/NextForm`: an older `fieldsConfig` renderer, typed
   `any`, used by `TriggerForm` and as a shell around the editor's `NodeForm`.
3. `WE/NodeForm/InputMappingField/*` (about 6,000 lines): mapping rows for
   capability inputs. A different concern, but it shares no controls with (1).
4. `src/features/objects/components/ObjectInstanceForm`: a hand-written
   `switch(dataType)`.

There are also three `FormSection` components.

**Refactoring.** Retire `NextForm` and `next-dialog` (a 32-line compatibility
wrapper). Move `ObjectInstanceForm` onto `shared/forms`. Merge the
`FormSection` components.

**Status: done for 2 and 4.** `NextForm` and `next-dialog` are gone.
`shared/forms` has `FormShell` (the `<form>` of a react-hook-form, typed by
its values), `FieldList` (a hand-written list of fields from a typed
`FieldConfig`, used by the trigger and step forms) and one `FormSection`
where there were four section components. `ObjectInstanceForm` is a
`FormDefinition` built from the type's columns and drawn by `FormRenderer`:
an enum offers its values, JSON is edited as text, and required columns are
checked. That page was not opened in a browser.

`InputMappingField` (3) is as it was. It maps capability inputs to
references, which `shared/forms` does not model.

### M10. No undo and no tab-close guard in the editor

Edits are immer mutations with no history. In-app navigation is guarded by the
shared blocker, but the editor registers no `beforeunload`; connections and
objects do.

**Refactoring.** Add the `beforeunload` guard now. Undo becomes cheap after H5
and M3, when graph mutations are pure functions over one per-editor store.

**Status: done.** `useWarnBeforeUnload` warns on closing a tab with unsaved
changes; the editor, the object records table and the connection form use it.

Canvas edits can be undone and redone, from the toolbar and the platform's
keys. Every edit already went through `markDirty` or `dirtied`, so the store
remembers the canvas before each there, up to fifty steps; edits within
300 ms of each other are one step, so a drag is undone whole. Workflow
settings staged in the settings dialog are not part of it.

### M11. `operations` ignores the feature conventions

Domain files are flat at the feature root, there is no `hooks/` or `queries/`
folder, shared components are exported from `pages/shared.tsx`, and it uses 21
ad hoc `['operations', …]` query keys with blanket invalidation.

**Refactoring.** Add an `operations` section to `query-keys.ts` and move the
files into the standard folders.

**Status: done.** `queryKeys.operations` replaces the ad hoc arrays, with the
same shapes. The feature has `queries/`, `hooks/`, `utils/` and `components/`.

### M12. Other large components

- `src/features/objects/components/ObjectInstancesTable/index.tsx` (983
  lines): inline editing with a save queue, draft rows, selection, bulk edit,
  CSV import and export, filtering, sorting and pagination in one component.
- `src/features/operations/pages/Queue.tsx` (809 lines): view config, three
  queries, selection, bulk answer and table markup.
- `src/shared/components/ui/condition-editor.tsx` (1,308 lines): the workflow
  condition DSL inside `ui/`. Move it to the workflows feature or a
  `shared/conditions` module.
- `src/shared/components/PayloadExplorer/PayloadExplorer.tsx`: one 720-line
  component in an otherwise well-split module.

**Status: done.** Each was split along the concerns listed, moving code as
it was, with tests for the parts and the browser audit specs run after.

- `ObjectInstancesTable/index.tsx`: 314 lines. View state, row editing, bulk
  actions and export are hooks beside it.
- `operations/pages/Queue.tsx`: 432 lines. The toolbar, bulk bar and table
  are components; what it works out from a view is `utils/queue-view.ts`.
- The condition editor is `src/shared/conditions`, eight files.
- `PayloadExplorer.tsx`: 610 lines. Types, caches, full-value loading and
  the toolbar controls have files of their own.

### M13. Release supply chain

- Actions and base images are pinned by tag, not SHA or digest.
- No signing, SBOM or attestation; the tarball gets only a `.sha256`.
- The tarball and the image come from two independent builds.
- Release re-runs only `npm test`, and does not check that CI was green on the
  tagged commit. The GitHub release is created before the image is built.
- `npm ci --no-audit`, and no dependency-update automation, although
  `package.json` carries 8 undocumented `overrides`.

**Status: done, with the attestation steps untested.** Every action is pinned
to a commit and both base images to a digest; dependabot moves the pins. A
release bundles the console once, the image wraps that bundle
(`BUNDLE=prebuilt` in the `Dockerfile`), and the GitHub release is created
after the image is pushed. The release job runs what a pull request is held
to. The tarball and the image carry a provenance attestation, and the image
an SBOM. CI audits the shipped dependencies.

The image was built both ways locally and its files compared with the
bundle's. The attestation steps need GitHub's signing service and have not
run. The `overrides` in `package.json` are still undocumented.

### M14. Test and tooling gaps

- `e2e/**`, `playwright.config.ts` and `vitest.config.ts` are never
  type-checked, so the mock builders typed against generated DTOs are not
  enforced (47 `as never`/`as any`/`as unknown as` casts in `e2e/`).
- No coverage thresholds, and ESLint warnings do not fail CI.
- Visual snapshots are no-ops: `E2E_VISUAL` is never set and the repository
  has no PNGs.
- Real-backend Playwright projects run in no workflow.
- Unit tests and Playwright share no mock layer.

**Status: partly done.**

- `e2e/**` and `playwright.config.ts` are type-checked (`tsconfig.e2e.json`);
  the 51 errors that surfaced are fixed. `vitest.config.ts` was already
  covered by `tsconfig.node.json`. The casts in `e2e/` are still there (46).
- Coverage has a floor in `vitest.config.ts`, just under what the suite
  covers, and the lint job fails beyond the 21 warnings there are.
- Unit tests and Playwright build the server's objects from the same
  builders, `src/test/builders.ts`.

- `expectMatchesSnapshot` compares wherever a baseline for the platform is
  committed and skips where there is none, with no flag. The **Visual
  baselines** workflow renders them on the runner the mocked job uses.

Not done: no baselines are committed, because that workflow has to run on
GitHub first; and the real-backend projects run in no workflow. They need a
runtara server: its evaluation stack could be started in a job, but that
could not be tried from a developer's machine here, and an untried job was
not added.

## Low priority

- **L1.** `ImprovedEdge` and `AnimatedSVGEdge` are not memoised, and
  `EdgeContextProvider` builds its value inline
  (`WE/CustomEdges/EdgeContext.tsx:60-66`), so every editor render re-renders
  every edge. `AiAgentNode.tsx` and `SwitchNode.tsx` subscribe to the whole
  `nodes` or `edges` arrays.
- **L2.** Seven state-layer files import from `components/`
  (`workflowStore.ts`, `queries/index.ts`, `utils/execution-graph/*`). The
  layout engine and the `SchemaField` type belong outside `components/`.
- **L3.** Three authorization vocabularies coexist: a `cognito:groups` claim
  (`useUserGroups.ts`; every built-in menu entry has an empty `allowedGroups`),
  `/me` permissions (6 uses), and entitlements.
- **L4.** `docker/render-config.sh`: `origin()` accepts any characters outside
  `/?#`, so a malformed operator value can break the CSP header or the nginx
  start. `eventsBaseUrl` is not in `connect-src`. The CSP has no `form-action`.
- **L5.** `CONTRIBUTING.md` and `SECURITY.md` are stale (old repository name,
  supported version `0.1.x`, TODO banners). `.env.example` describes CI secrets
  that no workflow uses.
- **L6.** ESLint has no import-boundary, cycle or type-aware rules, and
  `no-explicit-any` is off. TypeScript lacks `noUncheckedIndexedAccess`;
  `allowJs` is on with no JS in `src`.
- **L7.** Stale ignores for `dev-dist` and `storybook-static`; `api.fixture.ts`
  is legacy but still merged into the e2e fixtures.
- **L8.** `WF/utils/sse.ts:70` logs every chunk with `console.debug`.
- **L9.** Dependencies a major behind: React 18, Tailwind 3, zustand 4,
  recharts 2.

## Suggested order

Each phase leaves the tree shippable.

1. **Gate what already exists** (H3, parts of M14). Audit suite in CI, client
   drift check, example edition with a CI job, type-check `e2e/`. No product
   code changes, and every later phase is safer for it.
2. **Unify the HTTP layer** (H4, M4, M7). Auth interceptor, one streaming fetch
   wrapper, `queryClient` out of `bootstrap`, `keepPreviousData` opt-in.
3. **Type the DSL** (H2). Server schema change, regenerate, converter typed
   against `Step`, `node.data` split.
4. **Step-type registry** (H1), one step type at a time on top of phase 3.
5. **Split the editor modules** (H5, M1, M2, M3, M10). Tests for the save
   pipeline first; then hooks per seam, pure geometry, per-editor stores.
6. **Runs module and boundaries** (M5, M11, L6). Extract `runs`, bring
   `operations` into line, add the import-boundary rule.
7. **Opportunistic** (M6, M9, M12, M13 and the low-priority list), as the
   surrounding code is touched.
