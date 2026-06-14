// @ts-nocheck
import { runDiceCheck } from '../dice/dice-engine.js';
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';

const DICE_REMOTE_CONTROL_COLLECTION = 'dice_remote_controls';
const DICE_REMOTE_CONTROL_ID = 'global';

export const DICE_PLUGIN = {
  id: 'game.dice',
  name: 'Game Dice Tools',
  version: '0.1.0',
  description: 'D&D-inspired dice checks with cryptographic randomness, modifiers, inspiration rerolls, and critical outcomes.',
  enabled: true,
  permissions: ['random', 'npc-state:read', 'npc-state:write'],
  tools: [
    {
      name: 'check',
      title: 'Dice Check',
      description: 'Resolve a D&D/Baldur-style dice check. Supports NdM dice sums, fixed and named modifiers, advantage/disadvantage, inspiration rerolls, forced outcomes, critical success, and critical failure.',
      inputSchema: {
        type: 'object',
        properties: {
          successThreshold: {
            type: 'integer',
            description: 'Difficulty class / target threshold. The check succeeds when selected total >= this value.'
          },
          diceCount: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'How many dice to roll and sum for each attempt.'
          },
          rollCount: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Alias for diceCount.'
          },
          diceSides: {
            type: 'integer',
            minimum: 2,
            maximum: 10000,
            description: 'How many sides each die has, e.g. 20 for d20 or 6 for d6.'
          },
          modifier: {
            type: 'integer',
            default: 0,
            description: 'Fixed buff/debuff added to the summed dice result.'
          },
          fixedModifier: {
            type: 'integer',
            default: 0,
            description: 'Alias for modifier.'
          },
          buff: {
            type: 'integer',
            default: 0,
            description: 'Positive fixed bonus added to the check.'
          },
          debuff: {
            type: 'integer',
            default: 0,
            description: 'Positive fixed penalty subtracted from the check.'
          },
          abilityModifier: {
            type: 'integer',
            default: 0,
            description: 'Ability score modifier added to the check.'
          },
          proficiencyBonus: {
            type: 'integer',
            default: 0,
            description: 'Proficiency or expertise bonus added to the check.'
          },
          modifiers: {
            type: 'array',
            description: 'Named extra buffs or debuffs.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'integer' }
              },
              required: ['name', 'value'],
              additionalProperties: false
            }
          },
          forceMode: {
            type: 'string',
            enum: ['normal', 'success', 'failure', 'criticalSuccess', 'criticalFailure'],
            default: 'normal',
            description: 'Override the final outcome while still recording the roll.'
          },
          rollMode: {
            type: 'string',
            enum: ['normal', 'advantage', 'disadvantage'],
            default: 'normal',
            description: 'Normal rolls once; advantage rolls two candidates and keeps the higher sum; disadvantage keeps the lower sum.'
          },
          inspirationPoints: {
            type: 'integer',
            minimum: 0,
            maximum: 20,
            default: 0,
            description: 'How many failed checks may be rerolled. The first success is selected; otherwise the best total is kept.'
          },
          criticalMode: {
            type: 'string',
            enum: ['none', 'd20', 'maxTotal', 'minTotal'],
            default: 'd20',
            description: 'd20 means natural 20 is critical success and natural 1 is critical failure for 1d20 checks.'
          }
        },
        required: ['successThreshold', 'diceSides'],
        anyOf: [
          { required: ['diceCount'] },
          { required: ['rollCount'] }
        ],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          outcome: {
            type: 'string',
            enum: ['success', 'failure', 'criticalSuccess', 'criticalFailure']
          },
          success: { type: 'boolean' },
          failure: { type: 'boolean' },
          critical: { type: 'boolean' },
          criticalSuccess: { type: 'boolean' },
          criticalFailure: { type: 'boolean' },
          total: { type: 'integer' }
        },
        required: ['outcome', 'success', 'failure', 'critical', 'criticalSuccess', 'criticalFailure'],
        additionalProperties: true
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['dice', 'dnd', 'rpg', 'check'],
      annotations: {
        readOnlyHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: 'remote_control',
      title: 'Remote Control Dice',
      description: 'Debug-only official cheat switch. Select a global dice side count, and optionally a fixed face value, so later game.dice.check calls use that dice instead of their requested dice.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set', 'clear'],
            default: 'get'
          },
          diceSides: {
            type: 'integer',
            minimum: 2,
            maximum: 10000,
            description: 'Selected dice sides. When set, all later game.dice.check calls use this dice side count.'
          },
          sides: {
            type: 'integer',
            minimum: 2,
            maximum: 10000,
            description: 'Alias for diceSides.'
          },
          fixedRoll: {
            anyOf: [
              { type: 'integer', minimum: 1, maximum: 10000 },
              { type: 'null' }
            ],
            description: 'Optional fixed face value. If omitted or null, only diceSides is controlled and the roll remains random.'
          },
          roll: {
            type: 'integer',
            minimum: 1,
            maximum: 10000,
            description: 'Alias for fixedRoll.'
          },
          value: {
            type: 'integer',
            minimum: 1,
            maximum: 10000,
            description: 'Alias for fixedRoll.'
          },
          reason: { type: 'string' },
          source: { type: 'string' }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'set', 'cleared', 'requires_authorization']
          },
          config: { type: 'object', additionalProperties: true },
          storage: { type: 'string' }
        },
        required: ['status', 'config', 'storage'],
        additionalProperties: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'global-debug',
        stateTarget: DICE_REMOTE_CONTROL_COLLECTION,
        debugOnly: true,
        officialCheat: true
      },
      tags: ['dice', 'debug', 'cheat', 'remote-control']
    },
    {
      name: 'offer_inspiration_reroll',
      title: 'Offer Inspiration Reroll',
      description: 'After a dice result, read the actor state inspiration field. If inspiration is available, return a player choice prompt; when the player confirms reroll, spend one inspiration point and roll once again.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          npcId: { type: 'string' },
          actorId: { type: 'string' },
          playerId: { type: 'string' },
          recordId: { type: 'string' },
          stateRecordId: { type: 'string' },
          diceResult: {
            type: 'object',
            description: 'The previous game.dice.check output, or a compatible dice result object.',
            additionalProperties: true
          },
          diceInput: {
            type: 'object',
            description: 'Original game.dice.check input. If omitted, the tool reconstructs a best-effort input from diceResult.',
            additionalProperties: true
          },
          decision: {
            type: 'string',
            enum: ['ask', 'reroll', 'decline'],
            default: 'ask',
            description: 'ask returns a player prompt; reroll spends one inspiration after user authorization; decline keeps the original result.'
          },
          offerOn: {
            type: 'string',
            enum: ['failure', 'any'],
            default: 'failure',
            description: 'failure only offers reroll for failed results; any allows the prompt for every non-forced result.'
          },
          allowForcedReroll: {
            type: 'boolean',
            default: false
          },
          source: {
            type: 'string'
          }
        },
        required: ['chatSessionId', 'diceResult'],
        anyOf: [
          { required: ['npcId'] },
          { required: ['actorId'] },
          { required: ['playerId'] },
          { required: ['recordId'] },
          { required: ['stateRecordId'] }
        ],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['skipped', 'needs_player_decision', 'declined', 'rerolled']
          },
          reason: { type: 'string' },
          actorId: { type: 'string' },
          availableInspiration: { type: 'number' },
          prompt: { type: 'string' },
          choices: { type: 'array', items: { type: 'object', additionalProperties: true } },
          originalResult: { type: 'object', additionalProperties: true },
          rerollResult: { type: 'object', additionalProperties: true },
          finalResult: { type: 'object', additionalProperties: true }
        },
        required: ['status', 'originalResult'],
        additionalProperties: true
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        stateTarget: 'npc_structured_states.statusBar.inspiration',
        requiresPlayerDecisionForMutation: true
      },
      tags: ['dice', 'dnd', 'rpg', 'inspiration', 'reroll', 'npc-state'],
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    }
  ]
};

