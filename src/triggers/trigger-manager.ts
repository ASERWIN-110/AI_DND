// @ts-nocheck
import { randomInt } from 'node:crypto';
import { EffectSettlementResolver } from '../combat/effect-settlement.js';
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';
import { PartyManager } from '../party/party-manager.js';
import { QuestManager, QUEST_CLOCKS_COLLECTION } from '../quests/quest-manager.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { TimeTurnManager } from '../time/time-turn-manager.js';
import { createId } from '../utils/id.js';

export const TRIGGER_EVENTS_COLLECTION = 'trigger_events';

export const TRIGGER_EVENT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'eventId', type: 'text', description: 'Stable trigger event id.' },
  { name: 'triggerType', type: 'text', description: 'death, revive, status_tick, quest, time, scene_end, party_assignment, encounter, etc.' },
  { name: 'sceneId', type: 'text', description: 'Optional scene id.' },
  { name: 'status', type: 'text', description: 'triggered, skipped, applied, due, resolved, failed, etc.' },
  { name: 'actorIds', type: 'json', description: 'Actor/NPC ids involved.' },
  { name: 'partyMemberIds', type: 'json', description: 'Party member ids involved.' },
  { name: 'questIds', type: 'json', description: 'Quest ids involved.' },
  { name: 'payload', type: 'json', description: 'Trigger input and selected table item or rule details.' },
  { name: 'result', type: 'json', description: 'Trigger output or applied state summary.' },
  { name: 'source', type: 'text', description: 'manual, trigger-manager, loop, scene-end, etc.' },
  { name: 'createdAtIso', type: 'text', description: 'Trigger event timestamp.' }
];

export const DEFAULT_ENCOUNTER_TABLE = [
  {
    id: 'minor_traveler',
    title: 'Minor traveler crosses the party path',
    description: 'A harmless or low-risk traveler, messenger, refugee, merchant, pilgrim, or local appears.',
    weight: 4,
    category: 'social',
    challenge: 'minor'
  },
  {
    id: 'environmental_complication',
    title: 'Environmental complication',
    description: 'Weather, terrain, noise, tracks, unstable ground, a locked route, or an omen changes immediate options.',
    weight: 3,
    category: 'environment',
    challenge: 'minor'
  },
  {
    id: 'hostile_contact',
    title: 'Hostile contact',
    description: 'A patrol, predator, rival, thief, monster, or suspicious watcher becomes relevant.',
    weight: 2,
    category: 'combat_or_chase',
    challenge: 'moderate'
  },
  {
    id: 'rare_wonder',
    title: 'Rare wonder or strange opportunity',
    description: 'A secret sign, unusual merchant, magical echo, hidden shortcut, or odd coincidence opens a new possibility.',
    weight: 1,
    category: 'wonder',
    challenge: 'variable'
  }
];

