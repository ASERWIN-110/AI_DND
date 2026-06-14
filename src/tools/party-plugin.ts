// @ts-nocheck
import { PartyManager } from '../party/party-manager.js';

export const PARTY_PLUGIN = {
  id: 'system.party',
  name: 'Party Management Tools',
  version: '0.1.0',
  description: 'Chat-local party roster tools for players, companions, summons, escorts, mounts, and offscreen teammate assignments.',
  enabled: true,
  permissions: ['party:read', 'party:write'],
  tools: [
    {
      name: 'describe_party',
      title: 'Describe Party Collection',
      description: 'Describe the chat-local party member collection, statuses, and synchronized schema file.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['party', 'schema']
    },
    {
      name: 'list_members',
      title: 'List Party Members',
      description: 'List party members across scenes. Members can be following, standby, assigned offscreen, missing, etc.',
      inputSchema: listMembersSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['party', 'member', 'query']
    },
    {
      name: 'get_member',
      title: 'Get Party Member',
      description: 'Get one party member by record id, memberId, npcId, or playerId.',
      inputSchema: memberIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['party', 'member', 'query']
    },
    {
      name: 'add_member',
      title: 'Add Party Member',
      description: 'Add or replace a player/companion/NPC in the chat-local party roster. It can hydrate L0 NPC data when npcId matches the registry.',
      inputSchema: partyMemberInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true
      },
      tags: ['party', 'member', 'write']
    },
    {
      name: 'patch_member',
      title: 'Patch Party Member',
      description: 'Patch one party member without forcing a scene mount.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          partyId: { type: 'string', default: 'main' },
          id: { type: 'string' },
          memberId: { type: 'string' },
          npcId: { type: 'string' },
          playerId: { type: 'string' },
          patch: partyMemberPatchSchema()
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['party', 'member', 'write']
    },
    {
      name: 'assign_member',
      title: 'Assign Party Member',
      description: 'Send a party member to standby, scout, guard, travel, research, or another offscreen task. This does not require the member to be in the current scene.',
      inputSchema: assignMemberSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['party', 'assignment', 'offscreen', 'write']
    },
    {
      name: 'set_member_activity',
      title: 'Set Party Member Activity',
      description: 'Set activity status such as following, standby, assigned, away, offscreen, unavailable, missing, or dead.',
      inputSchema: activitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['party', 'activity', 'write']
    },
    {
      name: 'set_member_location',
      title: 'Set Party Member Location',
      description: 'Update a party member current/last-known scene or location without mounting them into that scene.',
      inputSchema: locationSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['party', 'location', 'write']
    },
    {
      name: 'remove_member',
      title: 'Remove Party Member',
      description: 'Delete a party member or mark them former/dead while preserving history.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          partyId: { type: 'string', default: 'main' },
          id: { type: 'string' },
          memberId: { type: 'string' },
          npcId: { type: 'string' },
          playerId: { type: 'string' },
          mode: { type: 'string', enum: ['delete', 'markFormer', 'markDead', 'dead'], default: 'markFormer' },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['party', 'member', 'delete']
    },
    {
      name: 'clear_party',
      title: 'Clear Party',
      description: 'Delete or mark former all members in one logical party.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          partyId: { type: 'string', default: 'main' },
          mode: { type: 'string', enum: ['delete', 'markFormer', 'markDead', 'dead'], default: 'markFormer' },
          includeInactive: { type: 'boolean', default: true },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['party', 'clear', 'delete']
    },
    {
      name: 'build_prompt_context',
      title: 'Build Party Prompt Context',
      description: 'Build compact prompt text grouped by following, standby, assigned, and other party members.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          partyId: { type: 'string', default: 'main' },
          includeInactive: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['party', 'prompt', 'context']
    },
    {
      name: 'import_document',
      title: 'Import Party Members',
      description: 'Import party members from JSON, YAML, or XML into one chat-local party roster.',
      inputSchema: importSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['party', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Party Members',
      description: 'Export one chat-local party roster to JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['party', 'export', 'json', 'yaml']
    }
  ]
};