export function createDiceHandlers({ appDatabase, dataManager, npcState, stateDatabase, randomInt } = {}) {
  const remoteControl = new DiceRemoteControl({ dataManager });
  const inspirationReroll = new DiceInspirationReroll({
    appDatabase,
    npcState,
    stateDatabase,
    randomInt,
    rollCheck: (input) => remoteControl.runCheck(input, { randomInt })
  });
  return {
    check: async ({ input }) => remoteControl.runCheck(input, { randomInt }),
    remote_control: async ({ input, context }) => remoteControl.handle(input, context),
    offer_inspiration_reroll: async ({ input, context }) => inspirationReroll.handle(input, context)
  };
}

class DiceRemoteControl {
  constructor({ dataManager } = {}) {
    this.dataManager = dataManager;
    this.memoryConfig = inactiveRemoteConfig();
  }

  handle(input = {}, context = {}) {
    const action = input.action || 'get';
    if (action === 'clear') {
      if (!isUserAuthorized(context)) return this.requiresAuthorization('clear');
      const config = this.saveConfig({
        ...inactiveRemoteConfig(),
        reason: normalizeOptionalText(input.reason),
        source: normalizeOptionalText(input.source || 'dice-remote-control')
      });
      return {
        status: 'cleared',
        config,
        storage: this.storageKind(),
        message: 'Dice remote control cleared.'
      };
    }

    if (action === 'set') {
      if (!isUserAuthorized(context)) return this.requiresAuthorization('set');
      const config = this.saveConfig(this.normalizeSetInput(input));
      return {
        status: config.enabled ? 'set' : 'inactive',
        config,
        storage: this.storageKind(),
        message: config.enabled
          ? 'Dice remote control enabled.'
          : 'Dice remote control is inactive because no diceSides was selected.'
      };
    }

    const config = this.readConfig();
    return {
      status: config.enabled ? 'active' : 'inactive',
      config,
      storage: this.storageKind()
    };
  }