export class TriggerManager {
  constructor({
    appDatabase,
    npcState,
    effectSettlement,
    questManager,
    timeManager,
    partyManager,
    random,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase && !npcState) throw validationError('TriggerManager requires appDatabase or npcState');
    this.appDatabase = appDatabase;
    this.npcState = npcState || new NpcStructuredStateDatabase({
      appDatabase,
      trace: trace === false ? false : trace?.npcState
    });
    this.effectSettlement = effectSettlement || new EffectSettlementResolver({
      appDatabase,
      npcState: this.npcState,
      trace: trace === false ? false : trace?.effects
    });
    this.questManager = questManager || (appDatabase ? new QuestManager({
      appDatabase,
      trace: trace === false ? false : trace?.quests
    }) : undefined);
    this.timeManager = timeManager || (appDatabase ? new TimeTurnManager({
      appDatabase,
      trace: trace === false ? false : trace?.time
    }) : undefined);
    this.partyManager = partyManager || (appDatabase ? new PartyManager({ appDatabase }) : undefined);
    this.random = typeof random === 'function' ? random : secureRandomUnit;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/trigger-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollection(chatSessionId) {
    if (!this.appDatabase) throw validationError('Trigger events require appDatabase');
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    manager.ensureCollection(TRIGGER_EVENTS_COLLECTION);
    manager.alterFields(TRIGGER_EVENTS_COLLECTION, {
      add: TRIGGER_EVENT_FIELDS,
      reason: 'triggerManager:events'
    });
    return {
      database,
      collection: manager.describeCollection(TRIGGER_EVENTS_COLLECTION)
    };
  }

  describe(chatSessionId) {
    return {
      ...(chatSessionId ? this.ensureCollection(chatSessionId) : {}),
      llm: false,
      toolsAreDeterministic: true,
      triggerTypes: [
        'death',
        'revive',
        'status_tick',
        'quest_expiry',
        'time_due_event',
        'world_clock_due',
        'scene_end',
        'party_assignment_due',
        'encounter'
      ],
      encounterTable: DEFAULT_ENCOUNTER_TABLE
    };
  }

  scanDeathTriggers(input = {}) {
    return this.withTrace('trigger-scan-death', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = input.sceneId ? normalizeSceneId(input.sceneId) : undefined;
      const apply = Boolean(input.apply);
      const listed = this.npcState.listNpcStates({
        chatSessionId,
        sceneId,
        npcId: input.npcId || input.actorId,
        playerId: input.playerId,
        limit: input.limit || 500
      });
      const results = [];
      for (const record of listed.records) {
        const decision = decideDeathTrigger(record.data, input);
        if (!decision.triggered) continue;
        let appliedRecord;
        if (apply) {
          appliedRecord = this.npcState.patchNpcState(buildDeathPatch(record.data, decision, {
            chatSessionId,
            source: input.source || 'death-trigger'
          }), { source: input.source || 'death-trigger' }).record;
          this.recordTriggerEvent({
            chatSessionId,
            sceneId: record.data.sceneId,
            triggerType: 'death',
            status: 'applied',
            actorIds: [record.data.npcId],
            payload: { decision },
            result: { recordId: appliedRecord.id, state: compactActorState(appliedRecord.data) },
            source: input.source || 'death-trigger'
          });
        }
        results.push({
          actorId: record.data.npcId,
          recordId: record.id,
          decision,
          applied: Boolean(appliedRecord),
          record: appliedRecord
        });
      }
      return {
        chatSessionId,
        sceneId,
        apply,
        count: results.length,
        results
      };
    });
  }

