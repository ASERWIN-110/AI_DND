// @ts-nocheck
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const RESOURCE_TRACE_DIR = 'data/resource-traces';

export const RESOURCE_TEMPLATES = {
  actionEconomy: {
    action: { current: 1, max: 1 },
    bonusAction: { current: 1, max: 1 },
    reaction: { current: 1, max: 1 },
    movement: { current: 30, max: 30, unit: 'ft' }
  },
  resources: {
    spellSlots: { level1: { current: 2, max: 2 } },
    skillUses: { second_wind: { current: 1, max: 1, recharge: 'shortRest' } },
    ammo: { arrows: { current: 20, max: 20, itemId: 'arrows' } },
    cooldowns: { breath_weapon: { remainingTurns: 3, maxTurns: 3, ready: false } },
    consumables: { potion_healing: { current: 2, itemId: 'potion_healing' } }
  }
};

export class ResourceManager {
  constructor({
    appDatabase,
    npcState,
    stateDatabase,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase && !npcState && !stateDatabase) throw validationError('ResourceManager requires appDatabase or npcState database');
    this.npcState = npcState || stateDatabase || new NpcStructuredStateDatabase({
      appDatabase,
      trace: trace === false ? false : trace?.npcState
    });
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || RESOURCE_TRACE_DIR,
      cwd,
      now: this.now
    });
  }

  describe() {
    return {
      name: 'ResourceManager',
      llm: false,
      stateTarget: 'npc_structured_states.resources',
      inventorySync: 'ammo and consumables can optionally sync inventory.items.quantity',
      actionEconomy: ['action', 'bonusAction', 'reaction', 'movement'],
      categories: ['spellSlots', 'skillUses', 'ammo', 'cooldowns', 'consumables', 'custom'],
      templates: RESOURCE_TEMPLATES
    };
  }

  getActorResources(input = {}) {
    return this.withTrace('resource-get', input.chatSessionId, input, () => {
      const actor = this.getActor(input);
      return {
        actor,
        snapshot: compactResourceSnapshot(actor.data)
      };
    });
  }

  resetActionEconomy(input = {}) {
    return this.withTrace('resource-reset-action-economy', input.chatSessionId, input, () => {
      const actor = this.getActor(input);
      const resources = normalizeResources(actor.data.resources);
      const economy = normalizeActionEconomy(actor.data, input);
      const reset = new Set(normalizeStringArray(input.reset || input.resources || ['action', 'bonusAction', 'reaction', 'movement']).map(normalizeActionKey));
      for (const key of reset) {
        if (!economy[key]) continue;
        economy[key].current = economy[key].max;
        economy[key].available = economy[key].current > 0;
      }
      if (input.movementMax !== undefined || input.speed !== undefined) {
        const movementMax = normalizeNonNegativeNumber(input.movementMax ?? input.speed, 'movementMax');
        economy.movement.max = movementMax;
        if (reset.has('movement')) economy.movement.current = movementMax;
      }
      economy.turnId = normalizeOptionalText(input.turnId || input.turnNumber || input.roundNumber) || economy.turnId || '';
      economy.updatedAt = this.now();
      resources.actionEconomy = economy;
      const record = this.patchActorResources(actor.data, {
        resources,
        statusBarPatch: { actionEconomy: economy },
        source: input.source || 'resource-manager'
      });
      return {
        ok: true,
        actorId: actor.data.npcId,
        actionEconomy: economy,
        record
      };
    });
  }

  spendActionEconomy(input = {}) {
    return this.withTrace('resource-spend-action-economy', input.chatSessionId, input, () => {
      const actor = this.getActor(input);
      const key = normalizeActionKey(input.resource || input.actionType || input.type || input.kind);
      const amount = normalizeSpendAmount(input, key);
      const resources = normalizeResources(actor.data.resources);
      const economy = normalizeActionEconomy(actor.data, input);
      const pool = economy[key];
      if (!pool) throw validationError(`Unsupported action economy resource: ${key}`);
      const before = pool.current;
      if (before < amount && !input.allowOverspend) {
        return {
          ok: false,
          reason: 'insufficient_action_economy',
          actorId: actor.data.npcId,
          resource: key,
          requested: amount,
          available: before,
          actionEconomy: economy
        };
      }
      pool.current = input.allowOverspend ? before - amount : Math.max(0, before - amount);
      pool.available = pool.current > 0;
      pool.updatedAt = this.now();
      economy.updatedAt = this.now();
      resources.actionEconomy = economy;
      const record = this.patchActorResources(actor.data, {
        resources,
        statusBarPatch: { actionEconomy: economy },
        source: input.source || 'resource-manager'
      });
      return {
        ok: true,
        actorId: actor.data.npcId,
        resource: key,
        amount,
        before,
        after: pool.current,
        actionEconomy: economy,
        record
      };
    });
  }

  restoreActionEconomy(input = {}) {
    return this.withTrace('resource-restore-action-economy', input.chatSessionId, input, () => {
      const actor = this.getActor(input);
      const key = normalizeActionKey(input.resource || input.actionType || input.type || input.kind);
      const amount = input.amount === undefined && input.value === undefined ? undefined : normalizeNonNegativeNumber(input.amount ?? input.value, 'amount');
      const resources = normalizeResources(actor.data.resources);
      const economy = normalizeActionEconomy(actor.data, input);
      const pool = economy[key];
      if (!pool) throw validationError(`Unsupported action economy resource: ${key}`);
      const before = pool.current;
      pool.current = amount === undefined ? pool.max : Math.min(pool.max, before + amount);
      pool.available = pool.current > 0;
      pool.updatedAt = this.now();
      economy.updatedAt = this.now();
      resources.actionEconomy = economy;
      const record = this.patchActorResources(actor.data, {
        resources,
        statusBarPatch: { actionEconomy: economy },
        source: input.source || 'resource-manager'
      });
      return {
        ok: true,
        actorId: actor.data.npcId,
        resource: key,
        amount,
        before,
        after: pool.current,
        actionEconomy: economy,
        record
      };
    });
  }

  setResource(input = {}) {
    return this.withTrace('resource-set', input.chatSessionId, input, () => {
      const actor = this.getOrCreateActor(input);
      const category = normalizeCategory(input.category || input.resourceType || input.type);
      const resourceId = normalizeResourceId(input.resourceId || input.id || input.name || input.slotLevel || input.level, category);
      const resources = normalizeResources(actor.data.resources);
      const currentGroup = normalizeResourceGroup(resources[category]);
      const existingRaw = currentGroup[resourceId];
      const existing = normalizeResourceEntry(existingRaw, { category, resourceId });
      const nextCurrent = input.current ?? input.value ?? input.amount ?? existing.current;
      const entry = normalizeResourceEntry({
        ...existing,
        current: nextCurrent,
        max: input.max ?? input.maxValue ?? input.maximum ?? (existingRaw === undefined ? nextCurrent : existing.max),
        itemId: input.itemId ?? existing.itemId,
        recharge: input.recharge ?? existing.recharge,
        unit: input.unit ?? existing.unit,
        metadata: {
          ...normalizeObject(existing.metadata),
          ...normalizeObject(input.metadata)
        }
      }, { category, resourceId });
      currentGroup[resourceId] = entry;
      resources[category] = currentGroup;
      const record = this.patchActorResources(actor.data, {
        resources,
        source: input.source || 'resource-manager'
      });
      return {
        ok: true,
        actorId: record.data.npcId,
        category,
        resourceId,
        resource: entry,
        record
      };
    });
  }

  spendResource(input = {}) {
    return this.withTrace('resource-spend', input.chatSessionId, input, () => this.applyResourceDelta(input, -normalizeNonNegativeNumber(input.amount ?? input.value ?? 1, 'amount')));
  }

  restoreResource(input = {}) {
    return this.withTrace('resource-restore', input.chatSessionId, input, () => this.applyResourceDelta(input, normalizeNonNegativeNumber(input.amount ?? input.value ?? 1, 'amount')));
  }

  startCooldown(input = {}) {
    return this.withTrace('resource-start-cooldown', input.chatSessionId, input, () => {
      const actor = this.getActor(input);
      const cooldownId = normalizeResourceId(input.cooldownId || input.resourceId || input.id || input.name, 'cooldowns');
      const turns = normalizeNonNegativeInteger(input.remainingTurns ?? input.turns ?? input.durationTurns ?? input.duration ?? 1, 'remainingTurns');
      const resources = normalizeResources(actor.data.resources);
      const cooldowns = normalizeResourceGroup(resources.cooldowns);
      const existing = normalizeCooldownEntry(cooldowns[cooldownId]);
      const entry = {
        ...existing,
        id: cooldownId,
        remainingTurns: turns,
        maxTurns: normalizeNonNegativeInteger(input.maxTurns ?? input.durationTurns ?? existing.maxTurns ?? turns, 'maxTurns'),
        ready: turns <= 0,
        status: turns <= 0 ? 'ready' : 'cooling',
        source: normalizeOptionalText(input.source || existing.source),
        updatedAt: this.now(),
        metadata: {
          ...normalizeObject(existing.metadata),
          ...normalizeObject(input.metadata)
        }
      };
      cooldowns[cooldownId] = entry;
      resources.cooldowns = cooldowns;
      const record = this.patchActorResources(actor.data, {
        resources,
        source: input.source || 'resource-manager'
      });
      return {
        ok: true,
        actorId: actor.data.npcId,
        cooldownId,
        cooldown: entry,
        record
      };
    });
  }

  tickCooldowns(input = {}) {
    return this.withTrace('resource-tick-cooldowns', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const amount = normalizeNonNegativeInteger(input.amount ?? input.turns ?? 1, 'amount');
      const actors = this.listActors(input);
      const results = [];
      for (const actor of actors) {
        const resources = normalizeResources(actor.data.resources);
        const cooldowns = normalizeResourceGroup(resources.cooldowns);
        const ids = new Set(normalizeStringArray(input.cooldownIds || input.cooldownId || input.resourceId));
        let changed = false;
        const updates = [];
        for (const [id, value] of Object.entries(cooldowns)) {
          if (ids.size && !ids.has(id)) continue;
          const entry = normalizeCooldownEntry(value);
          const before = entry.remainingTurns;
          if (before <= 0 && !input.force) continue;
          entry.remainingTurns = Math.max(0, before - amount);
          entry.ready = entry.remainingTurns <= 0;
          entry.status = entry.ready ? 'ready' : 'cooling';
          entry.updatedAt = this.now();
          cooldowns[id] = entry;
          changed = true;
          updates.push({ cooldownId: id, before, after: entry.remainingTurns, ready: entry.ready });
        }
        if (!changed) {
          results.push({ actorId: actor.data.npcId, changed: false, updates: [] });
          continue;
        }
        resources.cooldowns = cooldowns;
        const record = this.patchActorResources(actor.data, {
          resources,
          source: input.source || 'resource-manager'
        });
        results.push({ actorId: actor.data.npcId, changed: true, updates, record });
      }
      return {
        ok: true,
        chatSessionId,
        amount,
        count: results.length,
        results
      };
    });
  }

  consumeItem(input = {}) {
    return this.withTrace('resource-consume-item', input.chatSessionId, input, () => ({
      ...this.applyResourceDelta({
        ...input,
        category: input.category || 'consumables',
        resourceId: input.resourceId || input.itemId || input.id,
        itemId: input.itemId || input.resourceId || input.id,
        syncInventory: input.syncInventory !== false
      }, -normalizeNonNegativeNumber(input.amount ?? input.quantity ?? input.value ?? 1, 'amount')),
      consumed: true
    }));
  }

  applyResourceDelta(input = {}, delta) {
    const actor = this.getActor(input);
    const category = normalizeCategory(input.category || input.resourceType || input.type);
    const resourceId = normalizeResourceId(input.resourceId || input.id || input.name || input.slotLevel || input.level, category);
    const resources = normalizeResources(actor.data.resources);
    const group = normalizeResourceGroup(resources[category]);
    const inventory = normalizeInventory(actor.data.inventory);
    const itemId = normalizeOptionalText(input.itemId || input.inventoryItemId);
    const fallbackCurrent = itemId ? findInventoryQuantity(inventory, itemId) : undefined;
    const existing = normalizeResourceEntry(group[resourceId], {
      category,
      resourceId,
      fallbackCurrent,
      itemId
    });
    const before = existing.current;
    const after = delta < 0
      ? before - Math.abs(delta)
      : Math.min(existing.max ?? before + delta, before + delta);

    if (delta < 0 && before < Math.abs(delta) && !input.allowOverspend) {
      return {
        ok: false,
        reason: 'insufficient_resource',
        actorId: actor.data.npcId,
        category,
        resourceId,
        requested: Math.abs(delta),
        available: before,
        resource: existing
      };
    }

    const nextCurrent = input.allowOverspend ? after : Math.max(0, after);
    const entry = {
      ...existing,
      current: nextCurrent,
      ready: nextCurrent > 0,
      updatedAt: this.now()
    };
    group[resourceId] = entry;
    resources[category] = group;

    const syncInventory = input.syncInventory === true || (input.syncInventory !== false && ['ammo', 'consumables'].includes(category));
    const inventoryPatch = syncInventory && (itemId || existing.itemId)
      ? updateInventoryItemQuantity(inventory, itemId || existing.itemId, nextCurrent, {
        removeWhenZero: Boolean(input.removeWhenZero),
        name: input.itemName || input.name || existing.name
      })
      : undefined;

    const record = this.patchActorResources(actor.data, {
      resources,
      inventoryPatch,
      source: input.source || 'resource-manager'
    });
    return {
      ok: true,
      actorId: actor.data.npcId,
      category,
      resourceId,
      amount: Math.abs(delta),
      before,
      after: nextCurrent,
      resource: entry,
      inventoryPatch,
      record
    };
  }

  getActor(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    return this.npcState.getNpcState({
      chatSessionId,
      sceneId: input.sceneId || 'current',
      npcId: input.npcId || input.actorId || input.playerId,
      playerId: input.playerId,
      id: input.recordId || input.stateRecordId
    });
  }

  getOrCreateActor(input = {}) {
    try {
      return this.getActor(input);
    } catch (error) {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const npcId = normalizeRequiredText(input.npcId || input.actorId || input.playerId, 'npcId');
      return this.npcState.patchNpcState({
        chatSessionId,
        sceneId: input.sceneId || 'current',
        npcId,
        actorType: input.actorType || (input.isPlayer || input.playerId ? 'player' : 'npc'),
        isPlayer: input.isPlayer ?? Boolean(input.playerId),
        playerId: input.playerId,
        name: input.actorName || input.name || npcId,
        source: input.source || 'resource-manager'
      }, { source: input.source || 'resource-manager' }).record;
    }
  }

  listActors(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    if (input.npcId || input.actorId || input.playerId || input.recordId || input.stateRecordId) return [this.getActor(input)];
    return this.npcState.listNpcStates({
      chatSessionId,
      sceneId: input.sceneId,
      actorType: input.actorType,
      isPlayer: input.isPlayer,
      playerId: input.playerId,
      limit: input.limit || 500
    }).records;
  }

  patchActorResources(actor, { resources, statusBarPatch, inventoryPatch, source }) {
    return this.npcState.patchNpcState({
      chatSessionId: actor.chatSessionId,
      sceneId: actor.sceneId || 'current',
      npcId: actor.npcId,
      actorType: actor.actorType,
      isPlayer: actor.isPlayer,
      playerId: actor.playerId,
      name: actor.name,
      resources,
      statusBar: statusBarPatch,
      inventory: inventoryPatch,
      source
    }, { source }).record;
  }

  snapshot(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    return this.npcState.stateSnapshot({
      chatSessionId,
      sceneId: input.sceneId,
      includeAllScenes: !input.sceneId
    });
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
      const after = this.snapshot({ chatSessionId: normalizedChatSessionId, sceneId: input.sceneId });
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }
}

