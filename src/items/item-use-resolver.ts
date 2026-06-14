// @ts-nocheck
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const ITEM_USE_TRACE_DIR = 'data/item-use-traces';

export const ITEM_USE_TEMPLATES = {
  healingPotion: {
    chatSessionId: 'chat id',
    sceneId: 'current',
    actorId: 'pc_arin',
    itemId: 'potion_healing',
    targetId: 'pc_arin',
    consumeQuantity: 1,
    healing: [{ type: 'potion', amount: 8 }],
    resourceChanges: []
  },
  equipWeapon: {
    chatSessionId: 'chat id',
    sceneId: 'current',
    actorId: 'pc_arin',
    itemId: 'longsword',
    slot: 'mainHand'
  },
  offensiveConsumable: {
    chatSessionId: 'chat id',
    sceneId: 'current',
    actorId: 'pc_arin',
    itemId: 'acid_flask',
    targetId: 'npc_guard',
    consumeQuantity: 1,
    hit: true,
    damage: [{ type: 'acid', amount: 7 }]
  },
  resourcePotion: {
    chatSessionId: 'chat id',
    sceneId: 'current',
    actorId: 'pc_wizard',
    itemId: 'minor_mana_potion',
    consumeQuantity: 1,
    resourceChanges: [
      { operation: 'restore', category: 'spellSlots', resourceId: 'level1', amount: 1 }
    ]
  }
};

