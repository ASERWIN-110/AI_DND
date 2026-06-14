// @ts-nocheck
import { NpcProfileDatabase, NPC_PROFILE_LEVELS } from '../npcs/npc-profiles.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const NPC_PROFILES_PLUGIN = {
  id: 'system.npc_profiles',
  name: 'NPC Profile Database Tools',
  version: '0.1.0',
  description: 'L1/L2/L3 full NPC profile database with a persistent agent write-access switch.',
  enabled: true,
  permissions: ['npc-profiles:read', 'npc-profiles:write', 'npc-profiles:admin'],
  tools: [
    {
      name: 'get_write_access',
      title: 'Get NPC Profile Write Access',
      description: 'Read whether agent tools are allowed to write NPC L1/L2/L3 profile data.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'settings', 'query']
    },
    {
      name: 'set_write_access',
      title: 'Set NPC Profile Write Access',
      description: 'Enable or disable agent writes for NPC L1/L2/L3 profile data. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          reason: { type: 'string' },
          updatedBy: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true }
        },
        required: ['enabled'],
        additionalProperties: false
      },
      annotations: {
        requiresUserAuthorization: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['npc', 'profile', 'settings', 'write']
    },
    {
      name: 'describe_profiles',
      title: 'Describe NPC Profile Database',
      description: 'Describe profile and setting collections plus synchronized schema files.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'schema']
    },
    {
      name: 'list_profiles',
      title: 'List NPC Profiles',
      description: 'List L1/L2/L3 NPC profiles with optional npcId, levels, tags, and query filters.',
      inputSchema: profileQuerySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'query']
    },
    {
      name: 'get_profile',
      title: 'Get NPC Profile',
      description: 'Get one NPC profile by profile id, or by npcId and level.',
      inputSchema: profileIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'query']
    },
    {
      name: 'get_profile_bundle',
      title: 'Get NPC Profile Bundle',
      description: 'Get all requested L1/L2/L3 profiles for one NPC, ordered from L1 to L3.',
      inputSchema: {
        type: 'object',
        properties: {
          npcId: { type: 'string' },
          levels: levelListSchema(),
          includeArchived: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 10 }
        },
        required: ['npcId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'query', 'bundle']
    },
    {
      name: 'upsert_profile',
      title: 'Create Or Replace NPC Profile',
      description: 'Create or replace one L1/L2/L3 NPC profile. Agent writes must be enabled, unless the call is explicitly user-authorized/manual.',
      inputSchema: profileInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        idempotent: true,
        gatedBy: 'npc_profile_agent_write_access'
      },
      tags: ['npc', 'profile', 'write']
    },
    {
      name: 'patch_profile',
      title: 'Patch NPC Profile',
      description: 'Patch one L1/L2/L3 NPC profile. Agent writes must be enabled, unless the call is explicitly user-authorized/manual.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          profileId: { type: 'string' },
          npcId: { type: 'string' },
          level: levelSchema(),
          patch: profilePatchSchema()
        },
        required: ['patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        gatedBy: 'npc_profile_agent_write_access'
      },
      tags: ['npc', 'profile', 'write']
    },
    {
      name: 'delete_profile',
      title: 'Delete NPC Profile',
      description: 'Delete one L1/L2/L3 NPC profile. Agent writes must be enabled, unless the call is explicitly user-authorized/manual.',
      inputSchema: profileIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        destructive: true,
        gatedBy: 'npc_profile_agent_write_access'
      },
      tags: ['npc', 'profile', 'delete']
    },
    {
      name: 'import_document',
      title: 'Import NPC Profile Document',
      description: 'Import L1/L2/L3 NPC profiles from JSON, YAML, or XML. Agent writes must be enabled, unless the call is explicitly user-authorized/manual.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          defaultLevel: levelSchema(),
          source: { type: 'string', default: 'document-import' }
        },
        required: ['text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        gatedBy: 'npc_profile_agent_write_access'
      },
      tags: ['npc', 'profile', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export NPC Profile Document',
      description: 'Export L1/L2/L3 NPC profiles to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          npcId: { type: 'string' },
          level: levelSchema(),
          levels: levelListSchema(),
          tags: stringArraySchema(),
          query: { type: 'string' },
          includeArchived: { type: 'boolean', default: true },
          includeSettings: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'profile', 'export', 'json', 'yaml']
    }
  ]
};

export function createNpcProfileHandlers({ dataManager, database } = {}) {
  const profiles = database || new NpcProfileDatabase({ dataManager });
  return {
    get_write_access: async () => profiles.getWriteAccess(),
    set_write_access: async ({ input }) => profiles.setWriteAccess(input),
    describe_profiles: async () => profiles.describe(),
    list_profiles: async ({ input }) => profiles.listProfiles(input),
    get_profile: async ({ input }) => profiles.getProfile(input),
    get_profile_bundle: async ({ input }) => profiles.getProfileBundle(input),
    upsert_profile: async ({ input, context }) => profiles.upsertProfile(input, { context }),
    patch_profile: async ({ input, context }) => profiles.patchProfile(input, { context }),
    delete_profile: async ({ input, context }) => profiles.deleteProfile(input, { context }),
    import_document: async ({ input, context }) => profiles.importDocument(input, { context }),
    export_document: async ({ input }) => profiles.exportDocument(input)
  };
}

function profileInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      profileId: { type: 'string' },
      npcId: { type: 'string' },
      registryId: { type: 'string' },
      characterId: { type: 'string' },
      level: levelSchema(),
      layer: levelSchema(),
      tier: levelSchema(),
      name: { type: 'string' },
      actorType: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      playerId: { type: 'string' },
      protagonistId: { type: 'string' },
      title: { type: 'string' },
      profileType: { type: 'string' },
      type: { type: 'string' },
      version: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      status: { type: 'string' },
      summary: { type: 'string' },
      content: { type: 'string' },
      text: { type: 'string' },
      sections: { type: 'object', additionalProperties: true },
      characterCard: { type: 'object', additionalProperties: true },
      character_card: { type: 'object', additionalProperties: true },
      card: { type: 'object', additionalProperties: true },
      worldInfo: { type: 'object', additionalProperties: true },
      world_info: { type: 'object', additionalProperties: true },
      worldBook: { type: 'object', additionalProperties: true },
      rules: { type: 'object', additionalProperties: true },
      relationships: {},
      memories: {},
      data: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    additionalProperties: true
  };
}

function profilePatchSchema() {
  return profileInputSchema();
}

function profileIdentitySchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      profileId: { type: 'string' },
      npcId: { type: 'string' },
      level: levelSchema()
    },
    additionalProperties: false
  };
}

function profileQuerySchema() {
  return {
    type: 'object',
    properties: {
      npcId: { type: 'string' },
      level: levelSchema(),
      levels: levelListSchema(),
      includeArchived: { type: 'boolean', default: false },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
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

function levelSchema() {
  return {
    anyOf: [
      { type: 'string', enum: [...NPC_PROFILE_LEVELS, 'l1', 'l2', 'l3', '1', '2', '3'] },
      { type: 'integer', enum: [1, 2, 3] }
    ]
  };
}

function levelListSchema() {
  return {
    anyOf: [
      { type: 'array', items: levelSchema() },
      levelSchema()
    ]
  };
}

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
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
