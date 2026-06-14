// @ts-nocheck
export const WORLDLINE_PLUGIN = {
  id: 'system.worldline',
  name: 'Savepoint / Branch Worldline Tools',
  version: '0.1.0',
  description: 'Create savepoints, branch worldlines, and switch or restore narrative state snapshots.',
  enabled: true,
  permissions: ['worldline:read', 'worldline:write', 'worldline:restore'],
  tools: [
    {
      name: 'describe_worldlines',
      title: 'Describe Worldlines',
      description: 'Describe savepoint and branch worldline behavior.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['worldline', 'help']
    },
    {
      name: 'create_savepoint',
      title: 'Create Savepoint',
      description: 'Create a savepoint for a runtime session or app chat, including selected RAG memory collections and audit references.',
      inputSchema: savepointSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      tags: ['worldline', 'savepoint', 'snapshot']
    },
    {
      name: 'list_savepoints',
      title: 'List Savepoints',
      description: 'List savepoints by scope or branch.',
      inputSchema: {
        type: 'object',
        properties: {
          scopeType: { type: 'string' },
          scopeId: { type: 'string' },
          branchId: { type: 'string' },
          includeSnapshot: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['worldline', 'savepoint', 'query']
    },
    {
      name: 'get_savepoint',
      title: 'Get Savepoint',
      description: 'Read one savepoint and optionally include the full snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          includeSnapshot: { type: 'boolean', default: true }
        },
        required: ['id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['worldline', 'savepoint', 'query']
    },
    {
      name: 'restore_savepoint',
      title: 'Restore Savepoint',
      description: 'Restore a savepoint. This rewrites chat/runtime/RAG state and requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          actor: { type: 'string' },
          reason: { type: 'string' },
          setActiveBranch: { type: 'boolean', default: true },
          branchId: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        destructive: true
      },
      tags: ['worldline', 'savepoint', 'restore']
    },
    {
      name: 'create_branch',
      title: 'Create Branch',
      description: 'Create a branch worldline from a savepoint, optionally switching to it.',
      inputSchema: {
        type: 'object',
        properties: {
          fromSavepointId: { type: 'string', minLength: 1 },
          sourceSavepointId: { type: 'string' },
          name: { type: 'string' },
          label: { type: 'string' },
          parentBranchId: { type: 'string' },
          switchTo: { type: 'boolean', default: false },
          restore: { type: 'boolean', default: false },
          actor: { type: 'string' },
          reason: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      tags: ['worldline', 'branch']
    },
    {
      name: 'list_branches',
      title: 'List Branches',
      description: 'List branch worldlines by scope.',
      inputSchema: {
        type: 'object',
        properties: {
          scopeType: { type: 'string' },
          scopeId: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['worldline', 'branch', 'query']
    },
    {
      name: 'get_branch',
      title: 'Get Branch',
      description: 'Read one branch worldline.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['worldline', 'branch', 'query']
    },
    {
      name: 'switch_branch',
      title: 'Switch Branch',
      description: 'Switch to a branch worldline by restoring its head savepoint. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          savepointId: { type: 'string' },
          actor: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        destructive: true
      },
      tags: ['worldline', 'branch', 'switch']
    }
  ]
};

export function createWorldlineHandlers({ runtime } = {}) {
  if (!runtime) throw new TypeError('createWorldlineHandlers requires runtime');
  return {
    describe_worldlines: async () => runtime.describeWorldlines(),
    create_savepoint: async ({ input }) => runtime.createWorldlineSavepoint(input),
    list_savepoints: async ({ input }) => ({ savepoints: runtime.listWorldlineSavepoints(input) }),
    get_savepoint: async ({ input }) => ({ savepoint: runtime.getWorldlineSavepoint(input.id, {
      includeSnapshot: input.includeSnapshot !== false
    }) }),
    restore_savepoint: async ({ input }) => runtime.restoreWorldlineSavepoint(input.id, {
      actor: input.actor || 'user',
      reason: input.reason,
      setActiveBranch: input.setActiveBranch !== false,
      branchId: input.branchId
    }),
    create_branch: async ({ input }) => runtime.createWorldlineBranch(input),
    list_branches: async ({ input }) => ({ branches: runtime.listWorldlineBranches(input) }),
    get_branch: async ({ input }) => ({ branch: runtime.getWorldlineBranch(input.id) }),
    switch_branch: async ({ input }) => runtime.switchWorldlineBranch(input.id, {
      savepointId: input.savepointId,
      actor: input.actor || 'user',
      reason: input.reason
    })
  };
}

function savepointSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      scopeType: { type: 'string' },
      scopeId: { type: 'string' },
      runtimeSessionId: { type: 'string' },
      sessionId: { type: 'string' },
      appChatSessionId: { type: 'string' },
      chatSessionId: { type: 'string' },
      chatId: { type: 'string' },
      branchId: { type: 'string' },
      includeRuntimeRag: { type: 'boolean', default: true },
      runtimeRagCollections: { type: 'array', items: { type: 'string' } },
      includePermanentRag: { type: 'boolean', default: false },
      permanentRagCollections: { type: 'array', items: { type: 'string' } },
      includeAudit: { type: 'boolean', default: true },
      auditLimit: { type: 'integer', minimum: 1, maximum: 500 },
      includeSnapshot: { type: 'boolean', default: true },
      actor: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