export class ItemUseResolver {
  constructor({
    toolManager,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!toolManager) throw validationError('ItemUseResolver requires toolManager');
    this.toolManager = toolManager;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || ITEM_USE_TRACE_DIR,
      cwd,
      now: this.now
    });
  }

  describe() {
    return {
      name: 'ItemUseResolver',
      llm: false,
      stateBoundary: 'Inventory, equipment, HP/status, and resources stay in npc_structured_states. Item definitions stay in system.item_registry.',
      flow: [
        'read actor state',
        'resolve owned inventory item or equipped item',
        'optionally read global item registry definition',
        'validate ownership, equipped requirement, consumable quantity, and resource costs',
        'preview damage/healing/status settlement',
        'write damage/healing/status through system.effects',
        'write consumable/resource changes through system.resources',
        'write equip/unequip changes through system.npc_state'
      ],
      toolsReused: [
        'system.npc_state.get_state',
        'system.npc_state.patch_state',
        'system.item_registry.get_*',
        'system.effects.preview_settlement',
        'system.effects.apply_settlement',
        'system.resources.*',
        'game.dice.check for optional supplied damage/healing rolls'
      ],
      templates: ITEM_USE_TEMPLATES
    };
  }

  async previewUseItem(input = {}) {
    return this.useItem({ ...input, dryRun: true });
  }

  async useItem(input = {}) {
    if (['equip', 'equip_item'].includes(normalizeMode(input.useMode || input.mode))) {
      return this.equipItem(input);
    }
    if (['unequip', 'unequip_item'].includes(normalizeMode(input.useMode || input.mode))) {
      return this.unequipItem(input);
    }
    return this.withTrace('item-use', input.chatSessionId, input, async () => {
      const request = normalizeUseRequest(input);
      const actor = await this.getActor(request);
      const itemDefinition = await this.resolveItemDefinition(request);
      const ownership = resolveOwnership(actor.data, request, itemDefinition);
      if (!ownership.ok) return blockedResult(ownership.reason, request, actor, ownership, itemDefinition);

      const useEffects = await this.resolveUseEffects(request, itemDefinition);
      const costPlan = buildCostPlan(request, ownership, useEffects);
      const costValidation = validateCostPlan(actor.data, costPlan);
      if (!costValidation.ok) {
        return {
          ok: false,
          status: 'blocked',
          reason: 'insufficient_resources',
          llmUsed: false,
          dryRun: request.dryRun,
          request,
          actor: actor.data,
          item: ownership.item,
          itemDefinition,
          useEffects,
          costPlan,
          costValidation
        };
      }

      const settlementInput = buildSettlementInput(request, useEffects);
      if (!hasItemUseApplications({ settlementInput, useEffects, costPlan })) {
        return {
          ok: false,
          status: 'blocked',
          reason: 'item_has_no_direct_effect',
          llmUsed: false,
          dryRun: request.dryRun,
          request,
          actor: actor.data,
          item: ownership.item,
          itemDefinition,
          useEffects,
          costPlan,
          costValidation
        };
      }

      const settlementPreview = await this.resolveSettlement(settlementInput, true);
      if (settlementPreview?.ok === false) {
        return {
          ok: false,
          status: 'blocked',
          reason: settlementPreview.reason || 'settlement_preview_failed',
          llmUsed: false,
          dryRun: request.dryRun,
          request,
          actor: actor.data,
          item: ownership.item,
          itemDefinition,
          useEffects,
          settlement: settlementPreview
        };
      }

      if (request.dryRun) {
        return {
          ok: true,
          status: 'dry_run',
          dryRun: true,
          llmUsed: false,
          request,
          actor: actor.data,
          item: ownership.item,
          itemDefinition,
          useEffects,
          costPlan,
          costValidation,
          settlement: settlementPreview
        };
      }

      const settlement = await this.resolveSettlement(settlementInput, false);
      const resourceChanges = await this.applyResourceChanges(request, useEffects.resourceChanges);
      const costApplications = await this.applyCosts(request, costPlan);
      return {
        ok: true,
        status: 'resolved',
        dryRun: false,
        llmUsed: false,
        request,
        actor: actor.data,
        item: ownership.item,
        itemDefinition,
        useEffects,
        costPlan,
        costValidation,
        settlement,
        resourceChanges,
        costApplications
      };
    });
  }

  async equipItem(input = {}) {
    return this.withTrace('item-equip', input.chatSessionId, input, async () => {
      const request = normalizeEquipRequest(input);
      const actor = await this.getActor(request);
      const itemDefinition = await this.resolveItemDefinition(request);
      const ownership = resolveOwnership(actor.data, request, itemDefinition, { allowEquipped: true });
      if (!ownership.ok) return blockedResult(ownership.reason, request, actor, ownership, itemDefinition);
      const slot = resolveEquipSlot(request, ownership.item, itemDefinition);
      const replaced = getEquipmentAtSlot(actor.data.equipment, slot);
      const inventoryPatchItems = [
        buildInventoryPatchItem(ownership.item, {
          equipped: true,
          metadata: { equippedSlot: slot }
        })
      ];
      if (replaced?.id && normalizeId(replaced.id) !== normalizeId(ownership.item.id)) {
        inventoryPatchItems.push(buildInventoryPatchItem(replaced, {
          equipped: false,
          metadata: { equippedSlot: '' }
        }));
      }
      const equipmentPatch = slotPathToPatch(slot, buildEquipmentRef({
        slot,
        item: ownership.item,
        itemDefinition,
        source: request.source
      }));
      const patchInput = {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        npcId: request.actorId,
        inventory: { items: inventoryPatchItems },
        equipment: equipmentPatch,
        source: request.source
      };

      if (request.dryRun) {
        return {
          ok: true,
          status: 'dry_run',
          dryRun: true,
          llmUsed: false,
          request,
          actor: actor.data,
          item: ownership.item,
          itemDefinition,
          slot,
          replaced,
          patch: patchInput
        };
      }

      const patched = await this.toolManager.executeTool('system.npc_state.patch_state', removeUndefined(patchInput));
      return {
        ok: true,
        status: 'equipped',
        dryRun: false,
        llmUsed: false,
        request,
        item: ownership.item,
        itemDefinition,
        slot,
        replaced,
        record: patched.output.record,
        patch: patchInput
      };
    });
  }

  async unequipItem(input = {}) {
    return this.withTrace('item-unequip', input.chatSessionId, input, async () => {
      const request = normalizeEquipRequest({ ...input, useMode: 'unequip' });
      const actor = await this.getActor(request);
      const match = resolveUnequipTarget(actor.data, request);
      if (!match.ok) {
        return {
          ok: false,
          status: 'blocked',
          reason: match.reason,
          llmUsed: false,
          dryRun: request.dryRun,
          request,
          actor: actor.data
        };
      }
      const inventoryPatchItems = match.items.map((item) => buildInventoryPatchItem(item, {
        equipped: false,
        metadata: { equippedSlot: '' }
      }));
      const equipmentPatch = Object.assign({}, ...match.slots.map((slot) => slotPathToPatch(slot, null)));
      const patchInput = {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        npcId: request.actorId,
        inventory: inventoryPatchItems.length ? { items: inventoryPatchItems } : undefined,
        equipment: equipmentPatch,
        source: request.source
      };

      if (request.dryRun) {
        return {
          ok: true,
          status: 'dry_run',
          dryRun: true,
          llmUsed: false,
          request,
          actor: actor.data,
          slots: match.slots,
          items: match.items,
          patch: patchInput
        };
      }

      const patched = await this.toolManager.executeTool('system.npc_state.patch_state', removeUndefined(patchInput));
      return {
        ok: true,
        status: 'unequipped',
        dryRun: false,
        llmUsed: false,
        request,
        slots: match.slots,
        items: match.items,
        record: patched.output.record,
        patch: patchInput
      };
    });
  }

  async getActor(request) {
    const output = await this.toolManager.executeTool('system.npc_state.get_state', removeUndefined({
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      npcId: request.actorId,
      playerId: request.playerId,
      recordId: request.recordId,
      id: request.stateRecordId
    }));
    return output.output;
  }

  async resolveItemDefinition(request) {
    if (isPlainObject(request.item)) return { source: 'input', kind: request.itemKind || 'custom', data: request.item };
    if (!request.itemId) return undefined;
    const requestedKinds = normalizeStringArray(request.itemKind || request.kind || request.registryKind);
    const kindOrder = requestedKinds.length
      ? requestedKinds
      : ['item', 'equipment', 'accessory', 'weapon', 'mount', 'special_item'];
    for (const kind of kindOrder.map(normalizeRegistryKind).filter(Boolean)) {
      const toolName = registryGetToolName(kind);
      const result = await safeExecuteTool(this.toolManager, toolName, { id: request.itemId });
      if (result.ok) return { source: toolName, kind, record: result.output, data: result.output.data || result.output };
    }
    return undefined;
  }

  async resolveUseEffects(request, itemDefinition) {
    const raw = mergeUseEffectSources(request, itemDefinition?.data);
    const damage = [
      ...normalizeEffectArray(raw.damage ?? raw.damages),
      ...await this.rollEffectDice(raw.damageRolls || raw.damageDice, 'damage')
    ];
    const healing = [
      ...normalizeEffectArray(raw.healing ?? raw.heals),
      ...await this.rollEffectDice(raw.healingRolls || raw.healingDice, 'healing')
    ];
    return {
      hit: raw.hit ?? raw.attack ?? request.hit ?? true,
      damage,
      healing,
      temporaryHp: raw.temporaryHp ?? raw.tempHp,
      statusEffects: normalizeEffectArray(raw.statusEffects ?? raw.statuses ?? raw.conditions),
      resourceChanges: normalizeResourceChanges(raw.resourceChanges ?? raw.resources ?? raw.resourceEffects),
      resourceCosts: normalizeCostArray(raw.resourceCosts ?? raw.costs),
      consume: raw.consume ?? raw.consumes ?? raw.consumable,
      consumeQuantity: normalizeOptionalNonNegativeNumber(raw.consumeQuantity ?? raw.quantity ?? raw.amount)
    };
  }

  async rollEffectDice(rawRolls, defaultType) {
    const rolls = normalizeEffectArray(rawRolls);
    const results = [];
    for (const roll of rolls) {
      if (!isPlainObject(roll)) continue;
      const diceInput = removeUndefined({
        successThreshold: -100000,
        diceCount: roll.diceCount ?? roll.rollCount ?? roll.count,
        diceSides: roll.diceSides ?? roll.sides,
        modifier: roll.modifier ?? roll.fixedModifier ?? 0,
        buff: roll.buff,
        debuff: roll.debuff,
        abilityModifier: roll.abilityModifier,
        proficiencyBonus: roll.proficiencyBonus,
        rollMode: roll.rollMode,
        forceMode: roll.forceMode,
        inspirationPoints: roll.inspirationPoints,
        criticalMode: roll.criticalMode || 'none'
      });
      const result = await this.toolManager.executeTool('game.dice.check', diceInput);
      results.push({
        id: roll.id,
        type: roll.type || defaultType,
        amount: result.output.total,
        roll: {
          expression: result.output.dice?.expression,
          total: result.output.total,
          dice: result.output
        },
        note: roll.note || roll.description
      });
    }
    return results;
  }

  async resolveSettlement(settlementInput, dryRun) {
    if (!hasSettlementEffects(settlementInput)) return { skipped: true, reason: 'no_effects' };
    const tool = dryRun ? 'system.effects.preview_settlement' : 'system.effects.apply_settlement';
    const result = await this.toolManager.executeTool(tool, settlementInput);
    return result.output;
  }

  async applyResourceChanges(request, changes = []) {
    const applications = [];
    for (const change of changes) {
      const operation = normalizeMode(change.operation || change.mode || change.kind || change.type || 'restore');
      const tool = resourceChangeTool(operation);
      const input = buildResourceToolInput(request, change, tool);
      applications.push({
        change,
        tool,
        result: await this.toolManager.executeTool(tool, removeUndefined(input))
      });
    }
    return applications;
  }

  async applyCosts(request, costPlan) {
    const applications = [];
    for (const cost of costPlan.costs) {
      const tool = costTool(cost);
      const input = buildResourceToolInput(request, cost, tool);
      applications.push({
        cost,
        tool,
        result: await this.toolManager.executeTool(tool, removeUndefined(input))
      });
    }
    return applications;
  }

  async snapshot(chatSessionId, sceneId) {
    if (!chatSessionId) return {};
    const result = await safeExecuteTool(this.toolManager, 'system.npc_state.list_states', removeUndefined({
      chatSessionId,
      sceneId,
      limit: 500
    }));
    return result.ok ? result.output : { error: result.error };
  }

  async withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = await this.snapshot(normalizedChatSessionId, input.sceneId);
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = await fn();
      const after = await this.snapshot(normalizedChatSessionId, input.sceneId);
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

