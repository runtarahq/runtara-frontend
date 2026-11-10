import { useEffect, useMemo, useRef, useState } from 'react';

import type { FormDefinition, FormOption, OptionResolver } from './types';

export interface ResolvedOptionsState {
  options: Record<string, FormOption[]>;
  loading: ReadonlySet<string>;
  errors: Record<string, string>;
}

const EMPTY_STATE: ResolvedOptionsState = {
  options: {},
  loading: new Set<string>(),
  errors: {},
};

/**
 * Resolve dynamic choices declared by `control.optionResolver`.
 *
 * Only declared dependencies participate in the cache key. Requests are
 * aborted when their schema/dependencies change, so slow provider responses
 * cannot overwrite newer choices.
 */
export function useResolvedOptions(
  definition: FormDefinition,
  currentData: Record<string, unknown>,
  resolver?: OptionResolver
): ResolvedOptionsState {
  const currentDataRef = useRef(currentData);
  currentDataRef.current = currentData;
  const definitionJson = JSON.stringify(definition);
  const requestsJson = useMemo(() => {
    if (!resolver) return '[]';
    const requests = Object.entries(definition.fields)
      .filter(([, field]) => Boolean(field.control?.optionResolver))
      .map(([fieldName, field]) => ({
        fieldName,
        resolverKey: field.control?.optionResolver,
        dependencies: Object.fromEntries(
          (field.control?.optionDependencies ?? []).map((name) => [
            name,
            currentData[name],
          ])
        ),
      }));
    return JSON.stringify(requests);
  }, [definition.fields, currentData, resolver]);
  const [state, setState] = useState<ResolvedOptionsState>(EMPTY_STATE);
  // Each field's last request (resolver and dependencies). A field is asked
  // again only when its own request changed, so one field's dependency change
  // leaves the other fields' choices alone (SH-5).
  const fieldKeysRef = useRef<Record<string, string>>({});
  const definitionRef = useRef('');

  useEffect(() => {
    if (!resolver) {
      fieldKeysRef.current = {};
      setState(EMPTY_STATE);
      return;
    }

    const definitionSnapshot = JSON.parse(definitionJson) as FormDefinition;
    const requests = JSON.parse(requestsJson) as Array<{
      fieldName: string;
      resolverKey: string;
    }>;
    const definitionChanged = definitionRef.current !== definitionJson;
    definitionRef.current = definitionJson;
    const previousKeys = fieldKeysRef.current;
    const nextKeys = Object.fromEntries(
      requests.map((r) => [r.fieldName, JSON.stringify(r)])
    );
    fieldKeysRef.current = nextKeys;
    const due = requests.filter(
      (r) =>
        definitionChanged || previousKeys[r.fieldName] !== nextKeys[r.fieldName]
    );
    const dueNames = new Set(due.map((r) => r.fieldName));
    const kept = (name: string) => name in nextKeys && !dueNames.has(name);

    setState((prev) => ({
      options: pickKeys(prev.options, kept),
      errors: pickKeys(prev.errors, kept),
      loading: dueNames,
    }));
    if (due.length === 0) return;

    const controller = new AbortController();
    let answered = false;
    const currentDataSnapshot = currentDataRef.current;
    void Promise.allSettled(
      due.map(async ({ fieldName, resolverKey }) => ({
        fieldName,
        options: await resolver({
          resolverKey,
          fieldName,
          field: definitionSnapshot.fields[fieldName],
          currentData: currentDataSnapshot,
          signal: controller.signal,
        }),
      }))
    ).then((results) => {
      if (controller.signal.aborted) return;
      answered = true;
      const options: Record<string, FormOption[]> = {};
      const errors: Record<string, string> = {};
      results.forEach((result, index) => {
        const fieldName = due[index].fieldName;
        if (result.status === 'fulfilled') {
          options[fieldName] = result.value.options;
        } else {
          errors[fieldName] =
            result.reason instanceof Error
              ? result.reason.message
              : 'Could not load options.';
        }
      });
      setState((prev) => ({
        options: { ...prev.options, ...options },
        errors: { ...prev.errors, ...errors },
        loading: new Set(
          [...prev.loading].filter((name) => !dueNames.has(name))
        ),
      }));
    });

    return () => {
      controller.abort();
      // Fields still loading have lost their answer: ask again next time.
      if (!answered) {
        for (const name of dueNames) delete fieldKeysRef.current[name];
      }
    };
  }, [definitionJson, requestsJson, resolver]);

  return state;
}

function pickKeys<T>(
  record: Record<string, T>,
  keep: (name: string) => boolean
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([name]) => keep(name))
  );
}