function normalizeResources(resources = {}) {
  return {
    ...normalizeObject(resources),
    actionEconomy: normalizeObject(resources.actionEconomy),
    spellSlots: normalizeResourceGroup(resources.spellSlots),
    skillUses: normalizeResourceGroup(resources.skillUses || resources.skills),
    ammo: normalizeResourceGroup(resources.ammo || resources.ammunition),
    cooldowns: normalizeResourceGroup(resources.cooldowns),
    consumables: normalizeResourceGroup(resources.consumables)
  };
}

function normalizeActionEconomy(actor = {}, input = {}) {
  const resources = normalizeObject(actor.resources);
  const statusBar = normalizeObject(actor.statusBar);
  const existing = {
    ...normalizeObject(statusBar.actionEconomy),
    ...normalizeObject(resources.actionEconomy)
  };
  const movementMax = firstFiniteNumber(
    input.movementMax,
    input.speed,
    existing.movement?.max,
    existing.movementMax,
    statusBar.speed,
    actor.values?.speed,
    30
  );
  return {
    action: normalizeActionPool(existing.action, 1, 'action'),
    bonusAction: normalizeActionPool(existing.bonusAction ?? existing.bonus, 1, 'bonusAction'),
    reaction: normalizeActionPool(existing.reaction, 1, 'reaction'),
    movement: normalizeActionPool(existing.movement, movementMax, 'movement', { unit: input.movementUnit || existing.movement?.unit || 'ft' }),
    turnId: normalizeOptionalText(existing.turnId),
    updatedAt: normalizeOptionalText(existing.updatedAt)
  };
}