  runCheck(input = {}, { randomInt } = {}) {
    const config = this.readConfig();
    if (!config.enabled || !config.diceSides) {
      return runDiceCheck(input, { randomInt });
    }

    const effectiveInput = {
      ...input,
      diceSides: config.diceSides,
      sides: config.diceSides
    };
    const controlledRandomInt = config.fixedRoll === undefined
      ? randomInt
      : () => config.fixedRoll;
    const result = runDiceCheck(effectiveInput, { randomInt: controlledRandomInt });
    return {
      ...result,
      remoteControl: {
        enabled: true,
        diceSides: config.diceSides,
        fixedRoll: config.fixedRoll ?? null,
        fixedRollActive: config.fixedRoll !== undefined,
        originalDiceSides: input.diceSides ?? input.sides,
        effectiveDiceSides: config.diceSides,
        storage: this.storageKind(),
        configUpdatedAt: config.updatedAt
      }
    };
  }

  normalizeSetInput(input = {}) {
    const diceSides = normalizeInteger(input.diceSides ?? input.sides, 'diceSides', 2, 10000, { optional: true });
    const rawFixed = input.fixedRoll !== undefined ? input.fixedRoll : (input.roll ?? input.value);
    const fixedRoll = normalizeInteger(rawFixed, 'fixedRoll', 1, 10000, { optional: true, nullAsUndefined: true });
    if (diceSides === undefined) {
      return {
        ...inactiveRemoteConfig(),
        fixedRoll,
        reason: normalizeOptionalText(input.reason),
        source: normalizeOptionalText(input.source || 'dice-remote-control')
      };
    }
    if (fixedRoll !== undefined && fixedRoll > diceSides) {
      throw validationError(`fixedRoll must be between 1 and diceSides (${diceSides})`);
    }
    return {
      enabled: true,
      diceSides,
      fixedRoll,
      fixedRollActive: fixedRoll !== undefined,
      reason: normalizeOptionalText(input.reason),
      source: normalizeOptionalText(input.source || 'dice-remote-control'),
      updatedAt: new Date().toISOString()
    };
  }