  reviveActor(input = {}) {
    return this.withTrace('trigger-revive-actor', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeSceneId(input.sceneId);
      const current = this.npcState.getNpcState({
        chatSessionId,
        sceneId,
        npcId: input.npcId || input.actorId,
        playerId: input.playerId,
        id: input.id,
        recordId: input.recordId
      });
      const hp = resolveReviveHp(current.data, input);
      const patch = buildRevivePatch(current.data, {
        chatSessionId,
        sceneId,
        hp,
        addRevivedStatus: input.addRevivedStatus !== false,
        source: input.source || 'revive-trigger'
      });
      const record = this.npcState.patchNpcState(patch, { source: input.source || 'revive-trigger' }).record;
      const event = this.recordTriggerEvent({
        chatSessionId,
        sceneId: record.data.sceneId,
        triggerType: 'revive',
        status: 'applied',
        actorIds: [record.data.npcId],
        payload: { hp, input: sanitizeEventInput(input) },
        result: { recordId: record.id, state: compactActorState(record.data) },
        source: input.source || 'revive-trigger'
      });
      return {
        actorId: record.data.npcId,
        hp,
        record,
        event
      };
    });
  }

  tickStatusEffects(input = {}) {
    return this.withTrace('trigger-status-tick', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = input.sceneId ? normalizeSceneId(input.sceneId) : undefined;
      const timing = normalizeOptionalText(input.timing || input.tickTiming || 'manual');
      const turnActorId = normalizeOptionalText(input.turnActorId || input.activeActorId || input.participantId || input.actorId || input.npcId);
      const apply = Boolean(input.apply);
      const listed = this.npcState.listNpcStates({
        chatSessionId,
        sceneId,
        npcId: input.npcId || input.actorId,
        playerId: input.playerId,
        limit: input.limit || 500
      });
      const results = [];
      for (const record of listed.records) {
        const actorResults = this.tickActorStatuses(record.data, {
          chatSessionId,
          timing,
          turnActorId,
          apply,
          decrement: input.decrement !== false,
          source: input.source || 'status-trigger'
        });
        results.push(...actorResults.map((result) => ({
          ...result,
          recordId: record.id
        })));
      }
      return {
        chatSessionId,
        sceneId,
        timing,
        turnActorId,
        apply,
        count: results.length,
        results
      };
    });
  }

  scanQuestTriggers(input = {}) {
    return this.withTrace('trigger-scan-quests', input.chatSessionId, input, () => {
      if (!this.questManager) throw validationError('Quest triggers require questManager');
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const apply = Boolean(input.apply);
      if (apply) {
        const expired = this.questManager.expireDueQuests({
          ...input,
          source: input.source || 'quest-trigger'
        });
        for (const item of expired.expired || []) {
          this.recordTriggerEvent({
            chatSessionId,
            triggerType: 'quest_expiry',
            status: 'applied',
            questIds: [item.quest.data.questId],
            payload: { clock: item.clock.data },
            result: { quest: item.quest.data },
            source: input.source || 'quest-trigger'
          });
        }
        return expired;
      }
      const due = this.previewDueQuestClocks(input);
      return {
        chatSessionId,
        apply,
        count: due.length,
        due
      };
    });
  }

  scanSceneEndTriggers(input = {}) {
    return this.withTrace('trigger-scene-end', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const questResult = this.scanQuestTriggers({
        ...input,
        chatSessionId,
        sceneEnded: true,
        source: input.source || 'scene-end-trigger'
      });
      const event = input.apply ? this.recordTriggerEvent({
        chatSessionId,
        sceneId: input.sceneId,
        triggerType: 'scene_end',
        status: 'applied',
        payload: sanitizeEventInput(input),
        result: { questResult },
        source: input.source || 'scene-end-trigger'
      }) : undefined;
      return {
        chatSessionId,
        sceneId: input.sceneId,
        questResult,
        event
      };
    });
  }

  scanTimeTriggers(input = {}) {
    return this.withTrace('trigger-scan-time', input.chatSessionId, input, async () => {
      if (!this.timeManager) throw validationError('Time triggers require timeManager');
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const clock = this.timeManager.getClock({ chatSessionId, sceneId: input.sceneId }).data;
      const dueEvents = this.timeManager.findDueEvents({ chatSessionId, clock, includeDue: true });
      const dueWorldClocks = this.timeManager.findDueWorldClocks({ chatSessionId, clock, includePaused: Boolean(input.includePaused) });
      let resolvedEvents;
      if (input.apply) {
        resolvedEvents = this.timeManager.resolveDueEvents({
          chatSessionId,
          clock,
          markResolved: Boolean(input.markResolved)
        });
      }
      const pulses = [];
      if (input.apply && input.runWorldPulses) {
        for (const record of dueWorldClocks) {
          pulses.push(await this.timeManager.runWorldPulse({
            chatSessionId,
            worldClockId: record.data.worldClockId,
            sceneId: record.data.sceneId || input.sceneId,
            useLlm: false,
            force: input.forceWorldPulse
          }));
        }
      }
      if (input.apply) {
        this.recordTriggerEvent({
          chatSessionId,
          sceneId: input.sceneId || clock.sceneId,
          triggerType: 'time',
          status: 'applied',
          payload: { clock, runWorldPulses: Boolean(input.runWorldPulses) },
          result: {
            dueEvents: dueEvents.map((event) => event.data),
            dueWorldClocks: dueWorldClocks.map((record) => record.data),
            resolvedEvents,
            pulses: pulses.map((pulse) => pulse.pulse)
          },
          source: input.source || 'time-trigger'
        });
      }
      return {
        chatSessionId,
        clock,
        dueEvents,
        dueWorldClocks,
        resolvedEvents,
        pulses,
        apply: Boolean(input.apply)
      };
    });
  }

  scanPartyAssignmentTriggers(input = {}) {
    return this.withTrace('trigger-party-assignments', input.chatSessionId, input, () => {
      if (!this.partyManager) throw validationError('Party assignment triggers require partyManager');
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const apply = Boolean(input.apply);
      const listed = this.partyManager.listMembers({
        chatSessionId,
        partyId: input.partyId,
        includeInactive: true,
        activityStatus: input.activityStatus || 'assigned',
        limit: input.limit || 500
      });
      const due = listed.records
        .map((record) => ({ record, dueInfo: assignmentDueInfo(record.data.assignment, input) }))
        .filter((item) => item.dueInfo.due || input.force);
      const results = [];
      for (const item of due) {
        let updated;
        if (apply) {
          const assignment = {
            ...item.record.data.assignment,
            status: input.assignmentStatus || 'due',
            updatedAt: this.now()
          };
          updated = this.partyManager.patchMember({
            chatSessionId,
            partyId: item.record.data.partyId,
            id: item.record.id,
            patch: {
              assignment,
              availability: {
                ...(item.record.data.availability || {}),
                canJoinCurrentScene: false,
                reason: 'assignment_due'
              },
              source: input.source || 'party-assignment-trigger'
            }
          });
          this.recordTriggerEvent({
            chatSessionId,
            triggerType: 'party_assignment_due',
            status: 'applied',
            partyMemberIds: [item.record.data.memberId],
            payload: { dueInfo: item.dueInfo, assignment: item.record.data.assignment },
            result: { member: updated.data },
            source: input.source || 'party-assignment-trigger'
          });
        }
        results.push({
          memberId: item.record.data.memberId,
          npcId: item.record.data.npcId,
          dueInfo: item.dueInfo,
          applied: Boolean(updated),
          record: updated
        });
      }
      return {
        chatSessionId,
        partyId: listed.partyId,
        apply,
        count: results.length,
        results
      };
    });
  }

  rollEncounterTrigger(input = {}) {
    return this.withTrace('trigger-roll-encounter', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeSceneId(input.sceneId);
      const chance = normalizeProbability(input.chance ?? input.encounterChance ?? 0.1, 'chance');
      const roll = normalizeUnitRoll(input.roll ?? input.triggerRoll ?? this.random(), 'roll');
      const triggered = input.force === true || roll < chance;
      const table = normalizeEncounterTable(input.table || input.encounterTable || DEFAULT_ENCOUNTER_TABLE);
      const pickRoll = normalizeUnitRoll(input.pickRoll ?? input.tableRoll ?? this.random(), 'pickRoll');
      const selected = triggered ? pickWeighted(table, pickRoll) : undefined;
      const result = {
        chatSessionId,
        sceneId,
        chance,
        roll,
        triggered,
        pickRoll,
        selected,
        table
      };
      let event;
      if (input.apply) {
        event = this.recordTriggerEvent({
          chatSessionId,
          sceneId,
          triggerType: 'encounter',
          status: triggered ? 'triggered' : 'skipped',
          actorIds: normalizeStringArray(input.actorIds || input.npcIds),
          payload: { chance, roll, pickRoll, tableId: input.tableId },
          result: { triggered, selected },
          source: input.source || 'encounter-trigger'
        });
      }
      return {
        ...result,
        event,
        apply: Boolean(input.apply)
      };
    });
  }

  listTriggerEvents({
    chatSessionId,
    triggerType,
    status,
    sceneId,
    filter = {},
    sort = [{ field: 'createdAtIso', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openEventManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (triggerType) mergedFilter.triggerType = String(triggerType);
    if (status) mergedFilter.status = String(status);
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    return {
      ...manager.queryRecords(TRIGGER_EVENTS_COLLECTION, {
        filter: mergedFilter,
        sort,
        limit,
        offset
      }),
      chatSessionId: normalizedChatSessionId
    };
  }

  recordTriggerEvent(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openEventManager(chatSessionId);
    const event = normalizeTriggerEvent(input, { now: this.now });
    return manager.upsertRecord(TRIGGER_EVENTS_COLLECTION, event, { id: event.eventId });
  }

  tickActorStatuses(actor, { chatSessionId, timing, turnActorId, apply, decrement, source }) {
    const results = [];
    for (const status of normalizeArray(actor.specialStatuses)) {
      if (!status || status.active === false) continue;
      const metadata = normalizeObject(status.metadata);
      const match = statusTickMatch(metadata, timing, {
        actorId: actor.npcId,
        turnActorId
      });
      const periodic = normalizePeriodicEffect(status, metadata);
      const hasEffect = periodic.damage.length > 0 || periodic.healing.length > 0;
      const applyPeriodic = hasEffect && match.periodic;
      const shouldDecrement = decrement && match.duration && Number.isFinite(Number(status.remainingTurns));
      if (!applyPeriodic && !shouldDecrement) continue;

      const nextRemaining = shouldDecrement
        ? Number(status.remainingTurns) - 1
        : status.remainingTurns;
      const expires = shouldDecrement && Number.isFinite(Number(nextRemaining)) && Number(nextRemaining) <= 0;

      let settlement;
      if (apply && applyPeriodic) {
        settlement = this.effectSettlement.applySettlement({
          chatSessionId,
          sceneId: actor.sceneId,
          source,
          targets: [{
            npcId: actor.npcId,
            hit: true,
            damage: periodic.damage,
            healing: periodic.healing
          }]
        });
      }
      let patchRecord;
      if (apply && (decrement || expires)) {
        const current = settlement?.records?.[0]?.data || actor;
        const conditions = new Set(normalizeStringArray(current.statusBar?.conditions));
        if (expires) {
          conditions.delete(status.id);
          conditions.delete(status.name);
        }
        patchRecord = this.npcState.patchNpcState({
          chatSessionId,
          sceneId: actor.sceneId,
          npcId: actor.npcId,
          specialStatuses: [{
            id: status.id,
            name: status.name,
            remainingTurns: expires ? 0 : nextRemaining,
            metadata: status.metadata,
            _delete: expires
          }],
          statusBar: {
            conditions: [...conditions].filter(Boolean)
          },
          source
        }, { source }).record;
      }
      if (apply) {
        this.recordTriggerEvent({
          chatSessionId,
          sceneId: actor.sceneId,
          triggerType: 'status_tick',
          status: 'applied',
          actorIds: [actor.npcId],
          payload: { status, timing, periodic, nextRemaining, expires },
          result: {
            settlement: settlement ? { totalDamage: settlement.totalDamage, totalHealing: settlement.totalHealing } : undefined,
            recordId: patchRecord?.id || settlement?.records?.[0]?.id
          },
          source
        });
      }
      results.push({
        actorId: actor.npcId,
        statusId: status.id,
        timing,
        turnActorId,
        match,
        periodic,
        remainingTurnsBefore: status.remainingTurns,
        remainingTurnsAfter: expires ? 0 : nextRemaining,
        expires,
        applied: apply,
        settlement,
        record: patchRecord
      });
    }
    return results;
  }

  previewDueQuestClocks(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    this.questManager.describe(chatSessionId);
    const { manager } = this.questManager.openManager(chatSessionId);
    return manager.queryRecords(QUEST_CLOCKS_COLLECTION, {
      filter: { status: input.includePaused ? { in: ['active', 'paused'] } : 'active' },
      limit: 500
    }).records.filter((record) => questClockDue(record.data, input)).map((record) => ({
      id: record.id,
      ...record.data,
      dueInfo: questClockDueInfo(record.data, input)
    }));
  }

  openEventManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.snapshot({ chatSessionId: normalizedChatSessionId, sceneId: input.sceneId });
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = fn();
      if (output && typeof output.then === 'function') {
        return output.then((resolved) => this.finishTrace(trace, normalizedChatSessionId, input, resolved)).catch((error) => {
          this.traceRecorder.fail(trace, { error });
          throw error;
        });
      }
      return this.finishTrace(trace, normalizedChatSessionId, input, output);
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  finishTrace(trace, chatSessionId, input, output) {
    const after = this.snapshot({ chatSessionId, sceneId: input.sceneId });
    return {
      ...output,
      trace: this.traceRecorder.finish(trace, {
        output,
        stateAfter: after
      })
    };
  }

  snapshot({ chatSessionId, sceneId } = {}) {
    const snapshot = {
      chatSessionId,
      sceneId,
      actors: this.npcState.stateSnapshot({
        chatSessionId,
        sceneId,
        includeAllScenes: !sceneId
      })
    };
    if (this.appDatabase) {
      this.ensureCollection(chatSessionId);
      const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
      snapshot.triggerEvents = manager.queryRecords(TRIGGER_EVENTS_COLLECTION, { limit: 100 }).records.map((record) => ({ id: record.id, ...record.data }));
    }
    return snapshot;
  }
}

function decideDeathTrigger(actor, input = {}) {
  const hp = firstFiniteNumber(actor.values?.hp, actor.statusBar?.hp, 0);
  const maxHp = firstFiniteNumber(actor.values?.maxHp, actor.statusBar?.maxHp, hp);
  const deathSaves = {
    successes: clampInteger(actor.statusBar?.deathSaves?.successes ?? actor.values?.deathSaveSuccesses ?? 0, 0, 3),
    failures: clampInteger(actor.statusBar?.deathSaves?.failures ?? actor.values?.deathSaveFailures ?? 0, 0, 3)
  };
  const conditions = new Set(normalizeStringArray(actor.statusBar?.conditions));
  const dead = actor.statusBar?.deathSaves?.dead === true || conditions.has('dead') || hasStatus(actor, 'dead') || deathSaves.failures >= 3;
  if (dead) {
    return {
      triggered: true,
      state: 'dead',
      reason: deathSaves.failures >= 3 ? 'death_save_failures' : 'dead_marker_present',
      hp: 0,
      maxHp,
      deathSaves: { successes: deathSaves.successes, failures: 3 }
    };
  }
  if (hp <= 0) {
    const stable = actor.statusBar?.deathSaves?.stable === true || conditions.has('stable') || hasStatus(actor, 'stable');
    return {
      triggered: true,
      state: stable ? 'stable' : 'dying',
      reason: stable ? 'hp_zero_stable' : 'hp_zero',
      hp: 0,
      maxHp,
      deathSaves
    };
  }
  const shouldClearRecovered = input.clearRecovered !== false && (
    conditions.has('dying') || conditions.has('unconscious') || conditions.has('stable') || hasStatus(actor, 'dying') || hasStatus(actor, 'unconscious') || hasStatus(actor, 'stable')
  );
  if (shouldClearRecovered) {
    return {
      triggered: true,
      state: 'recovered',
      reason: 'hp_above_zero_clear_death_states',
      hp,
      maxHp,
      deathSaves: { successes: 0, failures: 0 }
    };
  }
  return {
    triggered: false,
    state: 'none',
    reason: 'no_death_trigger',
    hp,
    maxHp,
    deathSaves
  };
}

function buildDeathPatch(actor, decision, { chatSessionId, source }) {
  const conditions = new Set(normalizeStringArray(actor.statusBar?.conditions));
  const statusUpdates = [];
  const add = (id) => {
    conditions.add(id);
    statusUpdates.push({ id, name: id, active: true });
  };
  const remove = (id) => {
    conditions.delete(id);
    statusUpdates.push({ id, name: id, _delete: true });
  };
  if (decision.state === 'dead') {
    add('dead');
    remove('dying');
    remove('unconscious');
    remove('stable');
  } else if (decision.state === 'dying') {
    add('dying');
    add('unconscious');
    remove('dead');
    remove('stable');
  } else if (decision.state === 'stable') {
    add('stable');
    add('unconscious');
    remove('dead');
    remove('dying');
  } else if (decision.state === 'recovered') {
    remove('dead');
    remove('dying');
    remove('unconscious');
    remove('stable');
  }
  return {
    chatSessionId,
    sceneId: actor.sceneId,
    npcId: actor.npcId,
    actorType: actor.actorType,
    isPlayer: actor.isPlayer,
    playerId: actor.playerId,
    name: actor.name,
    values: {
      hp: decision.hp,
      maxHp: decision.maxHp,
      deathSaveSuccesses: decision.deathSaves.successes,
      deathSaveFailures: decision.deathSaves.failures
    },
    statusBar: {
      ...(actor.statusBar || {}),
      hp: decision.hp,
      maxHp: decision.maxHp,
      deathSaves: {
        successes: decision.deathSaves.successes,
        failures: decision.deathSaves.failures,
        dead: decision.state === 'dead',
        stable: decision.state === 'stable',
        dying: decision.state === 'dying'
      },
      conditions: [...conditions].filter(Boolean).sort()
    },
    specialStatuses: statusUpdates,
    source
  };
}

function buildRevivePatch(actor, { chatSessionId, sceneId, hp, addRevivedStatus, source }) {
  const conditions = new Set(normalizeStringArray(actor.statusBar?.conditions));
  for (const status of ['dead', 'dying', 'unconscious', 'stable']) conditions.delete(status);
  const specialStatuses = [
    { id: 'dead', name: 'dead', _delete: true },
    { id: 'dying', name: 'dying', _delete: true },
    { id: 'unconscious', name: 'unconscious', _delete: true },
    { id: 'stable', name: 'stable', _delete: true }
  ];
  if (addRevivedStatus) {
    specialStatuses.push({ id: 'revived', name: 'revived', active: true, remainingTurns: 1, description: 'Recently revived.' });
  }
  const maxHp = firstFiniteNumber(actor.values?.maxHp, actor.statusBar?.maxHp, hp);
  return {
    chatSessionId,
    sceneId: actor.sceneId || sceneId,
    npcId: actor.npcId,
    actorType: actor.actorType,
    isPlayer: actor.isPlayer,
    playerId: actor.playerId,
    name: actor.name,
    values: {
      hp,
      maxHp,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0
    },
    statusBar: {
      ...(actor.statusBar || {}),
      hp,
      maxHp,
      deathSaves: {
        successes: 0,
        failures: 0,
        dead: false,
        stable: false,
        dying: false
      },
      conditions: [...conditions].filter(Boolean).sort()
    },
    specialStatuses,
    source
  };
}

function resolveReviveHp(actor, input = {}) {
  const maxHp = firstFiniteNumber(actor.values?.maxHp, actor.statusBar?.maxHp, input.maxHp, 1);
  const requested = input.hp ?? input.reviveHp ?? input.amount ?? 1;
  const hp = Number(requested);
  if (!Number.isFinite(hp) || hp <= 0) throw validationError('revive hp must be a positive number');
  if (input.allowOverheal) return hp;
  return Math.min(maxHp, hp);
}

function normalizePeriodicEffect(status, metadata) {
  const periodic = normalizeObject(metadata.periodic);
  const damage = normalizeDamageList(periodic.damage ?? metadata.damage ?? (metadata.damagePerTurn ?? metadata.damagePerRound ?? metadata.damageAmount));
  const healing = normalizeHealingList(periodic.healing ?? metadata.healing ?? (metadata.healingPerTurn ?? metadata.healingPerRound ?? metadata.healingAmount));
  return { damage, healing };
}

function normalizeDamageList(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === 'number' || typeof item === 'string') return { amount: Number(item), type: 'untyped' };
    const object = normalizeObject(item);
    return {
      type: normalizeOptionalText(object.type || object.damageType) || 'untyped',
      amount: Number(object.amount ?? object.total ?? object.value ?? 0),
      note: normalizeOptionalText(object.note || object.description)
    };
  }).filter((item) => Number.isFinite(item.amount) && item.amount > 0);
}

