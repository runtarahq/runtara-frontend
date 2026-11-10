import { createContext, useContext } from 'react';

interface NodeConfigContextValue {
  openNodeConfig: (nodeId: string) => void;
  /**
   * Opens an AI Agent's editor on memory just added to it. Leaving that
   * editor without Save runs `revert`, which takes the memory back out.
   */
  configureNewMemory: (agentId: string, revert: () => void) => void;
}

const NodeConfigContext = createContext<NodeConfigContextValue>({
  openNodeConfig: () => {},
  configureNewMemory: () => {},
});

export const NodeConfigProvider = NodeConfigContext.Provider;

export function useNodeConfigContext() {
  return useContext(NodeConfigContext);
}
