import { createContext, useContext } from 'react';
import { useStore, type StoreApi, type UseBoundStore } from 'zustand';

// The editor's stores, one set per mounted editor.
//
// A store declared with `editorStore` is created when an editor first needs
// it and dropped when that editor unmounts, so another workflow cannot find
// the last one's state: there is nothing to reset. Components read the set of
// the `EditorStoresProvider` above them. Code outside React (`getState`,
// `setState`, `subscribe`) reaches the set of the editor on screen.
//
// With no provider mounted there is still one set, the default: what a unit
// test, or a component used outside an editor, works with.

export type EditorScope = Map<string, StoreApi<unknown>>;
type Scope = EditorScope;

const defaultScope: Scope = new Map();
/** The set imperative code reaches: the mounted editor's, or the default. */
let activeScope: Scope = defaultScope;

export const EditorScopeContext = createContext<Scope | null>(null);
const ScopeContext = EditorScopeContext;

/** Makes `scope` the set imperative code reaches. */
export function activateEditorScope(scope: EditorScope) {
  activeScope = scope;
}

/** Hands imperative code back to the default set, if `scope` still has it. */
export function deactivateEditorScope(scope: EditorScope) {
  if (activeScope === scope) activeScope = defaultScope;
}

function storeIn<Api extends StoreApi<unknown>>(
  scope: Scope,
  key: string,
  create: () => Api
): Api {
  let store = scope.get(key) as Api | undefined;
  if (!store) {
    store = create();
    scope.set(key, store);
  }
  return store;
}

/**
 * Declares a store of the editor. The result is used like a store made with
 * zustand's `create`: a hook with `getState`, `setState` and `subscribe`.
 * `key` names it within an editor's set.
 */
export function editorStore<Api extends StoreApi<any>>(
  key: string,
  create: () => Api
): UseBoundStore<Api> {
  type State = ReturnType<Api['getState']>;

  function useEditorStore<T>(selector?: (state: State) => T) {
    const scope = useContext(ScopeContext) ?? activeScope;
    const store = storeIn(scope, key, create);
    return useStore(
      store as StoreApi<State>,
      selector ?? ((state: State) => state as T)
    );
  }

  const onActive =
    (method: 'getState' | 'setState' | 'subscribe' | 'getInitialState') =>
    (...args: unknown[]) => {
      const store = storeIn(activeScope, key, create) as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      return store[method](...args);
    };

  return Object.assign(useEditorStore, {
    getState: onActive('getState'),
    setState: onActive('setState'),
    subscribe: onActive('subscribe'),
    getInitialState: onActive('getInitialState'),
  }) as unknown as UseBoundStore<Api>;
}