function normalizeHealingList(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === 'number' || typeof item === 'string') return { amount: Number(item), type: 'healing' };
    const object = normalizeObject(item);
    return {
      type: normalizeOptionalText(object.type) || 'healing',
      amount: Number(object.amount ?? object.total ?? object.value ?? 0),
      note: normalizeOptionalText(object.note || object.description)
    };
  }).filter((item) => Number.isFinite(item.amount) && item.amount > 0);
}

function statusTickMatch(metadata, timing, context = {}) {
  const periodic = normalizeObject(metadata.periodic);
  const duration = normalizeObject(metadata.duration);
  const periodicTiming = normalizeOptionalText(metadata.tickTiming || metadata.timing || metadata.triggerTiming || periodic.tickTiming);
  const durationTiming = normalizeOptionalText(
    metadata.durationTiming
    || metadata.expiresAtTiming
    || metadata.expireTiming
    || duration.tickTiming
    || duration.timing
    || duration.expiresAtTiming
    || periodic.durationTiming
    || periodicTiming
  );
  return {
    periodic: timingMatches(periodicTiming, timing) && actorTurnMatches(metadata, context, periodic),
    duration: timingMatches(durationTiming, timing) && actorTurnMatches(metadata, context, duration),
    periodicTiming,
    durationTiming
  };
}

