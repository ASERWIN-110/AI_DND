// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { NpcRegistry } from '../npcs/npc-registry.js';

export const PARTY_MEMBERS_COLLECTION = 'party_members';

export const PARTY_MEMBER_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'partyId', type: 'text', description: 'Logical party id. Defaults to "main".' },
  { name: 'memberId', type: 'text', description: 'Stable party member id inside one party.' },
  { name: 'npcId', type: 'text', description: 'NPC/Actor registry id or local actor id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'actorType', type: 'text', description: 'Actor class: player, companion, npc, summon, hireling, mount, etc.' },
  { name: 'isPlayer', type: 'boolean', description: 'Whether this member is player-controlled.' },
  { name: 'playerId', type: 'text', description: 'Optional player/protagonist id.' },
  { name: 'role', type: 'text', description: 'General role or identity.' },
  { name: 'partyRole', type: 'text', description: 'Party-facing role: leader, companion, scout, reserve, escort, familiar, mount, etc.' },
  { name: 'importance', type: 'text', description: 'minor, supporting, major, or key.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'membershipStatus', type: 'text', description: 'active, reserve, guest, former, removed, dead, etc.' },
  { name: 'activityStatus', type: 'text', description: 'following, standby, assigned, away, offscreen, unavailable, missing, dead, etc.' },
  { name: 'sceneId', type: 'text', description: 'Current or last known scene id. Does not imply the member is mounted into that scene.' },
  { name: 'locationLabel', type: 'text', description: 'Current or last known location label.' },
  { name: 'destinationSceneId', type: 'text', description: 'Destination scene/location when travelling or assigned.' },
  { name: 'disposition', type: 'text', description: 'ally, loyal, wary, neutral, hostile, afraid, etc.' },
  { name: 'assignment', type: 'json', description: 'Current offscreen order, standby instruction, mission, watch task, or travel instruction.' },
  { name: 'availability', type: 'json', description: 'Whether/why the member can be summoned, controlled, or included in the current scene.' },
  { name: 'profileRef', type: 'text', description: 'Reference to full NPC profile or character card.' },
  { name: 'registryRef', type: 'text', description: 'Reference to L0 NPC registry entry.' },
  { name: 'summary', type: 'text', description: 'Compact party-facing prompt reminder.' },
  { name: 'notes', type: 'json', description: 'Short party management notes.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, scene-manager, etc.' },
  { name: 'orderIndex', type: 'integer', description: 'Stable display order.' },
  { name: 'metadata', type: 'json', description: 'Extra party member metadata.' },
  { name: 'joinedAt', type: 'text', description: 'First joined timestamp.' },
  { name: 'lastSeenAt', type: 'text', description: 'Latest observed timestamp.' },
  { name: 'partyUpdatedAt', type: 'text', description: 'Latest party member update timestamp.' }
];

const DEFAULT_PARTY_ID = 'main';
const DEFAULT_SCENE_ID = 'current';
const INACTIVE_MEMBERSHIP_STATUSES = new Set(['former', 'removed', 'dead', 'archived']);
const UNAVAILABLE_ACTIVITY_STATUSES = new Set(['dead', 'missing', 'unavailable', 'removed']);

export class PartyManager {
  constructor({
    appDatabase,
    npcRegistry,
    dataManager,
    collection = PARTY_MEMBERS_COLLECTION,
    now
  } = {}) {
    if (!appDatabase) throw validationError('PartyManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.npcRegistry = npcRegistry || (dataManager ? new NpcRegistry({ dataManager }) : undefined);
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
  }

  ensureCollection(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(chatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: PARTY_MEMBER_FIELDS,
      reason: 'partyManager:members'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return {
      ...this.ensureCollection(chatSessionId),
      defaultPartyId: DEFAULT_PARTY_ID,
      membershipStatuses: ['active', 'reserve', 'guest', 'former', 'removed', 'dead'],
      activityStatuses: ['following', 'standby', 'assigned', 'away', 'offscreen', 'unavailable', 'missing', 'dead'],
      note: 'Party members are chat-local companions/players/NPCs. They do not have to be mounted into the current scene.'
    };
  }

  addMember(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryNpc(input);
    const existing = input.id
      ? manager.getRecord(this.collection, input.id, { missing: 'undefined' })
      : undefined;
    const normalized = normalizePartyMember(input, {
      chatSessionId,
      now: this.now,
      registryRecord,
      existing: existing?.data
    });
    return manager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchMember(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.resolveMember(input);
    const patch = normalizeObject(input.patch);
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryNpc({
      ...current.data,
      ...patch,
      npcId: patch.npcId || patch.registryId || current.data.npcId
    });
    const normalized = normalizePartyMember({
      ...current.data,
      ...patch,
      id: current.id,
      chatSessionId
    }, {
      chatSessionId,
      now: this.now,
      registryRecord,
      existing: current.data
    });
    return manager.upsertRecord(this.collection, normalized, { id: current.id });
  }

  assignMember(input = {}) {
    const assignment = normalizeAssignment(input.assignment || {
      assignmentId: input.assignmentId,
      title: input.title,
      objective: input.objective || input.task || input.order,
      status: input.assignmentStatus || 'active',
      targetSceneId: input.targetSceneId || input.destinationSceneId,
      locationLabel: input.locationLabel,
      due: input.due,
      notes: input.notes
    }, {
      now: this.now
    });
    return this.patchMember({
      ...input,
      patch: {
        activityStatus: input.activityStatus || 'assigned',
        sceneId: input.sceneId,
        locationLabel: input.locationLabel,
        destinationSceneId: input.destinationSceneId || assignment.targetSceneId,
        assignment,
        availability: input.availability || {
          canJoinCurrentScene: false,
          reason: assignment.objective || assignment.title || 'assigned'
        },
        source: input.source || 'party-assignment'
      }
    });
  }

  setMemberActivity(input = {}) {
    const activityStatus = normalizeOptionalText(input.activityStatus || input.status);
    if (!activityStatus) throw validationError('activityStatus is required');
    return this.patchMember({
      ...input,
      patch: {
        activityStatus,
        membershipStatus: input.membershipStatus,
        sceneId: input.sceneId,
        locationLabel: input.locationLabel,
        destinationSceneId: input.destinationSceneId,
        assignment: input.assignment,
        availability: input.availability,
        source: input.source || 'party-activity'
      }
    });
  }

  setMemberLocation(input = {}) {
    return this.patchMember({
      ...input,
      patch: {
        sceneId: input.sceneId,
        locationLabel: input.locationLabel || input.location,
        destinationSceneId: input.destinationSceneId,
        activityStatus: input.activityStatus,
        lastSeenAt: input.lastSeenAt || this.now(),
        source: input.source || 'party-location'
      }
    });
  }

  getMember(input = {}) {
    return this.resolveMember(input);
  }

  listMembers({
    chatSessionId,
    partyId = DEFAULT_PARTY_ID,
    sceneId,
    includeInactive = false,
    availableOnly = false,
    membershipStatus,
    activityStatus,
    actorType,
    isPlayer,
    tags = [],
    query = '',
    filter = {},
    sort = [{ field: 'orderIndex', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = {
      ...filter,
      partyId: normalizePartyId(partyId)
    };
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    if (membershipStatus) mergedFilter.membershipStatus = String(membershipStatus);
    if (activityStatus) mergedFilter.activityStatus = String(activityStatus);
    if (actorType) mergedFilter.actorType = normalizeActorType(actorType);
    if (isPlayer !== undefined) mergedFilter.isPlayer = normalizeBoolean(isPlayer);

    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (!includeInactive && INACTIVE_MEMBERSHIP_STATUSES.has(String(data.membershipStatus || '').toLowerCase())) return false;
      if (availableOnly && UNAVAILABLE_ACTIVITY_STATUSES.has(String(data.activityStatus || '').toLowerCase())) return false;
      if (requiredTags.length > 0) {
        const memberTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => memberTags.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          data.memberId,
          data.npcId,
          data.name,
          data.actorType,
          data.playerId,
          data.role,
          data.partyRole,
          data.importance,
          data.membershipStatus,
          data.activityStatus,
          data.sceneId,
          data.locationLabel,
          data.destinationSceneId,
          data.disposition,
          data.summary,
          JSON.stringify(data.assignment || {}),
          ...(Array.isArray(data.tags) ? data.tags : []),
          ...(Array.isArray(data.aliases) ? data.aliases : [])
        ].filter(Boolean).join(' '));
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    return {
      ...result,
      partyId: normalizePartyId(partyId),
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  removeMember(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const mode = String(input.mode || 'markFormer');
    const current = this.resolveMember(input);
    const { manager } = this.openManager(chatSessionId);
    if (mode === 'delete') {
      return manager.deleteRecord(this.collection, current.id);
    }
    const timestamp = this.now();
    const membershipStatus = mode === 'markDead' || mode === 'dead' ? 'dead' : 'former';
    const activityStatus = mode === 'markDead' || mode === 'dead' ? 'dead' : 'away';
    const record = manager.patchRecord(this.collection, current.id, {
      membershipStatus,
      activityStatus,
      source: input.source || 'party-remove',
      partyUpdatedAt: timestamp,
      lastSeenAt: timestamp
    });
    return {
      collection: this.collection,
      id: current.id,
      deleted: false,
      mode,
      record
    };
  }

  clearParty({
    chatSessionId,
    partyId = DEFAULT_PARTY_ID,
    mode = 'markFormer',
    includeInactive = true,
    source = 'party-clear'
  } = {}) {
    const listed = this.listMembers({
      chatSessionId,
      partyId,
      includeInactive,
      limit: 500
    });
    const results = listed.records.map((record) => this.removeMember({
      chatSessionId,
      id: record.id,
      mode,
      source
    }));
    return {
      chatSessionId: listed.chatSessionId,
      partyId: listed.partyId,
      mode,
      count: results.length,
      results
    };
  }

  buildPromptContext({
    chatSessionId,
    partyId = DEFAULT_PARTY_ID,
    includeInactive = false,
    limit = 100
  } = {}) {
    const listed = this.listMembers({
      chatSessionId,
      partyId,
      includeInactive,
      limit
    });
    const members = listed.records.map((record) => compactPartyMember(record.data));
    const following = members.filter((member) => member.activityStatus === 'following');
    const standby = members.filter((member) => member.activityStatus === 'standby');
    const assigned = members.filter((member) => member.activityStatus === 'assigned');
    const other = members.filter((member) => !['following', 'standby', 'assigned'].includes(member.activityStatus));
    const context = [
      `Party ${listed.partyId}:`,
      following.length ? `Following/currently with party:\n${formatMemberLines(following)}` : '',
      standby.length ? `Standby members:\n${formatMemberLines(standby)}` : '',
      assigned.length ? `Assigned/offscreen orders:\n${formatMemberLines(assigned)}` : '',
      other.length ? `Other members:\n${formatMemberLines(other)}` : ''
    ].filter(Boolean).join('\n\n');
    return {
      chatSessionId: listed.chatSessionId,
      partyId: listed.partyId,
      context,
      members,
      groups: { following, standby, assigned, other }
    };
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const partyId = normalizePartyId(input.partyId);
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        partyMembers: this.collection,
        party_members: this.collection,
        members: this.collection,
        party: this.collection,
        companions: this.collection,
        teammates: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectPartyMemberRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.addMember({
      ...record,
      chatSessionId,
      partyId: record.partyId || partyId,
      source: input.source || record.source || 'document-import'
    }));
    return {
      format: parsed.format,
      chatSessionId,
      partyId,
      collection: this.collection,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    partyId = DEFAULT_PARTY_ID,
    format = 'json',
    includeInactive = true,
    tags = [],
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listMembers({
      chatSessionId,
      partyId,
      includeInactive,
      tags,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      partyId: listed.partyId,
      partyMembers: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
    };
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(payload, null, 2)}\n`,
        payload
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    throw validationError('export format must be json or yaml');
  }

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }

  resolveMember({ chatSessionId, id, memberId, npcId, playerId, partyId = DEFAULT_PARTY_ID } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collection, id);

    const resolvedMemberId = normalizeOptionalText(memberId || npcId || playerId);
    if (!resolvedMemberId) throw validationError('id, memberId, npcId, or playerId is required');
    const listed = this.listMembers({
      chatSessionId: normalizedChatSessionId,
      partyId,
      includeInactive: true,
      filter: {
        memberId: resolvedMemberId
      },
      limit: 2
    });
    if (listed.records.length === 0 && npcId) {
      const byNpc = this.listMembers({
        chatSessionId: normalizedChatSessionId,
        partyId,
        includeInactive: true,
        filter: { npcId },
        limit: 2
      });
      if (byNpc.records.length === 1) return byNpc.records[0];
      if (byNpc.records.length > 1) throw validationError(`Multiple party members matched npcId: ${npcId}; use id`);
    }
    if (listed.records.length === 0) {
      throw notFound(`Party member not found: ${resolvedMemberId}`);
    }
    if (listed.records.length > 1) {
      throw validationError(`Multiple party members matched memberId: ${resolvedMemberId}; use id`);
    }
    return listed.records[0];
  }

  resolveRegistryNpc(input = {}) {
    if (!this.npcRegistry) return undefined;
    const npcId = normalizeOptionalText(input.registryId || input.npcId || input.memberId);
    if (!npcId) return undefined;
    try {
      return this.npcRegistry.getNpc(npcId);
    } catch {
      return undefined;
    }
  }
}

export function normalizePartyMember(input = {}, {
  chatSessionId,
  now = () => new Date().toISOString(),
  registryRecord,
  existing
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('party member must be a plain object');
  }

  const registryData = registryRecord?.data || {};
  const timestamp = now();
  const resolvedChatSessionId = normalizeRequiredText(chatSessionId || input.chatSessionId || existing?.chatSessionId, 'chatSessionId');
  const partyId = normalizePartyId(input.partyId ?? existing?.partyId);
  const npcId = normalizeOptionalText(input.npcId || input.registryId || registryRecord?.id || existing?.npcId || input.playerId);
  const name = normalizeOptionalText(input.name ?? registryData.name ?? existing?.name);
  if (!npcId && !name) throw validationError('party member requires npcId/memberId/playerId or name');
  const memberId = normalizeOptionalText(input.memberId || existing?.memberId || npcId || input.playerId) || normalizeGeneratedId(name, 'member');
  const actorType = normalizeActorType(input.actorType ?? input.type ?? registryData.actorType ?? existing?.actorType ?? (input.isPlayer || registryData.isPlayer ? 'player' : 'companion'));
  const isPlayer = normalizeBoolean(input.isPlayer ?? input.player ?? registryData.isPlayer ?? existing?.isPlayer ?? actorType === 'player');
  const resolvedNpcId = npcId || memberId;
  const id = normalizeOptionalText(input.id || existing?.id) || partyMemberId(partyId, memberId);

  return {
    id,
    chatSessionId: resolvedChatSessionId,
    partyId,
    memberId,
    npcId: resolvedNpcId,
    name: name || resolvedNpcId,
    actorType: isPlayer ? 'player' : actorType,
    isPlayer,
    playerId: normalizeOptionalText(input.playerId ?? input.protagonistId ?? registryData.playerId ?? existing?.playerId),
    role: normalizeOptionalText(input.role ?? registryData.role ?? existing?.role) || (isPlayer ? 'player-character' : ''),
    partyRole: normalizeOptionalText(input.partyRole ?? input.companionRole ?? existing?.partyRole) || (isPlayer ? 'leader' : 'companion'),
    importance: normalizeImportance(input.importance ?? registryData.importance ?? existing?.importance ?? (isPlayer ? 'key' : 'supporting')),
    tags: mergeStringArrays(registryData.tags, existing?.tags, input.tags),
    aliases: mergeStringArrays(registryData.aliases, existing?.aliases, input.aliases),
    membershipStatus: normalizeOptionalText(input.membershipStatus ?? existing?.membershipStatus ?? 'active'),
    activityStatus: normalizeOptionalText(input.activityStatus ?? input.status ?? existing?.activityStatus ?? 'following'),
    sceneId: normalizeSceneId(input.sceneId ?? input.currentSceneId ?? existing?.sceneId),
    locationLabel: normalizeOptionalText(input.locationLabel ?? input.location ?? registryData.currentLocation ?? existing?.locationLabel),
    destinationSceneId: normalizeOptionalText(input.destinationSceneId ?? existing?.destinationSceneId),
    disposition: normalizeOptionalText(input.disposition ?? existing?.disposition ?? 'ally'),
    assignment: normalizeAssignment(input.assignment ?? existing?.assignment, { now, fallbackEmpty: true }),
    availability: normalizeObject(input.availability ?? existing?.availability),
    profileRef: normalizeOptionalText(input.profileRef ?? input.profile ?? registryData.profileRef ?? existing?.profileRef),
    registryRef: normalizeOptionalText(input.registryRef ?? (registryRecord ? `npc_registry:${registryRecord.id}` : existing?.registryRef)),
    summary: normalizeOptionalText(input.summary ?? registryData.summary ?? existing?.summary),
    notes: normalizeStringArray(input.notes ?? existing?.notes),
    source: normalizeOptionalText(input.source ?? existing?.source ?? 'agent'),
    orderIndex: normalizeInteger(input.orderIndex ?? existing?.orderIndex, 0),
    metadata: normalizeObject(input.metadata ?? existing?.metadata),
    joinedAt: normalizeOptionalText(existing?.joinedAt ?? input.joinedAt) || timestamp,
    lastSeenAt: normalizeOptionalText(input.lastSeenAt) || timestamp,
    partyUpdatedAt: timestamp
  };
}

function normalizeAssignment(value, { now = () => new Date().toISOString(), fallbackEmpty = false } = {}) {
  if ((value === undefined || value === null || value === '') && fallbackEmpty) return {};
  const input = normalizeObject(value);
  if (Object.keys(input).length === 0 && fallbackEmpty) return {};
  return {
    assignmentId: normalizeOptionalText(input.assignmentId || input.id) || normalizeGeneratedId(input.title || input.objective || now(), 'assignment'),
    title: normalizeOptionalText(input.title || input.name),
    objective: normalizeOptionalText(input.objective || input.task || input.order || input.description),
    status: normalizeOptionalText(input.status) || 'active',
    targetSceneId: normalizeOptionalText(input.targetSceneId || input.destinationSceneId),
    locationLabel: normalizeOptionalText(input.locationLabel || input.location),
    due: input.due || input.deadline || {},
    notes: normalizeStringArray(input.notes),
    createdAt: normalizeOptionalText(input.createdAt) || now(),
    updatedAt: normalizeOptionalText(input.updatedAt) || now(),
    metadata: normalizeObject(input.metadata)
  };
}

function compactPartyMember(member = {}) {
  return {
    memberId: member.memberId,
    npcId: member.npcId,
    name: member.name,
    actorType: member.actorType,
    isPlayer: member.isPlayer,
    partyRole: member.partyRole,
    membershipStatus: member.membershipStatus,
    activityStatus: member.activityStatus,
    sceneId: member.sceneId,
    locationLabel: member.locationLabel,
    destinationSceneId: member.destinationSceneId,
    assignment: member.assignment,
    summary: member.summary,
    notes: member.notes
  };
}

function formatMemberLines(members) {
  return members.map((member) => {
    const assignment = member.assignment?.objective || member.assignment?.title;
    const location = [member.sceneId, member.locationLabel].filter(Boolean).join(' / ');
    return `- ${member.name || member.memberId} (${member.activityStatus}${location ? `, ${location}` : ''}${assignment ? `, task: ${assignment}` : ''})`;
  }).join('\n');
}

function selectPartyMemberRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const members = groups.find((group) => [
    'partyMembers',
    'party_members',
    'members',
    'party',
    'companions',
    'teammates',
    PARTY_MEMBERS_COLLECTION
  ].includes(group.collection));
  const selected = preferred || members || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function partyMemberId(partyId, memberId) {
  return `party_${safeSegment(partyId)}_${safeSegment(memberId)}`.slice(0, 128);
}

function normalizePartyId(value) {
  return normalizeOptionalText(value) || DEFAULT_PARTY_ID;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
}

function normalizeRequiredText(value, field) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeImportance(value) {
  const normalized = String(value || 'supporting').toLowerCase();
  if (['minor', 'supporting', 'major', 'key'].includes(normalized)) return normalized;
  return 'supporting';
}

function normalizeActorType(value) {
  const normalized = String(value || 'companion').trim().toLowerCase();
  if (['pc', 'player-character', 'player_character', 'protagonist'].includes(normalized)) return 'player';
  return normalized || 'companion';
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'player', 'pc'].includes(normalized);
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function mergeStringArrays(...values) {
  return [...new Set(values.flatMap(normalizeStringArray))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function safeSegment(value) {
  const source = String(value || '');
  const cleaned = source
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || normalizeGeneratedId(source, 'seg');
}

function normalizeGeneratedId(value, prefix) {
  return `${prefix}_${shortHash(String(value || prefix))}`;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'PartyManagerValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'PartyManagerNotFoundError';
  error.statusCode = 404;
  return error;
}
