/** Who started a flow, from its `channel:id` label. */
export function describeStarter(startedBy: string): string {
  const [channel, ...rest] = startedBy.split(':');
  const who = rest.join(':');
  switch (channel) {
    case 'api_key':
      return `an API key of ${who}`;
    case 'mcp':
      return `an MCP client of ${who}`;
    case 'member':
      return who;
    default:
      return startedBy || 'someone';
  }
}