function normalizeUseRequest(input = {}) {
  const actorId = normalizeRequiredText(input.actorId || input.npcId || input.playerId, 'actorId');
  const itemId = normalizeOptionalText(input.itemId || input.inventoryItemId || input.id);
  const consumeQuantity = normalizeOptionalNonNegativeNumber(input.consumeQuantity ?? input.quantity ?? input.amount);
  return {
    ...input,
    chatSessionId: normalizeRequiredText(input.chatSessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    actorId,
    playerId: normalizeOptionalText(input.playerId),
    recordId: normalizeOptionalText(input.recordId),
    stateRecordId: normalizeOptionalText(input.stateRecordId),
    itemId,
    itemName: normalizeOptionalText(input.itemName || input.name),
    itemKind: normalizeOptionalText(input.itemKind || input.kind || input.registryKind),
    targetIds: normalizeTargetIds(input),
    dryRun: Boolean(input.dryRun),
    requireOwned: input.requireOwned !== false,
    requiresEquipped: Boolean(input.requiresEquipped || input.requireEquipped),
    consumeQuantity,
    consumeItem: input.consumeItem,
    allowOverspend: Boolean(input.allowOverspend),
    removeWhenZero: input.removeWhenZero !== false,
    syncInventory: input.syncInventory !== false,
    source: normalizeOptionalText(input.source) || 'item-use'
  };
}

function normalizeEquipRequest(input = {}) {
  const base = normalizeUseRequest(input);
  return {
    ...base,
    slot: normalizeOptionalText(input.slot || input.equipSlot || input.bodySlot || input.equipmentSlot)
  };
}

function resolveOwnership(actor, request, itemDefinition, { allowEquipped = false } = {}) {
  const inventoryItems = normalizeInventoryItems(actor.inventory?.items);
  const inventoryItem = findInventoryItem(inventoryItems, request);
  const equipped = findEquippedItem(actor.equipment, request);
  const item = inventoryItem || equipped?.item || buildVirtualItem(request, itemDefinition);
  const itemOwned = Boolean(inventoryItem) || Boolean(equipped);
  if (request.requireOwned && !itemOwned) return { ok: false, reason: 'item_not_owned', item, inventoryItem, equipped };
  if (request.requiresEquipped && !inventoryItem?.equipped && !equipped) return { ok: false, reason: 'item_not_equipped', item, inventoryItem, equipped };
  if (!allowEquipped && request.consumeQuantity !== undefined && inventoryItem && (inventoryItem.quantity ?? 1) < request.consumeQuantity && !request.allowOverspend) {
    return { ok: false, reason: 'insufficient_item_quantity', item, inventoryItem, equipped };
  }
  return {
    ok: true,
    item,
    inventoryItem,
    equipped,
    itemOwned,
    equippedNow: Boolean(inventoryItem?.equipped || equipped)
  };
}

function resolveUnequipTarget(actor, request) {
  const slots = [];
  const items = [];
  if (request.slot) {
    const item = getEquipmentAtSlot(actor.equipment, request.slot);
    if (!item) return { ok: false, reason: 'slot_not_equipped' };
    slots.push(request.slot);
    items.push(resolveInventoryFallback(actor, item));
    return { ok: true, slots, items };
  }

  const requested = request.itemId || request.itemName;
  if (!requested) return { ok: false, reason: 'item_or_slot_required' };
  for (const match of collectEquippedItems(actor.equipment)) {
    if (matchesItem(match.item, { itemId: request.itemId, itemName: request.itemName })) {
      slots.push(match.path);
      items.push(resolveInventoryFallback(actor, match.item));
    }
  }
  const inventoryItem = findInventoryItem(normalizeInventoryItems(actor.inventory?.items), request);
  if (inventoryItem?.equipped && !items.some((item) => normalizeId(item.id) === normalizeId(inventoryItem.id))) {
    items.push(inventoryItem);
  }
  if (!slots.length && !items.length) return { ok: false, reason: 'item_not_equipped' };
  return { ok: true, slots, items };
}

function resolveInventoryFallback(actor, item) {
  const inventoryItem = findInventoryItem(normalizeInventoryItems(actor.inventory?.items), {
    itemId: item.id || item.itemId || item.sourceItemId,
    itemName: item.name
  });
  return inventoryItem || {
    id: item.id || item.itemId || item.sourceItemId || normalizeId(item.name),
    name: item.name || item.id,
    quantity: 1,
    metadata: {}
  };
}

function buildVirtualItem(request, itemDefinition) {
  if (!itemDefinition?.data && !request.itemId && !request.itemName) return undefined;
  const data = itemDefinition?.data || {};
  return {
    id: request.itemId || data.id || normalizeId(request.itemName || data.name),
    name: request.itemName || data.name || request.itemId,
    quantity: 1,
    tags: normalizeStringArray(data.tags),
    description: data.description || data.mechanicalEffect || '',
    metadata: {
      ...(isPlainObject(data.metadata) ? data.metadata : {}),
      registryKind: itemDefinition?.kind
    }
  };
}

function mergeUseEffectSources(request, itemData = {}) {
  const registryEffects = firstPlainObject(
    itemData?.metadata?.useEffects,
    itemData?.metadata?.effects,
    itemData?.metadata?.use,
    itemData?.uses?.effects,
    itemData?.uses,
    itemData?.useRules,
    itemData?.activation?.effects,
    itemData?.activation
  );
  return mergePlainObjects(
    extractInlineItemEffects(itemData),
    registryEffects,
    request.effects,
    request.useEffects,
    extractInlineItemEffects(request)
  );
}

function extractInlineItemEffects(input = {}) {
  if (!isPlainObject(input)) return {};
  return removeUndefined({
    hit: input.hit ?? input.attack,
    damage: input.damage ?? input.damages,
    damageRolls: input.damageRolls ?? input.damageDice,
    healing: input.healing ?? input.heals,
    healingRolls: input.healingRolls ?? input.healingDice,
    temporaryHp: input.temporaryHp ?? input.tempHp,
    statusEffects: input.statusEffects ?? input.statuses ?? input.conditions,
    resourceChanges: input.resourceChanges ?? input.resourceEffects,
    resourceCosts: input.resourceCosts ?? input.costs,
    consume: input.consume ?? input.consumes ?? input.consumable,
    consumeQuantity: input.consumeQuantity ?? input.quantity ?? input.amount
  });
}

function buildCostPlan(request, ownership, useEffects) {
  const costs = [];
  const shouldConsume = request.consumeItem === true
    || useEffects.consume === true
    || useEffects.consume?.enabled === true
    || request.consumeQuantity !== undefined
    || useEffects.consumeQuantity !== undefined;
  const consumeQuantity = normalizeOptionalNonNegativeNumber(request.consumeQuantity ?? useEffects.consumeQuantity ?? useEffects.consume?.quantity ?? useEffects.consume?.amount);
  if (shouldConsume) {
    costs.push({
      kind: 'consumeItem',
      category: request.consumeCategory || 'consumables',
      itemId: ownership.inventoryItem?.id || request.itemId,
      resourceId: request.resourceId || ownership.inventoryItem?.id || request.itemId,
      itemName: ownership.inventoryItem?.name || request.itemName,
      amount: consumeQuantity ?? 1,
      syncInventory: request.syncInventory,
      removeWhenZero: request.removeWhenZero,
      allowOverspend: request.allowOverspend
    });
  }
  for (const cost of useEffects.resourceCosts) costs.push(cost);
  return { costs };
}

function validateCostPlan(actor, costPlan) {
  const results = costPlan.costs.map((cost) => validateOneCost(actor, cost));
  return {
    ok: results.every((result) => result.ok),
    costs: results
  };
}

function validateOneCost(actor, cost = {}) {
  if (cost.allowOverspend) return { ok: true, cost, available: Infinity };
  const amount = normalizeNonNegativeNumber(cost.amount ?? cost.quantity ?? cost.value ?? 1, 'cost.amount');
  if (cost.kind === 'actionEconomy') {
    const key = normalizeActionKey(cost.resource || cost.actionType || cost.resourceId || 'action');
    const pool = actor.resources?.actionEconomy?.[key] || actor.statusBar?.actionEconomy?.[key];
    const available = Number(pool?.current ?? 0);
    return { ok: available >= amount, cost, resource: key, requested: amount, available };
  }
  if (cost.kind === 'consumeItem') {
    const itemId = cost.itemId || cost.inventoryItemId || cost.resourceId;
    const inventoryItem = findInventoryItem(normalizeInventoryItems(actor.inventory?.items), { itemId, itemName: cost.itemName });
    const resource = actor.resources?.[cost.category || 'consumables']?.[cost.resourceId || itemId];
    const available = Number(resource?.current ?? inventoryItem?.quantity ?? 0);
    return { ok: available >= amount, cost, requested: amount, available };
  }
  const category = normalizeResourceCategory(cost.category || cost.resourceType || 'custom');
  const resourceId = normalizeOptionalText(cost.resourceId || cost.id || cost.name);
  const resource = actor.resources?.[category]?.[resourceId];
  const available = Number(resource?.current ?? 0);
  return { ok: available >= amount, cost, category, resourceId, requested: amount, available };
}

function buildSettlementInput(request, useEffects) {
  const targetInputs = normalizeSettlementTargets(request, useEffects);
  return removeUndefined({
    chatSessionId: request.chatSessionId,
    sceneId: request.sceneId,
    source: request.source,
    sourceActionId: request.actionId || request.useId,
    targets: targetInputs
  });
}

function hasItemUseApplications({ settlementInput, useEffects, costPlan } = {}) {
  return Boolean(
    hasSettlementEffects(settlementInput)
    || (Array.isArray(useEffects?.resourceChanges) && useEffects.resourceChanges.length)
    || (Array.isArray(costPlan?.costs) && costPlan.costs.length)
  );
}

function normalizeSettlementTargets(request, useEffects) {
  const suppliedTargets = normalizeTargetObjects(request.targets || request.target);
  if (suppliedTargets.length) {
    return suppliedTargets.map((target) => sanitizeSettlementTarget({
      ...target,
      npcId: target.npcId || target.actorId || target.playerId || target.id,
      hit: target.hit ?? target.attack ?? useEffects.hit,
      damage: target.damage ?? target.damages ?? useEffects.damage,
      healing: target.healing ?? target.heals ?? useEffects.healing,
      temporaryHp: target.temporaryHp ?? target.tempHp ?? useEffects.temporaryHp,
      statusEffects: target.statusEffects ?? target.statuses ?? target.conditions ?? useEffects.statusEffects
    }));
  }
  const hasEffects = useEffects.damage.length
    || useEffects.healing.length
    || useEffects.temporaryHp !== undefined
    || useEffects.statusEffects.length;
  if (!hasEffects) return [];
  const ids = request.targetIds.length ? request.targetIds : [request.actorId];
  return ids.map((targetId) => sanitizeSettlementTarget({
    npcId: targetId,
    hit: useEffects.hit,
    damage: useEffects.damage,
    healing: useEffects.healing,
    temporaryHp: useEffects.temporaryHp,
    statusEffects: useEffects.statusEffects
  }));
}

function sanitizeSettlementTarget(target = {}) {
  const allowed = [
    'sceneId',
    'npcId',
    'playerId',
    'actorId',
    'id',
    'name',
    'actorType',
    'type',
    'isPlayer',
    'player',
    'protagonistId',
    'hit',
    'attack',
    'outcome',
    'damage',
    'damages',
    'damageRolls',
    'healing',
    'heals',
    'temporaryHp',
    'tempHp',
    'statusEffects',
    'statuses',
    'conditions',
    'defenses',
    'resistances',
    'vulnerabilities',
    'immunities',
    'concentration',
    'concentrating',
    'concentrationCheck',
    'concentrationSave',
    'deathSave',
    'deathSaveResult',
    'deathSaves',
    'deathSaveSuccesses',
    'deathSaveFailures',
    'currentHp',
    'hp',
    'maxHp',
    'currentTemporaryHp',
    'temporaryHpBefore',
    'tempHpBefore',
    'applyDamageOnMiss',
    'allowHealingDead',
    'source'
  ];
  return removeUndefined(Object.fromEntries(allowed
    .filter((key) => target[key] !== undefined)
    .map((key) => [key, target[key]])));
}

function hasSettlementEffects(settlementInput = {}) {
  const targets = settlementInput.targets || [];
  return targets.some((target) => (
    normalizeEffectArray(target.damage ?? target.damages).length
    || normalizeEffectArray(target.healing ?? target.heals).length
    || target.temporaryHp !== undefined
    || target.tempHp !== undefined
    || normalizeEffectArray(target.statusEffects ?? target.statuses ?? target.conditions).length
    || target.deathSave !== undefined
  ));
}

function resolveEquipSlot(request, inventoryItem, itemDefinition) {
  const data = itemDefinition?.data || {};
  const slot = normalizeOptionalText(
    request.slot
    || inventoryItem?.metadata?.equippedSlot
    || inventoryItem?.metadata?.slot
    || data.slot
    || data.equipSlot
    || data.bodySlot
  );
  if (slot) return slot;
  const kind = normalizeRegistryKind(itemDefinition?.kind || request.itemKind);
  if (kind === 'weapon') return 'mainHand';
  if (kind === 'accessory') return 'accessory';
  if (kind === 'mount') return 'mount';
  if (kind === 'special_item') return 'special';
  if (kind === 'equipment') return 'body';
  return 'gear';
}

function buildInventoryPatchItem(item, patch = {}) {
  return removeUndefined({
    id: item.id || item.itemId || item.sourceItemId,
    name: item.name || item.id,
    quantity: item.quantity,
    equipped: patch.equipped,
    value: item.value,
    weight: item.weight,
    tags: item.tags,
    description: item.description,
    metadata: {
      ...(isPlainObject(item.metadata) ? item.metadata : {}),
      ...(isPlainObject(patch.metadata) ? patch.metadata : {})
    }
  });
}

function buildEquipmentRef({ slot, item, itemDefinition, source }) {
  const data = itemDefinition?.data || {};
  return removeUndefined({
    id: item.id || item.itemId || data.id,
    itemId: item.id || item.itemId || data.id,
    registryKind: itemDefinition?.kind,
    name: item.name || data.name || item.id,
    slot,
    tags: item.tags || data.tags,
    description: item.description || data.description || data.mechanicalEffect,
    equippedAt: new Date().toISOString(),
    source
  });
}

function slotPathToPatch(path, value) {
  const parts = String(path || 'gear').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { gear: value };
  let root = {};
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
  return root;
}

function getEquipmentAtSlot(equipment = {}, path) {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  let cursor = equipment;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return isPlainObject(cursor) ? cursor : undefined;
}

function findEquippedItem(equipment = {}, request = {}) {
  return collectEquippedItems(equipment).find((match) => matchesItem(match.item, request));
}

function collectEquippedItems(equipment = {}, prefix = '') {
  const output = [];
  if (!equipment || typeof equipment !== 'object') return output;
  if (Array.isArray(equipment)) {
    equipment.forEach((item, index) => {
      output.push(...collectEquippedItems(item, `${prefix}.${index}`.replace(/^\./, '')));
    });
    return output;
  }
  if (equipment.id || equipment.itemId || equipment.name || equipment.sourceItemId) {
    output.push({ path: prefix || String(equipment.slot || 'gear'), item: equipment });
  }
  for (const [key, value] of Object.entries(equipment)) {
    if (value && typeof value === 'object') {
      output.push(...collectEquippedItems(value, `${prefix}.${key}`.replace(/^\./, '')));
    }
  }
  return output;
}

function findInventoryItem(items = [], request = {}) {
  return items.find((item) => matchesItem(item, request));
}

function matchesItem(item = {}, request = {}) {
  const requestIds = [
    request.itemId,
    request.inventoryItemId,
    request.id
  ].filter(Boolean).map(normalizeId);
  const itemIds = [
    item.id,
    item.itemId,
    item.sourceItemId
  ].filter(Boolean).map(normalizeId);
  if (requestIds.length && itemIds.some((id) => requestIds.includes(id))) return true;
  const requestName = normalizeSearchText(request.itemName || request.name);
  return Boolean(requestName && normalizeSearchText(item.name || item.id) === requestName);
}

function normalizeInventoryItems(items = []) {
  return (Array.isArray(items) ? items : [items])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      ...item,
      id: normalizeOptionalText(item.id || item.itemId || item.name),
      name: normalizeOptionalText(item.name || item.id),
      quantity: normalizeOptionalNonNegativeNumber(item.quantity ?? item.count) ?? 1,
      equipped: item.equipped === true,
      tags: normalizeStringArray(item.tags),
      metadata: isPlainObject(item.metadata) ? item.metadata : {}
    }));
}