function normalizeActionPool(value, defaultMax, id, extra = {}) {
  if (typeof value === 'boolean') {
    return { id, current: value ? defaultMax : 0, max: defaultMax, available: value, ...extra };
  }
  if (typeof value === 'number') {
    return { id, current: value, max: Math.max(defaultMax, value), available: value > 0, ...extra };
  }
  const object = normalizeObject(value);
  const max = normalizeNonNegativeNumber(object.max ?? object.maximum ?? object.total ?? defaultMax, `${id}.max`);
  const current = normalizeNonNegativeNumber(object.current ?? object.remaining ?? object.value ?? object.availableAmount ?? max, `${id}.current`);
  return {
    id,
    ...object,
    current: Math.min(current, max),
    max,
    available: object.available ?? current > 0,
    ...extra
  };
}

function normalizeActionKey(value) {
  const normalized = String(value || 'action').trim();
  const comparable = normalized.replace(/[\s-]+/g, '_').toLowerCase();
  if (['action', 'mainaction', 'main_action', 'standardaction', 'standard_action'].includes(comparable)) return 'action';
  if (['bonus', 'bonus_action', 'bonusaction'].includes(comparable)) return 'bonusAction';
  if (comparable === 'reaction') return 'reaction';
  if (['move', 'movement', 'speed'].includes(comparable)) return 'movement';
  return normalized;
}