function timingMatches(configured, timing) {
  const expected = normalizeOptionalText(configured);
  if (!expected) return true;
  if (expected === timing) return true;
  if (expected === 'round' && ['round', 'startRound', 'endRound'].includes(timing)) return true;
  if (expected === 'turn' && ['turn', 'startTurn', 'endTurn'].includes(timing)) return true;
  return false;
}

function actorTurnMatches(metadata, context = {}, scoped = {}) {
  const requiredActorId = normalizeOptionalText(
    scoped.expiresOnActorId
    || scoped.durationActorId
    || scoped.turnActorId
    || scoped.ownerActorId
    || metadata.expiresOnActorId
    || metadata.durationActorId
    || metadata.turnActorId
    || metadata.ownerActorId
  );
  if (!requiredActorId) return true;
  const actual = normalizeOptionalText(context.turnActorId);
  return Boolean(actual && actual === requiredActorId);
}

function questClockDue(clock = {}, input = {}) {
  return questClockDueInfo(clock, input).due;
}

function questClockDueInfo(clock = {}, input = {}) {
  const elapsed = input.elapsedSeconds ?? input.clock?.elapsedSeconds;
  const round = input.roundNumber ?? input.clock?.roundNumber ?? input.encounter?.roundNumber;
  const dueElapsed = clock.expiresAtElapsedSeconds !== undefined && clock.expiresAtElapsedSeconds !== null && clock.expiresAtElapsedSeconds !== ''
    && elapsed !== undefined && Number(elapsed) >= Number(clock.expiresAtElapsedSeconds);
  const dueRound = clock.expiresAtRound !== undefined && clock.expiresAtRound !== null && clock.expiresAtRound !== ''
    && round !== undefined && Number(round) >= Number(clock.expiresAtRound);
  const dueSceneEnd = Boolean(clock.expiresAtSceneEnd && input.sceneEnded);
  return {
    due: Boolean(dueElapsed || dueRound || dueSceneEnd),
    dueElapsed,
    dueRound,
    dueSceneEnd,
    elapsedSeconds: elapsed,
    roundNumber: round
  };
}