function normalizeTargetIds(input = {}) {
  return [
    ...normalizeStringArray(input.targetIds),
    ...normalizeStringArray(input.targetId),
    ...normalizeStringArray(input.targetNpcId),
    ...normalizeStringArray(input.targetPlayerId)
  ].filter(Boolean);
}

function normalizeTargetObjects(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function normalizeEffectArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== undefined && item !== null && item !== '');
}

function normalizeResourceChanges(value) {
  return normalizeEffectArray(value)
    .filter(isPlainObject)
    .map((change) => ({
      ...change,
      operation: normalizeMode(change.operation || change.mode || change.kind || change.type || 'restore')
    }));
}

function normalizeCostArray(value) {
  return normalizeEffectArray(value)
    .filter(isPlainObject)
    .map((cost) => ({
      ...cost,
      kind: normalizeCostKind(cost.kind || cost.type || cost.operation),
      amount: normalizeOptionalNonNegativeNumber(cost.amount ?? cost.quantity ?? cost.value) ?? 1
    }));
}

function normalizeCostKind(value) {
  const normalized = normalizeMode(value);
  if (['action', 'bonusaction', 'bonus_action', 'reaction', 'movement', 'actioneconomy', 'action_economy'].includes(normalized)) return 'actionEconomy';
  if (['consume', 'consumeitem', 'consume_item', 'item'].includes(normalized)) return 'consumeItem';
  return 'resource';
}