function normalizeSpendAmount(input, key) {
  if (key === 'movement') {
    const amount = input.amount ?? input.value ?? input.distance ?? input.feet ?? input.meters ?? input.cost;
    if (amount === undefined) throw validationError('movement spend requires amount, distance, feet, meters, or cost');
    return normalizeNonNegativeNumber(amount, 'amount');
  }
  const amount = input.amount ?? input.value ?? 1;
  return normalizeNonNegativeNumber(amount, 'amount');
}

function normalizeCategory(value) {
  const normalized = String(value || 'custom').trim();
  const comparable = normalized.replace(/[\s-]+/g, '_').toLowerCase();
  if (['spellslot', 'spellslots', 'spell_slot', 'spell_slots', 'slots'].includes(comparable)) return 'spellSlots';
  if (['skill', 'skilluse', 'skilluses', 'skill_use', 'skill_uses', 'uses'].includes(comparable)) return 'skillUses';
  if (['ammo', 'ammunition', 'arrows', 'bullets'].includes(comparable)) return 'ammo';
  if (['cooldown', 'cooldowns'].includes(comparable)) return 'cooldowns';
  if (['consumable', 'consumables', 'item', 'items'].includes(comparable)) return 'consumables';
  return normalized;
}

function normalizeResourceId(value, category) {
  const raw = normalizeRequiredText(value, 'resourceId');
  if (category === 'spellSlots') {
    const level = String(raw).trim().replace(/^spell[-_ ]?/i, '').replace(/^slot[-_ ]?/i, '');
    if (/^\d+$/.test(level)) return `level${level}`;
  }
  return safeSegment(raw);
}