function assignmentDueInfo(assignment = {}, input = {}) {
  const due = normalizeObject(assignment.due);
  const elapsed = input.elapsedSeconds ?? input.clock?.elapsedSeconds;
  const round = input.roundNumber ?? input.clock?.roundNumber ?? input.encounter?.roundNumber;
  const dueElapsed = due.elapsedSeconds !== undefined && elapsed !== undefined && Number(elapsed) >= Number(due.elapsedSeconds);
  const dueRound = due.roundNumber !== undefined && round !== undefined && Number(round) >= Number(due.roundNumber);
  const dueSceneEnd = Boolean(due.sceneEnd && input.sceneEnded);
  return {
    due: Boolean(dueElapsed || dueRound || dueSceneEnd),
    dueElapsed,
    dueRound,
    dueSceneEnd,
    elapsedSeconds: elapsed,
    roundNumber: round
  };
}

function normalizeEncounterTable(value) {
  const items = normalizeArray(value).map((item, index) => {
    const object = normalizeObject(item);
    return {
      id: normalizeOptionalText(object.id) || `encounter_${index + 1}`,
      title: normalizeOptionalText(object.title || object.name) || `Encounter ${index + 1}`,
      description: normalizeOptionalText(object.description || object.summary),
      weight: normalizePositiveNumber(object.weight ?? 1, 'encounter.weight'),
      category: normalizeOptionalText(object.category),
      challenge: normalizeOptionalText(object.challenge || object.difficulty),
      payload: normalizeObject(object.payload || object.metadata)
    };
  });
  if (items.length === 0) throw validationError('encounter table must not be empty');
  return items;
}