function buildResourceToolInput(request, change = {}, tool) {
  const base = {
    chatSessionId: request.chatSessionId,
    sceneId: change.sceneId || request.sceneId,
    npcId: change.actorId || change.npcId || change.targetId || request.actorId,
    playerId: change.playerId,
    source: request.source
  };
  if (tool === 'system.resources.spend_action_economy' || tool === 'system.resources.restore_action_economy') {
    return {
      ...base,
      resource: change.resource || change.actionType || change.resourceId || change.id,
      amount: change.amount ?? change.value ?? change.distance,
      allowOverspend: change.allowOverspend
    };
  }
  if (tool === 'system.resources.reset_action_economy') {
    return {
      ...base,
      reset: change.reset || change.resources,
      movementMax: change.movementMax,
      speed: change.speed,
      movementUnit: change.movementUnit,
      turnId: change.turnId
    };
  }
  if (tool === 'system.resources.start_cooldown') {
    return {
      ...base,
      cooldownId: change.cooldownId || change.resourceId || change.id,
      remainingTurns: change.remainingTurns,
      turns: change.turns ?? change.durationTurns ?? change.duration,
      maxTurns: change.maxTurns,
      metadata: change.metadata
    };
  }
  if (tool === 'system.resources.tick_cooldowns') {
    return {
      ...base,
      cooldownIds: change.cooldownIds,
      cooldownId: change.cooldownId || change.resourceId,
      amount: change.amount ?? change.turns,
      force: change.force,
      limit: change.limit
    };
  }
  if (tool === 'system.resources.set_resource') {
    return {
      ...base,
      category: change.category || change.resourceType || change.type,
      resourceId: change.resourceId || change.id || change.name,
      current: change.current ?? change.value ?? change.amount,
      max: change.max ?? change.maxValue ?? change.maximum,
      itemId: change.itemId,
      recharge: change.recharge,
      unit: change.unit,
      metadata: change.metadata
    };
  }
  return {
    ...base,
    category: change.category || change.resourceType || change.type || (tool === 'system.resources.consume_item' ? 'consumables' : undefined),
    resourceId: change.resourceId || change.id || change.name || change.itemId,
    itemId: change.itemId || change.inventoryItemId || change.resourceId,
    itemName: change.itemName || change.name,
    amount: change.amount ?? change.quantity ?? change.value ?? 1,
    syncInventory: change.syncInventory,
    removeWhenZero: change.removeWhenZero,
    allowOverspend: change.allowOverspend
  };
}

