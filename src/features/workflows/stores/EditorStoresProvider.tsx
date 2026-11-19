import { useLayoutEffect, useState, type ReactNode } from 'react';

import {
  EditorScopeContext,
  activateEditorScope,
  deactivateEditorScope,
  type EditorScope,
} from './editor-scope';

/**
 * Gives the editor below it stores of its own, for as long as it is mounted.
 * Keyed by what is being edited, a change of workflow starts from new ones.
 */
export function EditorStoresProvider({ children }: { children: ReactNode }) {
  const [scope] = useState<EditorScope>(() => new Map());

  // Before the children render: they may reach a store outside React as they
  // do, and must find this editor's.
  activateEditorScope(scope);
  useLayoutEffect(() => {
    activateEditorScope(scope);
    return () => deactivateEditorScope(scope);
  }, [scope]);

  return (
    <EditorScopeContext.Provider value={scope}>
      {children}
    </EditorScopeContext.Provider>
  );
}
