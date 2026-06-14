// @ts-nocheck
export const AUDIT_PLUGIN = {
  id: 'system.audit',
  name: 'Audit / Undo / Replay Tools',
  version: '0.1.0',
  description: 'Inspect audit events, replay calls, and rollback reversible changes.',
  enabled: true,
  permissions: ['audit:read', 'audit:write', 'audit:rollback'],
  tools: [
    {
      name: 'describe_audit',
      title: 'Describe Audit System',
      description: 'Describe supported audit, undo, replay, and rollback operations.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['audit', 'help']
    },
    {
      name: 'list_events',
      title: 'List Audit Events',
      description: 'List audit events by scope, operation, status, or reversibility.',
      inputSchema: {
        type: 'object',
        properties: {
          scopeType: { type: 'string' },
          scopeId: { type: 'string' },
          operation: { type: 'string' },
          status: { type: 'string', enum: ['success', 'error', 'skipped', 'pending'] },
          reversible: { type: 'boolean' },
          replayable: { type: 'boolean' },
          includeReverted: { type: 'boolean', default: true },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: false,
      tags: ['audit', 'query']
    },
    {
      name: 'get_event',
      title: 'Get Audit Event',
      description: 'Read one audit event, including trace file references.',
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
      tags: ['audit', 'query']
    },
    {
      name: 'rollback_event',
      title: 'Rollback Audit Event',
      description: 'Rollback a reversible audit event. This can delete or restore state and requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          actor: { type: 'string' },
          reason: { type: 'string' },
          force: { type: 'boolean', default: false }
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
      tags: ['audit', 'rollback', 'undo']
    },
    {
      name: 'replay_event',
      title: 'Replay Audit Event',
      description: 'Replay a replayable event. Mutating replays require explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          mode: { type: 'string', enum: ['captured', 'regenerate'], default: 'captured' },
          inputOverride: { type: 'object', additionalProperties: true },
          contextOverride: { type: 'object', additionalProperties: true },
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
        requiresUserAuthorization: true
      },
      tags: ['audit', 'replay']
    },
    {
      name: 'delete_runtime_messages_after',
      title: 'Delete Runtime Messages After Cutoff',
      description: 'Delete runtime chat messages after a message id or array index and write a reversible audit event.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', minLength: 1 },
          messageId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          inclusive: { type: 'boolean', default: false },
          reason: { type: 'string' },
          actor: { type: 'string' }
        },
        required: ['sessionId'],
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
      tags: ['audit', 'chat', 'delete']
    },
    {
      name: 'delete_app_chat_messages_after',
      title: 'Delete App Chat Messages After Cutoff',
      description: 'Delete persisted app chat messages after a message id or order index and write a reversible audit event.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string', minLength: 1 },
          messageId: { type: 'string' },
          orderIndex: { type: 'integer', minimum: 0 },
          inclusive: { type: 'boolean', default: false },
          reason: { type: 'string' },
          actor: { type: 'string' }
        },
        required: ['chatSessionId'],
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
      tags: ['audit', 'chat', 'delete']
    }
  ]
};

export function createAuditHandlers({ runtime } = {}) {
  if (!runtime) {
    throw new TypeError('createAuditHandlers requires runtime');
  }
  return {
    describe_audit: async () => runtime.describeAudit(),
    list_events: async ({ input }) => ({ events: runtime.listAuditEvents(input) }),
    get_event: async ({ input }) => ({ event: runtime.getAuditEvent(input.id) }),
    rollback_event: async ({ input }) => runtime.rollbackAuditEvent(input.id, {
      actor: input.actor || 'user',
      reason: input.reason,
      force: input.force
    }),
    replay_event: async ({ input, context }) => runtime.replayAuditEvent(input.id, {
      mode: input.mode || 'captured',
      inputOverride: input.inputOverride,
      contextOverride: {
        ...(input.contextOverride || {}),
        authorization: context.authorization || context.userAuthorization || context.approval
      },
      actor: input.actor || 'user',
      reason: input.reason
    }),
    delete_runtime_messages_after: async ({ input }) => runtime.deleteRuntimeMessagesAfter(input.sessionId, {
      messageId: input.messageId,
      index: input.index,
      inclusive: input.inclusive,
      reason: input.reason,
      actor: input.actor || 'user'
    }),
    delete_app_chat_messages_after: async ({ input }) => runtime.deleteAppChatMessagesAfter(input.chatSessionId, {
      messageId: input.messageId,
      orderIndex: input.orderIndex,
      inclusive: input.inclusive,
      reason: input.reason,
      actor: input.actor || 'user'
    })
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