function resourceChangeTool(operation) {
  if (['spend', 'spendresource', 'spend_resource'].includes(operation)) return 'system.resources.spend_resource';
  if (['set', 'setresource', 'set_resource'].includes(operation)) return 'system.resources.set_resource';
  if (['consume', 'consumeitem', 'consume_item'].includes(operation)) return 'system.resources.consume_item';
  if (['spendaction', 'spend_action', 'spendactioneconomy', 'spend_action_economy'].includes(operation)) return 'system.resources.spend_action_economy';
  if (['restoreaction', 'restore_action', 'restoreactioneconomy', 'restore_action_economy'].includes(operation)) return 'system.resources.restore_action_economy';
  if (['resetaction', 'reset_action', 'resetactioneconomy', 'reset_action_economy'].includes(operation)) return 'system.resources.reset_action_economy';
  if (['cooldown', 'startcooldown', 'start_cooldown'].includes(operation)) return 'system.resources.start_cooldown';
  if (['tickcooldowns', 'tick_cooldowns'].includes(operation)) return 'system.resources.tick_cooldowns';
  return 'system.resources.restore_resource';
}

function costTool(cost) {
  if (cost.kind === 'actionEconomy') return 'system.resources.spend_action_economy';
  if (cost.kind === 'consumeItem') return 'system.resources.consume_item';
  return 'system.resources.spend_resource';
}

