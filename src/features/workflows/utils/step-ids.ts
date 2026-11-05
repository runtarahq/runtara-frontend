import { canvasNodeStepId } from './execution-graph/canvas-ids';

/**
 * Allowed charset for user-supplied step ids.
 *
 * The DSL validator (crates/runtara-workflows/src/validation.rs) does not
 * enforce an explicit charset, but reference parsing constrains it:
 * - dot form `steps.<id>.` terminates the id at the first `.`
 * - bracket form `steps['<id>']` terminates at `']` (quotes/brackets illegal)
 * This pattern is safe for both forms and for minijinja templates.
 */
export const STEP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Implicit step ids injected by the runtime (RESERVED_STEP_IDS in
 * crates/runtara-workflows/src/validation.rs, rejected at save as E136).
 * Renaming a step to one of these would shadow the implicit onError envelope.
 */
const RESERVED_STEP_IDS = new Set(['__error', 'error']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite every step-reference occurrence of `oldId` to `newId` inside a
 * string. Handles all reference forms that appear in mapping values,
 * condition arguments, and {{ ... }} template strings:
 * - dot form: `steps.<id>` (followed by a non-id char or end of string)
 * - bracket form: `steps['<id>']` and `steps["<id>"]`
 *
 * Boundary-safe: an id that is a prefix of another id (`a` vs `ab`) never
 * corrupts the longer id, because the dot form requires the next char to be
 * outside the id charset and the bracket form is delimited by the quote.
 */
export function rewriteStepReferencesInString(
  text: string,
  oldId: string,
  newId: string
): string {
  const escaped = escapeRegExp(oldId);
  // `(?<![\w.])` prevents matching inside other identifiers (e.g. `mysteps.a`
  // or `foo.steps.a`); `(?![A-Za-z0-9_-])` prevents matching id prefixes.
  const dotForm = new RegExp(
    `(?<![\\w.])steps\\.${escaped}(?![A-Za-z0-9_-])`,
    'g'
  );
  const bracketForm = new RegExp(
    `(?<![\\w.])steps\\[(['"])${escaped}\\1\\]`,
    'g'
  );
  return text
    .replace(dotForm, `steps.${newId}`)
    .replace(bracketForm, (_match, quote: string) => {
      return `steps[${quote}${newId}${quote}]`;
    });
}

/**
 * Deep-walk an arbitrary JSON-ish value (node/edge data, mapping values,
 * conditions, templates) and rewrite step references in every string.
 */
export function rewriteStepReferencesDeep(
  value: unknown,
  oldId: string,
  newId: string
): unknown {
  if (typeof value === 'string') {
    return rewriteStepReferencesInString(value, oldId, newId);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteStepReferencesDeep(item, oldId, newId));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = rewriteStepReferencesDeep(entry, oldId, newId);
    }
    return result;
  }
  return value;
}

/**
 * Validate a candidate step id for a rename. Returns an error message, or
 * null when the candidate is acceptable. Exposed so the editor UI can show
 * inline errors with the exact same rules the store enforces.
 */
export function getStepIdValidationError(
  candidate: string,
  currentId: string,
  existingIds: Iterable<string>
): string | null {
  if (!candidate) {
    return 'Step id cannot be empty';
  }
  if (candidate === currentId) {
    return 'New step id is the same as the current id';
  }
  if (!STEP_ID_PATTERN.test(candidate)) {
    return 'Step id may only contain letters, numbers, hyphens, and underscores';
  }
  if (RESERVED_STEP_IDS.has(candidate)) {
    return `'${candidate}' is reserved by the runtime`;
  }
  for (const id of existingIds) {
    // A qualified canvas node id also claims its real step id.
    if (
      id === candidate ||
      (id !== currentId && canvasNodeStepId(id) === candidate)
    ) {
      return `A step with id '${candidate}' already exists`;
    }
  }
  return null;
}

/**
 * Derive a readable step id from a step's display name.
 *
 * Steps have exactly one identifier — the key in `steps` — and DSL/MCP authors
 * write a readable slug into it (`fetch_csv`, `parse_csv`, `finish`). The editor
 * used to mint a UUID there instead, which then surfaced verbatim in reference
 * paths (`steps['b7514123-…'].outputs`) and in server diagnostics. This produces
 * the DSL-style id for steps created on the canvas.
 *
 * snake_case rather than kebab: it keeps the dot reference form `steps.<id>` a
 * legal identifier (for minijinja templates), and keeps hyphens out of ids that
 * are interpolated into `${from}-${to}-${label}` edge ids.
 *
 * `existingIds` must cover the whole canvas — including nested container
 * children — because a step id is also the React Flow node id, which is global.
 */
export function generateStepId(
  name: string | undefined,
  existingIds: Iterable<string>
): string {
  let base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // A leading digit is legal in `steps['2fa']` but not in the dot form, so
  // qualify it rather than emitting an id that only works when bracketed.
  if (/^[0-9]/.test(base)) {
    base = `step_${base}`;
  }
  if (!base) {
    base = 'step';
  }

  // A qualified canvas node id also claims its real step id.
  const taken = new Set(
    [...existingIds].flatMap((id) => [id, canvasNodeStepId(id)])
  );
  let candidate = base;
  // Matches generateUniqueStepName's display-name convention: the second
  // "Log" is "Log 2", so its id is `log_2`.
  let counter = 2;
  while (taken.has(candidate) || RESERVED_STEP_IDS.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}