  requiresAuthorization(action) {
    return {
      status: 'requires_authorization',
      action,
      config: this.readConfig(),
      storage: this.storageKind(),
      message: 'Dice remote control changes require explicit user authorization.'
    };
  }

  readConfig() {
    if (!this.dataManager) return normalizeRemoteConfig(this.memoryConfig);
    this.ensureCollection();
    const record = this.dataManager.getRecord(DICE_REMOTE_CONTROL_COLLECTION, DICE_REMOTE_CONTROL_ID, { missing: 'undefined' });
    return normalizeRemoteConfig(record?.data || this.memoryConfig);
  }

  saveConfig(config) {
    const normalized = normalizeRemoteConfig({
      ...config,
      updatedAt: config.updatedAt || new Date().toISOString()
    });
    if (!this.dataManager) {
      this.memoryConfig = normalized;
      return normalized;
    }
    this.ensureCollection(normalized);
    const record = this.dataManager.upsertRecord(DICE_REMOTE_CONTROL_COLLECTION, normalized, {
      id: DICE_REMOTE_CONTROL_ID
    });
    return normalizeRemoteConfig(record.data);
  }

  ensureCollection(sample = inactiveRemoteConfig()) {
    this.dataManager?.ensureCollection(DICE_REMOTE_CONTROL_COLLECTION, sample);
  }

  storageKind() {
    return this.dataManager ? 'dataManager' : 'memory';
  }
}

class DiceInspirationReroll {
  constructor({ appDatabase, npcState, stateDatabase, randomInt, rollCheck } = {}) {
    this.npcState = npcState || stateDatabase || (appDatabase
      ? new NpcStructuredStateDatabase({ appDatabase, trace: false })
      : undefined);
    this.randomInt = randomInt;
    this.rollCheck = rollCheck || ((input) => runDiceCheck(input, { randomInt: this.randomInt }));
  }

  handle(input = {}, context = {}) {
    const originalResult = normalizeObject(input.diceResult);
    const decision = normalizeDecision(input.decision);
    const offerOn = input.offerOn || 'failure';

    if (!this.npcState) {
      return skipped(input, originalResult, 'npc_state_unavailable');
    }
    if (originalResult.forced && input.allowForcedReroll !== true) {
      return skipped(input, originalResult, 'forced_result');
    }
    if (offerOn !== 'any' && !isFailedDiceResult(originalResult)) {
      return skipped(input, originalResult, 'roll_not_failed');
    }

    const actorRecord = this.readActorRecord(input);
    if (!actorRecord) {
      return skipped(input, originalResult, 'actor_state_not_found');
    }

    const actor = actorRecord.data || {};
    const pool = findInspirationPool(actor);
    if (pool.current <= 0) {
      return {
        ...baseOutput(input, originalResult, actor, pool),
        status: 'skipped',
        reason: 'no_inspiration',
        finalResult: originalResult
      };
    }

    if (decision === 'decline') {
      return {
        ...baseOutput(input, originalResult, actor, pool),
        status: 'declined',
        reason: 'player_declined',
        finalResult: originalResult
      };
    }

    if (decision !== 'reroll') {
      return playerDecisionOutput(input, originalResult, actor, pool);
    }

    if (!isUserAuthorized(context)) {
      return {
        ...playerDecisionOutput(input, originalResult, actor, pool),
        reason: 'missing_user_authorization'
      };
    }

    const rerollInput = buildRerollInput(input.diceInput, originalResult);
    const rerollResult = this.rollCheck(rerollInput);
    const after = Math.max(0, pool.current - 1);
    const patch = buildInspirationPatch(pool, after);
    const stateUpdate = this.npcState.patchNpcState({
      chatSessionId: input.chatSessionId,
      sceneId: actor.sceneId || input.sceneId || 'current',
      npcId: actor.npcId || input.actorId || input.npcId || input.playerId,
      actorType: actor.actorType,
      isPlayer: actor.isPlayer,
      playerId: actor.playerId,
      name: actor.name,
      ...patch,
      source: input.source || 'dice-inspiration-reroll'
    }, { source: input.source || 'dice-inspiration-reroll' });

    return {
      ...baseOutput(input, originalResult, actor, pool),
      status: 'rerolled',
      reason: 'player_confirmed',
      spent: true,
      inspirationBefore: pool.current,
      inspirationAfter: after,
      resourceField: pool.path.join('.'),
      rerollInput,
      rerollResult,
      finalResult: rerollResult,
      canOfferAgain: isFailedDiceResult(rerollResult) && after > 0,
      stateUpdate
    };
  }