function normalizeActionKey(value) {
  const key = normalizeMode(value || 'action');
  if (['bonus', 'bonusaction', 'bonus_action'].includes(key)) return 'bonusAction';
  return key;
}

function normalizeResourceCategory(value) {
  const normalized = normalizeOptionalText(value || 'custom');
  const key = normalized.toLowerCase();
  if (['spellslots', 'spell_slots', 'slot', 'slots'].includes(key)) return 'spellSlots';
  if (['skilluses', 'skill_uses', 'skills'].includes(key)) return 'skillUses';
  return normalized;
}

function registryGetToolName(kind) {
  if (kind === 'special_item') return 'system.item_registry.get_special_item';
  return `system.item_registry.get_${kind}`;
}

function normalizeRegistryKind(value) {
  const normalized = normalizeMode(value);
  if (!normalized) return '';
  if (['items', 'item'].includes(normalized)) return 'item';
  if (['equipment', 'equip', 'gear'].includes(normalized)) return 'equipment';
  if (['accessories', 'accessory'].includes(normalized)) return 'accessory';
  if (['weapons', 'weapon'].includes(normalized)) return 'weapon';
  if (['mounts', 'mount'].includes(normalized)) return 'mount';
  if (['specialitem', 'special_item', 'specialitems', 'special_items'].includes(normalized)) return 'special_item';
  return '';
}