function pickWeighted(table, roll) {
  const total = table.reduce((sum, item) => sum + item.weight, 0);
  let cursor = roll * total;
  for (const item of table) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return table[table.length - 1];
}

function normalizeTriggerEvent(input = {}, { now = () => new Date().toISOString() } = {}) {
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId, 'chatSessionId'),
    eventId: normalizeOptionalText(input.eventId) || createId('triggerevent'),
    triggerType: normalizeOptionalText(input.triggerType) || 'generic',
    sceneId: normalizeOptionalText(input.sceneId),
    status: normalizeOptionalText(input.status) || 'triggered',
    actorIds: normalizeStringArray(input.actorIds),
    partyMemberIds: normalizeStringArray(input.partyMemberIds),
    questIds: normalizeStringArray(input.questIds),
    payload: normalizeObject(input.payload),
    result: normalizeObject(input.result),
    source: normalizeOptionalText(input.source) || 'trigger-manager',
    createdAtIso: normalizeOptionalText(input.createdAtIso) || now()
  };
}

function hasStatus(actor, id) {
  const target = String(id).toLowerCase();
  return normalizeArray(actor.specialStatuses).some((status) => (
    String(status?.id || '').toLowerCase() === target || String(status?.name || '').toLowerCase() === target
  ) && status.active !== false);
}

function compactActorState(actor = {}) {
  return {
    npcId: actor.npcId,
    name: actor.name,
    sceneId: actor.sceneId,
    hp: actor.values?.hp ?? actor.statusBar?.hp,
    maxHp: actor.values?.maxHp ?? actor.statusBar?.maxHp,
    deathSaves: actor.statusBar?.deathSaves,
    conditions: actor.statusBar?.conditions,
    specialStatuses: normalizeArray(actor.specialStatuses).map((status) => ({
      id: status.id,
      name: status.name,
      active: status.active,
      remainingTurns: status.remainingTurns
    }))
  };
}

function sanitizeEventInput(input = {}) {
  const clone = { ...input };
  delete clone.text;
  delete clone.content;
  return clone;
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  return [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))];
}

function normalizeRequiredText(value, field) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError(`${field} is required`);
  return text;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || 'current';
}

function normalizeProbability(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw validationError(`${field} must be between 0 and 1`);
  return number;
}

function normalizeUnitRoll(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw validationError(`${field} must be between 0 and 1`);
  return number;
}

function normalizePositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw validationError(`${field} must be positive`);
  return number;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function secureRandomUnit() {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'TriggerManagerValidationError';
  error.statusCode = 400;
  return error;
}