  readActorRecord(input = {}) {
    try {
      const recordId = input.stateRecordId || input.recordId;
      if (recordId) {
        return this.npcState.getNpcState({
          chatSessionId: input.chatSessionId,
          sceneId: input.sceneId,
          id: recordId,
          recordId
        });
      }

      if (input.actorId || input.npcId) {
        return this.npcState.getNpcState({
          chatSessionId: input.chatSessionId,
          sceneId: input.sceneId,
          npcId: input.actorId || input.npcId
        });
      }

      if (input.playerId) {
        const listed = this.npcState.listNpcStates({
          chatSessionId: input.chatSessionId,
          sceneId: input.sceneId,
          playerId: input.playerId,
          limit: 1
        });
        return listed.records[0];
      }
    } catch (error) {
      if (error?.statusCode === 404) return undefined;
      throw error;
    }
    return undefined;
  }
}

function playerDecisionOutput(input, originalResult, actor, pool) {
  return {
    ...baseOutput(input, originalResult, actor, pool),
    status: 'needs_player_decision',
    reason: 'inspiration_available',
    prompt: `${actor.name || actor.npcId || '角色'} 还有 ${pool.current} 点激励。要消耗 1 点激励重投吗？`,
    choices: [
      {
        id: 'reroll',
        label: '重投',
        toolInput: {
          ...copyIdentityInput(input),
          diceResult: originalResult,
          diceInput: input.diceInput,
          decision: 'reroll'
        },
        requiresUserAuthorization: true
      },
      {
        id: 'decline',
        label: '保留结果',
        toolInput: {
          ...copyIdentityInput(input),
          diceResult: originalResult,
          diceInput: input.diceInput,
          decision: 'decline'
        }
      }
    ],
    finalResult: originalResult
  };
}

function baseOutput(input, originalResult, actor = {}, pool = { current: 0, path: ['statusBar', 'inspiration'] }) {
  return {
    actorId: actor.npcId || input.actorId || input.npcId || input.playerId,
    chatSessionId: input.chatSessionId,
    sceneId: actor.sceneId || input.sceneId || 'current',
    availableInspiration: pool.current,
    resourceField: pool.path.join('.'),
    originalResult
  };
}

function skipped(input, originalResult, reason) {
  return {
    ...baseOutput(input, originalResult),
    status: 'skipped',
    reason,
    finalResult: originalResult
  };
}

function copyIdentityInput(input = {}) {
  return {
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId,
    npcId: input.npcId,
    actorId: input.actorId,
    playerId: input.playerId,
    recordId: input.recordId,
    stateRecordId: input.stateRecordId,
    offerOn: input.offerOn,
    allowForcedReroll: input.allowForcedReroll,
    source: input.source
  };
}

function buildRerollInput(diceInput = {}, originalResult = {}) {
  const input = normalizeObject(diceInput);
  if (Object.keys(input).length > 0) {
    return {
      ...input,
      inspirationPoints: 0,
      inspirationRerolls: 0
    };
  }

  const dice = normalizeObject(originalResult.dice);
  return {
    successThreshold: Number(originalResult.successThreshold ?? originalResult.dc ?? originalResult.target ?? 10),
    diceCount: Number(dice.count ?? originalResult.diceCount ?? originalResult.rollCount ?? 1),
    diceSides: Number(dice.sides ?? originalResult.diceSides ?? originalResult.sides ?? 20),
    modifier: Number(originalResult.modifierTotal ?? originalResult.modifier ?? 0),
    rollMode: originalResult.rollMode || 'normal',
    criticalMode: originalResult.criticalMode || 'd20',
    forceMode: 'normal',
    inspirationPoints: 0
  };
}