function blockedResult(reason, request, actor, ownership, itemDefinition) {
  return {
    ok: false,
    status: 'blocked',
    reason,
    llmUsed: false,
    dryRun: request.dryRun,
    request,
    actor: actor.data,
    item: ownership.item,
    ownership,
    itemDefinition
  };
}

async function safeExecuteTool(toolManager, tool, input) {
  try {
    const result = await toolManager.executeTool(tool, input);
    return { ok: true, output: result.output, result };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}

function mergePlainObjects(...values) {
  return Object.assign({}, ...values.filter(isPlainObject));
}

function firstPlainObject(...values) {
  return values.find(isPlainObject) || {};
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, removeUndefined(item)]));
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean);
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

function normalizeId(value) {
  const text = normalizeOptionalText(value).toLowerCase();
  const safe = text.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || text;
}

function normalizeSearchText(value) {
  return normalizeOptionalText(value).toLowerCase();
}

function normalizeMode(value) {
  return normalizeOptionalText(value).replace(/[\s-]+/g, '_').toLowerCase();
}

function normalizeOptionalNonNegativeNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeNonNegativeNumber(value, 'value');
}

function normalizeNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw validationError(`${field} must be a non-negative number`);
  return number;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ItemUseValidationError';
  error.statusCode = 400;
  return error;
}
