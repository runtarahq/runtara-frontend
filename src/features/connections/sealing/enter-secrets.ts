/**
 * A connection's secrets are sealed in the browser before they are sent
 * (docs/sealed-secrets.md). In the request, each holds a marker where its
 * value was; the values go sealed, in one envelope, beside it.
 */

/** The secrets a request enters, by the name the request has for each. */
export type EnteredSecrets = Record<string, string>;

/** How many secrets one save may enter: what one envelope holds. */
export const MAX_ENTERED_SECRETS = 16;

const PG_URL_FIELD = 'database_url';
const PG_TARGET_FIELD = 'database_target';
const EXTRA_HEADERS_FIELD = 'extra_headers';

/** A save that was stopped before anything was sent, with why. */
export class SecretEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretEntryError';
  }
}

/** What a request holds in place of a secret sealed beside it. */
export function enteredMarker(): { $entered: true } {
  return { $entered: true };
}

/**
 * The fields of a connection type whose values are sent sealed: its
 * `sealedFields`. Not every field the form marks secret is one (a
 * certificate is kept off the screen and still sent as it is), so the server
 * says which. A type that does not say is of a server that takes no sealed
 * secret, and nothing is sent to it.
 */
export function sealedFieldsOf(
  connectionType: { sealedFields?: string[] | null } | null | undefined
): readonly string[] {
  const fields = connectionType?.sealedFields;
  if (!Array.isArray(fields)) {
    throw new SecretEntryError(
      'This server does not say which fields are sealed, so nothing was saved. The console needs a newer server.'
    );
  }
  return fields;
}

/**
 * A Postgres URL's password, and the URL without it, as it was typed: only
 * the password is removed. Null for what holds no password to remove.
 */
export function splitPostgresUrl(
  url: string
): { password: string; target: string } | null {
  const match = /^(\s*[a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/is.exec(url);
  if (!match) return null;
  const [, scheme, authority, rest] = match;
  const at = authority.lastIndexOf('@');
  if (at < 0) return null;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return null;
  const typed = userinfo.slice(colon + 1);
  if (!typed) return null;
  let password = typed;
  try {
    password = decodeURIComponent(typed);
  } catch {
    // Not percent-encoded: it is the password as it stands.
  }
  return {
    password,
    target: `${scheme}${userinfo.slice(0, colon)}${authority.slice(at)}${rest}`,
  };
}

function filled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * `parameters` with a marker in place of each secret, and the secrets taken
 * out of it. `parameters` is a create's `connectionParameters`, or one of an
 * update's `write` and `set`. `beside` is what goes next to them readable: a
 * Postgres URL without its password.
 *
 * A blank secret is left as it is, and is not marked.
 */
export function enterSecrets(
  integrationId: string | null | undefined,
  sealedFields: readonly string[],
  parameters: Record<string, unknown>
): {
  parameters: Record<string, unknown>;
  secrets: EnteredSecrets;
  beside: Record<string, unknown>;
} {
  const entered: Record<string, unknown> = {};
  const secrets: EnteredSecrets = {};
  const beside: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(parameters)) {
    if (
      integrationId === 'mcp' &&
      name === EXTRA_HEADERS_FIELD &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      // Each header's value is a secret. One left blank is the one the
      // connection holds already.
      const headers: Record<string, unknown> = {};
      for (const [header, held] of Object.entries(value)) {
        const text =
          typeof held === 'number' || typeof held === 'boolean'
            ? String(held)
            : held;
        if (filled(text)) {
          headers[header] = enteredMarker();
          secrets[`${EXTRA_HEADERS_FIELD}.${header}`] = text;
        } else {
          headers[header] = held;
        }
      }
      entered[name] = headers;
      continue;
    }
    if (!sealedFields.includes(name) || !filled(value)) {
      entered[name] = value;
      continue;
    }
    if (integrationId === 'postgres' && name === PG_URL_FIELD) {
      const split = splitPostgresUrl(value);
      if (!split) {
        throw new SecretEntryError(
          'The database URL needs a user and a password: postgres://user:password@host/database'
        );
      }
      entered[name] = enteredMarker();
      secrets[name] = split.password;
      beside[PG_TARGET_FIELD] = split.target;
      continue;
    }
    entered[name] = enteredMarker();
    secrets[name] = value;
  }

  return { parameters: entered, secrets, beside };
}

/** An update's parameter patch with each secret it enters marked. */
export function enterPatchSecrets(
  integrationId: string | null | undefined,
  sealedFields: readonly string[],
  patch: {
    set: Record<string, unknown>;
    write: Record<string, unknown>;
    clear: string[];
  }
): {
  patch: {
    set: Record<string, unknown>;
    write: Record<string, unknown>;
    clear: string[];
  };
  secrets: EnteredSecrets;
} {
  const write = enterSecrets(integrationId, sealedFields, patch.write);
  const set = enterSecrets(integrationId, sealedFields, patch.set);
  return {
    patch: {
      set: { ...set.parameters, ...write.beside, ...set.beside },
      write: write.parameters,
      clear: patch.clear,
    },
    secrets: { ...write.secrets, ...set.secrets },
  };
}