export function createPartyHandlers({ appDatabase, dataManager, npcRegistry, manager } = {}) {
  const party = manager || new PartyManager({
    appDatabase,
    dataManager,
    npcRegistry
  });
  return {
    describe_party: async ({ input }) => party.describe(input.chatSessionId),
    list_members: async ({ input }) => party.listMembers(input),
    get_member: async ({ input }) => party.getMember(input),
    add_member: async ({ input }) => party.addMember(input),
    patch_member: async ({ input }) => party.patchMember(input),
    assign_member: async ({ input }) => party.assignMember(input),
    set_member_activity: async ({ input }) => party.setMemberActivity(input),
    set_member_location: async ({ input }) => party.setMemberLocation(input),
    remove_member: async ({ input }) => party.removeMember(input),
    clear_party: async ({ input }) => party.clearParty(input),
    build_prompt_context: async ({ input }) => party.buildPromptContext(input),
    import_document: async ({ input }) => party.importDocument(input),
    export_document: async ({ input }) => party.exportDocument(input)
  };
}

function chatSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function memberIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      id: { type: 'string' },
      memberId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listMembersSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      sceneId: { type: 'string' },
      includeInactive: { type: 'boolean', default: false },
      availableOnly: { type: 'boolean', default: false },
      membershipStatus: { type: 'string' },
      activityStatus: { type: 'string' },
      actorType: { type: 'string' },
      isPlayer: { type: 'boolean' },
      tags: stringArraySchema(),
      query: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function partyMemberInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      memberId: { type: 'string' },
      npcId: { type: 'string' },
      registryId: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      playerId: { type: 'string' },
      protagonistId: { type: 'string' },
      role: { type: 'string' },
      partyRole: { type: 'string' },
      companionRole: { type: 'string' },
      importance: { type: 'string', enum: ['minor', 'supporting', 'major', 'key'] },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      membershipStatus: { type: 'string' },
      activityStatus: { type: 'string' },
      status: { type: 'string' },
      sceneId: { type: 'string' },
      currentSceneId: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      destinationSceneId: { type: 'string' },
      disposition: { type: 'string' },
      assignment: assignmentSchema(),
      availability: { type: 'object', additionalProperties: true },
      profileRef: { type: 'string' },
      profile: { type: 'string' },
      registryRef: { type: 'string' },
      summary: { type: 'string' },
      notes: stringArraySchema(),
      source: { type: 'string' },
      orderIndex: { type: 'integer' },
      metadata: { type: 'object', additionalProperties: true },
      joinedAt: { type: 'string' },
      lastSeenAt: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function partyMemberPatchSchema() {
  const schema = partyMemberInputSchema();
  return {
    ...schema,
    required: [],
    properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== 'chatSessionId'))
  };
}

function assignMemberSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      id: { type: 'string' },
      memberId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      assignment: assignmentSchema(),
      assignmentId: { type: 'string' },
      title: { type: 'string' },
      objective: { type: 'string' },
      task: { type: 'string' },
      order: { type: 'string' },
      assignmentStatus: { type: 'string' },
      targetSceneId: { type: 'string' },
      destinationSceneId: { type: 'string' },
      sceneId: { type: 'string' },
      locationLabel: { type: 'string' },
      due: { type: 'object', additionalProperties: true },
      notes: stringArraySchema(),
      activityStatus: { type: 'string' },
      availability: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function activitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      id: { type: 'string' },
      memberId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      activityStatus: { type: 'string' },
      status: { type: 'string' },
      membershipStatus: { type: 'string' },
      sceneId: { type: 'string' },
      locationLabel: { type: 'string' },
      destinationSceneId: { type: 'string' },
      assignment: assignmentSchema(),
      availability: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function locationSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      id: { type: 'string' },
      memberId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      sceneId: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      destinationSceneId: { type: 'string' },
      activityStatus: { type: 'string' },
      lastSeenAt: { type: 'string' },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function assignmentSchema() {
  return {
    type: 'object',
    properties: {
      assignmentId: { type: 'string' },
      id: { type: 'string' },
      title: { type: 'string' },
      name: { type: 'string' },
      objective: { type: 'string' },
      task: { type: 'string' },
      order: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string' },
      targetSceneId: { type: 'string' },
      destinationSceneId: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      due: { type: 'object', additionalProperties: true },
      deadline: { type: 'object', additionalProperties: true },
      notes: stringArraySchema(),
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  };
}

function importSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      text: { type: 'string', minLength: 1 },
      format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
      idField: { type: 'string', default: 'id' },
      source: { type: 'string', default: 'document-import' }
    },
    required: ['chatSessionId', 'text'],
    additionalProperties: false
  };
}

function exportSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
      includeInactive: { type: 'boolean', default: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function stringArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'array',
        items: { type: 'string' }
      }
    ]
  };
}

function sortSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}
