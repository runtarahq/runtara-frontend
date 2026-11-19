import { describe, expect, it } from 'vitest';
import { queryKeys } from './query-keys';

describe('queryKeys', () => {
  describe('connections', () => {
    it('returns correct base key for all connections', () => {
      expect(queryKeys.connections.all).toEqual(['connections']);
    });

    it('returns correct key for connection lists', () => {
      expect(queryKeys.connections.lists()).toEqual(['connections', 'list']);
    });

    it('returns correct key for filtered list', () => {
      const filters = { status: 'active' };
      expect(queryKeys.connections.list(filters)).toEqual([
        'connections',
        'list',
        filters,
      ]);
    });

    it('returns correct key for connection by ID', () => {
      expect(queryKeys.connections.byId('conn-123')).toEqual([
        'connections',
        'detail',
        'conn-123',
      ]);
    });

    it('returns correct key for connections by operator', () => {
      expect(queryKeys.connections.byOperator('op-456')).toEqual([
        'connections',
        'byOperator',
        'op-456',
      ]);
    });

    it('returns correct key for connection types', () => {
      expect(queryKeys.connections.types()).toEqual(['connectionTypes']);
    });
  });

  describe('triggers', () => {
    it('returns correct base key for all triggers', () => {
      expect(queryKeys.triggers.all).toEqual(['triggers']);
    });

    it('returns correct key for trigger by ID', () => {
      expect(queryKeys.triggers.byId('trigger-123')).toEqual([
        'triggers',
        'detail',
        'trigger-123',
      ]);
    });

    it('returns correct key for trigger lists', () => {
      expect(queryKeys.triggers.lists()).toEqual(['triggers', 'list']);
    });
  });

  describe('workflows', () => {
    it('returns correct base key for all workflows', () => {
      expect(queryKeys.workflows.all).toEqual(['workflows']);
    });

    it('returns correct key for workflow by ID', () => {
      expect(queryKeys.workflows.byId('scen-123')).toEqual([
        'workflows',
        'detail',
        'scen-123',
      ]);
    });

    it('returns correct key for workflow workflow', () => {
      expect(queryKeys.workflows.workflow('scen-123')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'workflow',
      ]);
    });

    it('returns correct key for workflow versions', () => {
      expect(queryKeys.workflows.versions('scen-123')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'versions',
      ]);
    });

    it('returns correct key for workflow instances', () => {
      expect(queryKeys.workflows.instances('scen-123')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'instances',
      ]);
    });

    it('returns correct key for specific workflow instance', () => {
      expect(queryKeys.workflows.instance('scen-123', 'inst-456')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'instances',
        'inst-456',
      ]);
    });

    it('returns correct key for step types', () => {
      expect(queryKeys.workflows.stepTypes()).toEqual([
        'workflows',
        'stepTypes',
      ]);
    });

    it('returns correct key for workflow logs', () => {
      expect(queryKeys.workflows.logs('inst-123')).toEqual([
        'workflows',
        'logs',
        'inst-123',
      ]);
    });

    it('returns correct key for step subinstances', () => {
      expect(
        queryKeys.workflows.stepSubinstances('inst-123', 'step-456')
      ).toEqual(['workflows', 'stepSubinstances', 'inst-123', 'step-456']);
    });

    it('returns correct key for step events', () => {
      expect(
        queryKeys.workflows.stepEvents('scen-1', 'inst-123', 'step-456')
      ).toEqual(['workflows', 'stepEvents', 'scen-1', 'inst-123', 'step-456']);
    });

    it('returns correct key for workflow without version', () => {
      expect(queryKeys.workflows.workflow('scen-123')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'workflow',
      ]);
    });

    it('returns correct key for workflow with version', () => {
      expect(queryKeys.workflows.workflow('scen-123', 5)).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'workflow',
        5,
      ]);
    });

    it('returns correct key for pending input', () => {
      expect(queryKeys.workflows.pendingInput('scen-123', 'inst-456')).toEqual([
        'workflows',
        'detail',
        'scen-123',
        'instances',
        'inst-456',
        'pendingInput',
      ]);
    });

    it('returns correct key for step summaries', () => {
      const filters = { limit: 100 };
      expect(
        queryKeys.workflows.stepSummaries('scen-123', 'inst-456', filters)
      ).toEqual([
        'workflows',
        'stepSummaries',
        'scen-123',
        'inst-456',
        filters,
      ]);
    });
  });

  describe('executions', () => {
    it('returns correct base key for all executions', () => {
      expect(queryKeys.executions.all).toEqual(['executions']);
    });

    it('returns correct key for execution list with params', () => {
      const params = {
        pageIndex: 0,
        pageSize: 10,
        filters: { status: 'done' },
      };
      expect(queryKeys.executions.list(params)).toEqual([
        'executions',
        'list',
        params,
      ]);
    });
  });

  describe('objects', () => {
    describe('schemas', () => {
      it('returns correct base key for all schemas', () => {
        expect(queryKeys.objects.schemas.all()).toEqual([
          'objects',
          'schemas',
          null,
        ]);
      });

      it('returns correct key for schema by ID', () => {
        expect(queryKeys.objects.schemas.byId('schema-123')).toEqual([
          'objects',
          'schemas',
          null,
          'detail',
          'schema-123',
        ]);
      });

      it('includes the database connection in schema keys', () => {
        expect(queryKeys.objects.schemas.byId('schema-123', 'conn-1')).toEqual([
          'objects',
          'schemas',
          'conn-1',
          'detail',
          'schema-123',
        ]);
      });

      it('returns correct key for schema lists', () => {
        expect(queryKeys.objects.schemas.lists()).toEqual([
          'objects',
          'schemas',
          null,
          'list',
        ]);
      });
    });

    describe('instances', () => {
      it('returns correct base key for all instances', () => {
        expect(queryKeys.objects.instances.all()).toEqual([
          'objects',
          'instances',
          null,
        ]);
      });

      it('returns correct key for instances by schema', () => {
        expect(queryKeys.objects.instances.bySchema('schema-123')).toEqual([
          'objects',
          'instances',
          null,
          'schema-123',
        ]);
      });

      it('returns correct key for instance list with params', () => {
        const params = { page: 0, size: 20 };
        expect(queryKeys.objects.instances.list('schema-123', params)).toEqual([
          'objects',
          'instances',
          null,
          'schema-123',
          params,
        ]);
      });

      it('includes the database connection in instance keys', () => {
        const params = { connectionId: 'conn-1', page: 0, size: 20 };
        expect(queryKeys.objects.instances.list('schema-123', params)).toEqual([
          'objects',
          'instances',
          'conn-1',
          'schema-123',
          params,
        ]);
      });

      it('returns correct key for instance by ID', () => {
        expect(
          queryKeys.objects.instances.byId('schema-123', 'inst-456')
        ).toEqual(['objects', 'instances', null, 'schema-123', 'inst-456']);
      });
    });
  });

  describe('agents', () => {
    it('returns correct base key for all agents', () => {
      expect(queryKeys.agents.all).toEqual(['agents']);
    });

    it('returns correct key for agent by ID', () => {
      expect(queryKeys.agents.byId('agent-123')).toEqual([
        'agents',
        'detail',
        'agent-123',
      ]);
    });

    it('returns correct key for agents with connections', () => {
      expect(queryKeys.agents.withConnections()).toEqual([
        'agents',
        'withConnections',
      ]);
    });

    it('returns correct key for connections by agent', () => {
      expect(queryKeys.agents.connectionsByAgent('agent-123')).toEqual([
        'agents',
        'detail',
        'agent-123',
        'connections',
      ]);
    });

    it('returns correct key for integration entities by agent', () => {
      expect(queryKeys.agents.integrationEntities('agent-123')).toEqual([
        'agents',
        'detail',
        'agent-123',
        'integrationEntities',
      ]);
    });

    it('returns correct key for test agent', () => {
      expect(queryKeys.agents.test('agent-123')).toEqual([
        'agents',
        'detail',
        'agent-123',
        'test',
      ]);
    });
  });

  describe('integrations', () => {
    it('returns correct base key for all integrations', () => {
      expect(queryKeys.integrations.all).toEqual(['integrations']);
    });

    it('returns correct key for auth redirect', () => {
      const params = { provider: 'google' };
      expect(queryKeys.integrations.authRedirect(params)).toEqual([
        'integrations',
        'authRedirect',
        params,
      ]);
    });
  });

  describe('analytics', () => {
    it('returns correct base key for all analytics', () => {
      expect(queryKeys.analytics.all).toEqual(['analytics']);
    });

    it('returns correct key for tenant analytics', () => {
      expect(queryKeys.analytics.tenant('7d', '24m')).toEqual([
        'analytics',
        'tenant',
        '7d',
        '24m',
      ]);
    });

    it('separates tenant analytics cached at different bucket widths', () => {
      // The same period can be requested at different granularities, and the
      // responses are not interchangeable - one is a 421-bucket series, the
      // other 169. Sharing a cache entry would render one as the other.
      expect(queryKeys.analytics.tenant('7d', '24m')).not.toEqual(
        queryKeys.analytics.tenant('7d', 'hourly')
      );
    });

    it('returns correct key for workflow analytics', () => {
      expect(
        queryKeys.analytics.workflow('scen-123', '7d', 1, 'hourly')
      ).toEqual(['analytics', 'workflow', 'scen-123', '7d', 1, 'hourly']);
    });

    it('returns correct key for workflow stats', () => {
      expect(queryKeys.analytics.workflowStats('scen-123', 2)).toEqual([
        'analytics',
        'workflowStats',
        'scen-123',
        2,
      ]);
    });

    it('returns correct key for side effects', () => {
      expect(queryKeys.analytics.sideEffects('scen-123', 1)).toEqual([
        'analytics',
        'sideEffects',
        'scen-123',
        1,
      ]);
    });

    it('returns correct key for system analytics', () => {
      expect(queryKeys.analytics.system()).toEqual(['analytics', 'system']);
    });
  });

  describe('query key hierarchy for invalidation', () => {
    it('allows invalidating all connections with base key', () => {
      const allKey = queryKeys.connections.all;
      const detailKey = queryKeys.connections.byId('123');
      const listKey = queryKeys.connections.lists();

      // Detail and list keys should start with the base key
      expect(detailKey.slice(0, 1)).toEqual(allKey);
      expect(listKey.slice(0, 1)).toEqual(allKey);
    });

    it('allows invalidating all object instances for a schema', () => {
      const schemaKey = queryKeys.objects.instances.bySchema('schema-1');
      const instanceKey = queryKeys.objects.instances.byId(
        'schema-1',
        'inst-1'
      );
      const listKey = queryKeys.objects.instances.list('schema-1', { page: 0 });

      // Instance and list keys should start with the schema key
      expect(instanceKey.slice(0, schemaKey.length)).toEqual(schemaKey);
      expect(listKey.slice(0, schemaKey.length)).toEqual(schemaKey);
    });
  });

  describe('operations', () => {
    const tenant = 'acme';

    it('puts every key under the feature, then the tenant', () => {
      const keys = [
        queryKeys.operations.queues(tenant),
        queryKeys.operations.views(tenant),
        queryKeys.operations.processes(tenant),
        queryKeys.operations.overviewFailures(tenant),
        queryKeys.operations.runningCount(tenant),
        queryKeys.operations.invocations24h(tenant),
        queryKeys.operations.recentRuns(tenant),
        queryKeys.operations.attention(tenant, []),
        queryKeys.operations.items(tenant, {}, 0, '', false),
        queryKeys.operations.queueCounts(tenant, {}),
        queryKeys.operations.requestList(tenant, [], false, 0),
        queryKeys.operations.run(tenant, 'wf', 'run'),
        queryKeys.operations.runPendingInput(tenant, 'wf', 'run'),
        queryKeys.operations.runActivity(tenant, 'wf', 'run'),
      ];
      for (const key of keys) {
        expect(key.slice(0, 2)).toEqual(['operations', tenant]);
      }
      // No two of them are one key.
      expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(
        keys.length
      );
    });

    it('keeps a tenant apart from another, and from the whole feature', () => {
      expect(queryKeys.operations.all).toEqual(['operations']);
      expect(queryKeys.operations.tenant(tenant)).toEqual([
        'operations',
        tenant,
      ]);
      expect(queryKeys.operations.queues('other')).not.toEqual(
        queryKeys.operations.queues(tenant)
      );
    });

    it("keeps a request list's filter and page where its placeholder reads them", () => {
      // Requests.tsx keeps its rows across a refresh by comparing these two.
      const key = queryKeys.operations.requestList(tenant, ['scope'], true, 3);
      expect(key[4]).toBe(true);
      expect(key[5]).toBe(3);
    });

    it('names a run by its workflow and instance', () => {
      expect(queryKeys.operations.run(tenant, 'wf-1', 'run-1')).toEqual([
        'operations',
        tenant,
        'run',
        'wf-1',
        'run-1',
      ]);
    });
  });
});