function normalizeResourceGroup(value = {}) {
  const object = normalizeObject(value);
  return { ...object };
}

function normalizeResourceEntry(value, { category = 'custom', resourceId = '', fallbackCurrent, itemId } = {}) {
  if (typeof value === 'number') {
    return {
      id: resourceId,
      current: value,
      max: Math.max(value, normalizeOptionalNumber(fallbackCurrent) ?? value),
      ready: value > 0,
      itemId
    };
  }
  const object = normalizeObject(value);
  const current = firstFiniteNumber(
    object.current,
    object.remaining,
    object.uses,
    object.value,
    object.count,
    object.quantity,
    fallbackCurrent,
    0
  );
  const max = firstFiniteNumber(object.max, object.maxUses, object.maximum, object.total, current);
  return {
    id: normalizeOptionalText(object.id) || resourceId,
    name: normalizeOptionalText(object.name),
    current,
    max,
    ready: object.ready ?? current > 0,
    itemId: normalizeOptionalText(object.itemId || itemId),
    recharge: normalizeOptionalText(object.recharge),
    unit: normalizeOptionalText(object.unit),
    category,
    metadata: normalizeObject(object.metadata)
  };
}

function normalizeCooldownEntry(value) {
  if (typeof value === 'number') {
    return {
      remainingTurns: value,
      maxTurns: value,
      ready: value <= 0,
      status: value <= 0 ? 'ready' : 'cooling'
    };
  }
  const object = normalizeObject(value);
  const remainingTurns = normalizeNonNegativeInteger(object.remainingTurns ?? object.turns ?? object.duration ?? 0, 'remainingTurns');
  return {
    ...object,
    remainingTurns,
    maxTurns: normalizeNonNegativeInteger(object.maxTurns ?? object.durationTurns ?? object.max ?? remainingTurns, 'maxTurns'),
    ready: object.ready ?? remainingTurns <= 0,
    status: normalizeOptionalText(object.status) || (remainingTurns <= 0 ? 'ready' : 'cooling'),
    metadata: normalizeObject(object.metadata)
  };
}