function findInspirationPool(actor = {}) {
  const candidates = [
    ['statusBar', 'inspiration'],
    ['statusBar', 'inspirationPoints'],
    ['resources', 'inspiration'],
    ['resources', 'inspirationPoints'],
    ['resources', 'custom', 'inspiration'],
    ['resources', 'custom', 'inspirationPoints'],
    ['resources', 'skillUses', 'inspiration']
  ];

  for (const path of candidates) {
    const raw = getPath(actor, path);
    const current = inspirationValue(raw);
    if (current > 0) {
      return {
        path,
        current,
        raw,
        entryObject: isPlainObject(raw) && Number.isFinite(Number(raw.current))
      };
    }
  }

  return {
    path: ['statusBar', 'inspiration'],
    current: 0,
    raw: undefined,
    entryObject: false
  };
}

function buildInspirationPatch(pool, after) {
  const value = pool.entryObject
    ? {
        ...pool.raw,
        current: after,
        ready: after > 0
      }
    : after;
  return setPath({}, pool.path, value);
}

function getPath(source, path) {
  return path.reduce((current, key) => (
    current && typeof current === 'object' ? current[key] : undefined
  ), source);
}

function setPath(target, path, value) {
  const [key, ...rest] = path;
  if (!key) return value;
  target[key] = rest.length ? setPath({}, rest, value) : value;
  return target;
}

function inspirationValue(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return Math.max(0, raw);
  if (typeof raw === 'string') {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }
  if (isPlainObject(raw)) {
    const number = Number(raw.current ?? raw.value ?? raw.amount ?? raw.uses ?? 0);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }
  return 0;
}

function isFailedDiceResult(result = {}) {
  return result.failure === true
    || result.success === false
    || ['failure', 'criticalFailure'].includes(result.outcome);
}

function normalizeDecision(value) {
  return ['reroll', 'decline'].includes(value) ? value : 'ask';
}

function inactiveRemoteConfig() {
  return {
    enabled: false,
    diceSides: undefined,
    fixedRoll: undefined,
    fixedRollActive: false,
    reason: '',
    source: 'dice-remote-control'
  };
}

function normalizeRemoteConfig(value = {}) {
  const input = normalizeObject(value);
  const diceSides = normalizeInteger(input.diceSides ?? input.sides, 'diceSides', 2, 10000, { optional: true });
  const fixedRoll = normalizeInteger(input.fixedRoll, 'fixedRoll', 1, 10000, { optional: true, nullAsUndefined: true });
  const enabled = input.enabled === true && diceSides !== undefined;
  return {
    enabled,
    diceSides: enabled ? diceSides : undefined,
    fixedRoll: enabled && fixedRoll !== undefined ? fixedRoll : undefined,
    fixedRollActive: enabled && fixedRoll !== undefined,
    reason: normalizeOptionalText(input.reason),
    source: normalizeOptionalText(input.source || 'dice-remote-control'),
    updatedAt: normalizeOptionalText(input.updatedAt)
  };
}

function normalizeInteger(value, field, min, max, { optional = false, nullAsUndefined = false } = {}) {
  if (value === undefined || value === '') {
    if (optional) return undefined;
    throw validationError(`${field} is required`);
  }
  if (value === null && nullAsUndefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isUserAuthorized(context = {}) {
  const authorization = context.authorization ?? context.userAuthorization ?? context.approval;
  if (authorization === true) return true;
  if (!authorization || typeof authorization !== 'object') return false;
  return authorization.approved === true || authorization.userApproved === true || authorization.granted === true;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'DiceRemoteControlValidationError';
  error.statusCode = 400;
  return error;
}

export const DICE_HANDLERS = createDiceHandlers();
