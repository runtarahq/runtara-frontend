/**
 * A run a conversation started is given that conversation in its input
 * (`data.conversation`). This is its key, or `null` for a run that nothing
 * of the kind started.
 */
export function conversationKeyOfRun(
  run: { inputs?: unknown } | null | undefined
): string | null {
  const inputs = run?.inputs as
    { data?: { conversation?: { key?: unknown } } | null } | null | undefined;
  const key = inputs?.data?.conversation?.key;
  return typeof key === 'string' && key ? key : null;
}

/** Where a workflow's conversation is shown. */
export function conversationPath(workflowId: string, key: string): string {
  return `/workflows/${workflowId}/chat/c/${encodeURIComponent(key)}`;
}