function normalizeInventory(inventory = {}) {
  const input = normalizeObject(inventory);
  return {
    currency: normalizeObject(input.currency),
    items: normalizeArray(input.items).filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ...item }))
  };
}

function findInventoryQuantity(inventory, itemId) {
  const id = safeSegment(itemId);
  const item = inventory.items.find((candidate) => safeSegment(candidate.id || candidate.name) === id);
  return item ? firstFiniteNumber(item.quantity, item.count, 0) : undefined;
}

function updateInventoryItemQuantity(inventory, itemId, quantity, { removeWhenZero = false, name } = {}) {
  const id = safeSegment(itemId);
  const current = inventory.items.find((item) => safeSegment(item.id || item.name) === id);
  if (removeWhenZero && quantity <= 0) {
    return { items: [{ id, name: name || current?.name || id, _delete: true }] };
  }
  return {
    items: [{
      ...(current || {}),
      id,
      name: normalizeOptionalText(name || current?.name || id),
      quantity
    }]
  };
}

function compactResourceSnapshot(actor = {}) {
  return {
    chatSessionId: actor.chatSessionId,
    sceneId: actor.sceneId,
    actorId: actor.npcId,
    name: actor.name,
    actionEconomy: normalizeActionEconomy(actor),
    resources: normalizeResources(actor.resources),
    inventory: actor.inventory
  };
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
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
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

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`Expected finite number: ${value}`);
  return number;
}

function normalizeNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw validationError(`${field} must be a non-negative number`);
  return number;
}

function normalizeNonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw validationError(`${field} must be a non-negative integer`);
  return number;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function safeSegment(value) {
  return normalizeRequiredText(value, 'id')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'id';
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.statusCode = 400;
  return error;
}
