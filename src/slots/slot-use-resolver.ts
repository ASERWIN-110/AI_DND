// @ts-nocheck
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const SLOT_USE_TRACE_DIR = 'data/slot-use-traces';

export const SLOT_USE_REFERENCE = {
  version: 'slot_use_v1',
  purpose: 'Unified backend entry for clicking inventory items or skill-bar actions from UI.',
  noLlmByDefault: true,
  routes: {
    deterministic: 'Use existing no-LLM item/combat/effects/resources tools directly.',
    adjudicated: 'Return an adjudication proposal for special textual effects; do not mutate state by default.',
    hybrid: 'Execute deterministic numeric effects and return a pending adjudication proposal for special text.'
  },
  targetPolicies: ['self', 'singleAlly', 'singleEnemy', 'singleActor', 'multipleActors', 'sceneObject', 'mapLocation', 'noTarget'],
  expiryPolicy: 'Temporary buffs are stored as Actor specialStatuses and removed later by system.triggers.tick_status_effects.'
};

export class SlotUseResolver {
  constructor({
    toolManager,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!toolManager) throw validationError('SlotUseResolver requires toolManager');
    this.toolManager = toolManager;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || SLOT_USE_TRACE_DIR,
      cwd,
      now: this.now
    });
  }

  describe() {
    return {
      ...SLOT_USE_REFERENCE,
      toolsReused: [
        'system.npc_state.get_state',
        'system.npc_state.list_states',
        'system.scene_npcs.list_mounted_npcs',
        'system.item_registry.get_*',
        'system.item_use.preview_use_item',
        'system.item_use.use_item',
        'system.combat.list_player_actions',
        'system.combat.build_player_action',
        'system.combat.resolve_action',
        'system.action.resolve',
        'system.combat.judge_special_action'
      ],
      stateBoundary: 'SlotUseResolver stores no business records. It only routes a UI click to existing tools and writes slot-use trace files.'
    };
  }

  async listSlots(input = {}, context) {
    const request = normalizeRequest(input);
    const actor = await this.getActor(request, context);
    const itemSlots = buildItemSlots(actor.data);
    const skillSlots = await this.buildSkillSlots(request, actor.data, context);
    return {
      noLlm: true,
      actor: compactActor(actor),
      itemSlots,
      skillSlots,
      slots: [...itemSlots, ...skillSlots],
      targetPolicies: SLOT_USE_REFERENCE.targetPolicies
    };
  }

  async previewUse(input = {}, context) {
    return this.withTrace('slot-use-preview', input.chatSessionId, input, async () => {
      const plan = await this.buildUsePlan({ ...input, dryRun: true }, context);
      if (!plan.directToolCall) return plan;
      const preview = await this.executeDirectPlan(plan, true, context);
      return {
        ...plan,
        status: plan.route === 'hybrid' ? 'dry_run_with_pending_adjudication' : 'dry_run',
        dryRun: true,
        directPreview: preview
      };
    }, context);
  }

  async commitUse(input = {}, context) {
    return this.withTrace('slot-use-commit', input.chatSessionId, input, async () => {
      const plan = await this.buildUsePlan({ ...input, dryRun: false }, context);
      if (!plan.directToolCall) {
        if (plan.route === 'adjudicated' && input.executeAdjudication === true) {
          const adjudication = await this.executeAdjudication(plan, context);
          return { ...plan, adjudication };
        }
        return plan;
      }
      const directResult = await this.executeDirectPlan(plan, false, context);
      const result = {
        ...plan,
        status: plan.route === 'hybrid' ? 'resolved_with_pending_adjudication' : 'resolved',
        dryRun: false,
        directResult
      };
      if (plan.route === 'hybrid' && input.executeAdjudication === true) {
        result.adjudication = await this.executeAdjudication(plan, context);
      }
      return result;
    }, context);
  }

  async buildUsePlan(input = {}, context) {
    const request = normalizeRequest(input);
    const actor = await this.getActor(request, context);
    const sourceKind = resolveSourceKind(request);
    if (sourceKind === 'item') return this.buildItemPlan(request, actor, context);
    if (sourceKind === 'skill') return this.buildSkillPlan(request, actor, context);
    return {
      ok: false,
      status: 'blocked',
      reason: 'slot_source_required',
      llmUsed: false,
      dryRun: request.dryRun,
      request,
      actor: compactActor(actor)
    };
  }

  async buildItemPlan(request, actor, context) {
    const item = findInventoryItem(actor.data?.inventory?.items, request);
    const itemDefinition = await this.resolveItemDefinition(request, context);
    if (request.requireOwned !== false && !item) {
      return blockedPlan('item_not_owned', request, actor, { sourceKind: 'item', itemDefinition });
    }
    const slot = normalizeItemSlot(item, itemDefinition, request);
    const config = collectExecutionConfig(request, slot, itemDefinition?.data);
    if (config.executionMode === 'disabled') {
      return blockedPlan('slot_use_disabled', request, actor, { sourceKind: 'item', slot, itemDefinition });
    }
    const useEffects = buildItemUseEffects(request, slot, itemDefinition?.data);
    const hasDeterministic = hasUseEffects(useEffects) || isEquipMode(request.useMode || request.mode);
    const narrativeUseText = normalizeOptionalText(
      request.sourceText
      || config.specialText
      || slot.description
      || itemDefinition?.data?.mechanicalEffect
      || itemDefinition?.data?.description
    );
    if (!hasDeterministic && !narrativeUseText) {
      return blockedPlan('item_has_no_direct_effect', request, actor, {
        sourceKind: 'item',
        slot,
        itemDefinition,
        useEffects,
        targetPolicy: 'noTarget'
      });
    }
    const special = buildSpecialAssessment(request, config, {
      sourceKind: 'item',
      sourceText: narrativeUseText,
      hasDeterministic
    });
    const route = chooseRoute(config, hasDeterministic, special);
    const targetPolicy = resolveTargetPolicy(request, config, useEffects, { sourceKind: 'item' });
    const targetIds = resolveTargetIds(request, targetPolicy, actor.data);
    if (route !== 'adjudicated' && needsTarget(targetPolicy) && !targetIds.length) {
      return this.needsTargetPlan(request, actor, {
        sourceKind: 'item',
        slot,
        itemDefinition,
        useEffects,
        route,
        targetPolicy,
        special
      }, context);
    }
    const directToolCall = route === 'adjudicated'
      ? undefined
      : {
        tool: isEquipMode(request.useMode || request.mode) ? 'system.item_use.equip_item' : 'system.item_use.use_item',
        input: removeUndefined({
          chatSessionId: request.chatSessionId,
          sceneId: request.sceneId,
          actorId: request.actorId,
          itemId: slot.itemId,
          itemName: slot.name,
          itemKind: request.itemKind || itemDefinition?.kind || slot.itemKind,
          targetIds: targetIds.length > 1 ? targetIds : undefined,
          targetId: targetIds.length === 1 ? targetIds[0] : undefined,
          useMode: request.useMode || request.mode,
          slot: request.slot || config.slot,
          consumeItem: request.consumeItem ?? config.consumeItem,
          consumeQuantity: request.consumeQuantity ?? config.consumeQuantity,
          quantity: request.quantity,
          requireOwned: request.requireOwned,
          requiresEquipped: request.requiresEquipped,
          effects: useEffects,
          hit: request.hit,
          source: request.source || 'slot-use:item',
          actionId: request.actionId || request.useId || slot.slotId,
          metadata: {
            ...normalizeObject(request.metadata),
            slotUse: true,
            sourceKind: 'item',
            executionMode: route
          }
        })
      };
    return this.finalPlan(request, actor, {
      sourceKind: 'item',
      slot,
      itemDefinition,
      useEffects,
      route,
      targetPolicy,
      targetIds,
      directToolCall,
      special,
      config
    });
  }

  async buildSkillPlan(request, actor, context) {
    const listed = await safeExecuteTool(this.toolManager, 'system.combat.list_player_actions', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      actorId: request.actorId,
      targetId: firstTargetId(request),
      targetIds: request.targetIds,
      includeBasicAttack: request.includeBasicAttack === true,
      selectedActionId: request.skillId || request.actionId || request.slotId || request.id
    }, context);
    if (!listed.ok) return blockedPlan('skill_slots_unavailable', request, actor, { error: listed.error, sourceKind: 'skill' });
    const choices = listed.output.choices || [];
    const selectedId = request.skillId || request.actionId || request.slotId || request.id || request.selectedActionId;
    const selected = selectedId
      ? choices.find((choice) => matchesSlotId(choice, selectedId))
      : choices[0];
    if (!selected) {
      return blockedPlan('skill_not_found', request, actor, {
        sourceKind: 'skill',
        availableChoices: choices.map(compactSkillChoice)
      });
    }
    if (selected.ready === false) {
      return blockedPlan('skill_not_ready', request, actor, { sourceKind: 'skill', selected });
    }
    const mechanic = findListedMechanic(listed.output.mechanics, selected);
    const config = collectExecutionConfig(request, selected, mechanic?.data);
    if (config.executionMode === 'disabled') {
      return blockedPlan('slot_use_disabled', request, actor, { sourceKind: 'skill', selected, mechanic });
    }
    const hasDeterministic = hasSkillEffects(selected) || config.directUseAllowed === true;
    const special = buildSpecialAssessment(request, config, {
      sourceKind: 'skill',
      sourceText: request.sourceText || config.specialText || selected.description || mechanic?.data?.mechanicalEffect,
      hasDeterministic
    });
    const route = chooseRoute(config, hasDeterministic, special);
    const targetPolicy = request.targetPolicy || selected.targetPolicy || resolveTargetPolicy(request, config, selected, { sourceKind: 'skill' });
    const targetIds = resolveTargetIds(request, targetPolicy, actor.data, selected.defaultTargetId);
    if (route !== 'adjudicated' && selected.requiresTarget && !targetIds.length) {
      return this.needsTargetPlan(request, actor, {
        sourceKind: 'skill',
        slot: skillSlotFromChoice(selected),
        selected,
        mechanic,
        route,
        targetPolicy,
        special
      }, context);
    }
    let directToolCall;
    let builtAction;
    if (route !== 'adjudicated') {
      const buildResult = await safeExecuteTool(this.toolManager, 'system.combat.build_player_action', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        battleId: request.battleId,
        actorId: request.actorId,
        selectedActionId: selected.actionId,
        targetId: targetIds.length === 1 ? targetIds[0] : undefined,
        targetIds: targetIds.length > 1 ? targetIds : undefined,
        hitResult: request.hitResult,
        sourceText: request.sourceText
      }, context);
      if (!buildResult.ok) {
        return blockedPlan('skill_build_failed', request, actor, {
          sourceKind: 'skill',
          selected,
          error: buildResult.error
        });
      }
      builtAction = buildResult.output;
      const actionInput = {
        ...builtAction.resolveActionInput,
        battleId: request.battleId,
        dryRun: request.dryRun,
        consumeAction: request.consumeAction !== undefined
          ? request.consumeAction
          : request.battleId
            ? builtAction.resolveActionInput.consumeAction
            : false,
        recordEvent: request.recordEvent,
        useModifierResolver: request.useModifierResolver,
        applyModifiers: request.applyModifiers,
        sourceText: request.sourceText || builtAction.resolveActionInput.sourceText,
        metadata: {
          ...normalizeObject(builtAction.resolveActionInput.metadata),
          ...normalizeObject(request.metadata),
          slotUse: true,
          sourceKind: 'skill',
          executionMode: route
        }
      };
      directToolCall = {
        tool: 'system.combat.resolve_action',
        input: removeUndefined(actionInput)
      };
    }
    return this.finalPlan(request, actor, {
      sourceKind: 'skill',
      slot: skillSlotFromChoice(selected),
      selected,
      mechanic,
      builtAction,
      route,
      targetPolicy,
      targetIds,
      directToolCall,
      special,
      config
    });
  }

  async needsTargetPlan(request, actor, details, context) {
    return {
      ok: true,
      status: 'needs_target',
      reason: 'target_required',
      llmUsed: false,
      dryRun: request.dryRun,
      request,
      actor: compactActor(actor),
      targetPolicy: details.targetPolicy,
      targetCandidates: await this.listTargetCandidates(request, actor.data, details.targetPolicy, context),
      ...details,
      directToolCall: details.directToolCall,
      adjudicationToolCall: details.special?.adjudicationToolCall
    };
  }

  finalPlan(request, actor, details) {
    const status = details.route === 'adjudicated'
      ? 'needs_adjudication'
      : details.route === 'hybrid'
        ? 'ready_with_pending_adjudication'
        : 'ready';
    return {
      ok: true,
      status,
      reason: status === 'needs_adjudication' ? 'special_description_requires_adjudication' : undefined,
      llmUsed: false,
      dryRun: request.dryRun,
      request,
      actor: compactActor(actor),
      ...details,
      adjudicationToolCall: details.special?.adjudicationToolCall
    };
  }

  async executeDirectPlan(plan, dryRun, context) {
    if (!plan.directToolCall) return undefined;
    const input = {
      ...plan.directToolCall.input,
      dryRun
    };
    const result = await this.toolManager.executeTool(plan.directToolCall.tool, input, undefined, context);
    return {
      tool: plan.directToolCall.tool,
      input,
      output: result.output,
      trace: result.trace
    };
  }

  async executeAdjudication(plan, context) {
    if (!plan.adjudicationToolCall) return undefined;
    const result = await this.toolManager.executeTool(plan.adjudicationToolCall.tool, plan.adjudicationToolCall.input, undefined, context);
    return {
      tool: plan.adjudicationToolCall.tool,
      input: plan.adjudicationToolCall.input,
      output: result.output,
      trace: result.trace
    };
  }

  async getActor(request, context) {
    const result = await this.toolManager.executeTool('system.npc_state.get_state', removeUndefined({
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      npcId: request.actorId
    }), undefined, context);
    return result.output;
  }

  async resolveItemDefinition(request, context) {
    if (isPlainObject(request.item)) return { source: 'input', kind: request.itemKind || 'custom', data: request.item };
    const itemId = request.itemId || request.slotId || request.id;
    if (!itemId) return undefined;
    const requested = normalizeStringArray(request.itemKind || request.registryKind || request.kind);
    const kinds = requested.length ? requested : ['item', 'equipment', 'accessory', 'weapon', 'mount', 'special_item'];
    for (const kind of kinds.map(normalizeRegistryKind).filter(Boolean)) {
      const tool = registryGetToolName(kind);
      const result = await safeExecuteTool(this.toolManager, tool, { id: itemId }, context);
      if (result.ok) return { source: tool, kind, record: result.output, data: result.output?.data || result.output };
    }
    return undefined;
  }

  async buildSkillSlots(request, actor, context) {
    const result = await safeExecuteTool(this.toolManager, 'system.combat.list_player_actions', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      actorId: request.actorId,
      includeBasicAttack: request.includeBasicAttack === true
    }, context);
    if (!result.ok) return [];
    return (result.output.choices || [])
      .filter((choice) => request.includeBasicAttack === true || choice.actionId !== 'basic_attack')
      .map((choice) => ({
        ...skillSlotFromChoice(choice),
        routeHint: hasSkillEffects(choice) ? 'deterministic' : 'adjudicated',
        ready: choice.ready !== false,
        reasonUnavailable: choice.reasonUnavailable
      }));
  }

  async listTargetCandidates(request, actor, targetPolicy, context) {
    const candidates = [];
    const push = (candidate, source) => {
      const id = normalizeOptionalText(candidate?.npcId || candidate?.actorId || candidate?.playerId || candidate?.id);
      if (!id) return;
      if (candidates.some((item) => item.actorId === id)) return;
      candidates.push(removeUndefined({
        actorId: id,
        npcId: candidate.npcId || id,
        name: candidate.name,
        actorType: candidate.actorType || candidate.type,
        isPlayer: candidate.isPlayer,
        relation: id === (actor.npcId || actor.actorId) ? 'self' : undefined,
        source
      }));
    };
    push(actor, 'actor_state:self');
    const states = await safeExecuteTool(this.toolManager, 'system.npc_state.list_states', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      limit: 200
    }, context);
    for (const record of states.output?.records || []) push(record.data || record, 'npc_state');
    const mounts = await safeExecuteTool(this.toolManager, 'system.scene_npcs.list_mounted_npcs', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      includeInactive: false,
      limit: 200
    }, context);
    for (const record of mounts.output?.records || mounts.output?.npcs || []) push(record.data || record, 'scene_npcs');
    return filterCandidatesByPolicy(candidates, targetPolicy, actor);
  }

  async snapshot(chatSessionId, sceneId, context) {
    if (!chatSessionId) return {};
    const result = await safeExecuteTool(this.toolManager, 'system.npc_state.list_states', removeUndefined({
      chatSessionId,
      sceneId,
      limit: 500
    }), context);
    return result.ok ? result.output : { error: result.error };
  }

  async withTrace(operation, chatSessionId, input, fn, context) {
    const normalizedChatSessionId = normalizeOptionalText(chatSessionId) || 'no-session';
    const before = await this.snapshot(chatSessionId, input.sceneId, context);
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = await fn();
      const after = await this.snapshot(chatSessionId, input.sceneId, context);
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

function normalizeRequest(input = {}) {
  const actorId = normalizeRequiredText(input.actorId || input.npcId || input.playerId, 'actorId');
  const targetIds = normalizeStringArray(input.targetIds || input.targetId || input.targetNpcId || input.targets);
  return {
    ...input,
    chatSessionId: normalizeRequiredText(input.chatSessionId || input.chatId || input.sessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    actorId,
    sourceKind: normalizeOptionalText(input.sourceKind || input.slotKind || input.kind),
    slotId: normalizeOptionalText(input.slotId || input.selectedSlotId || input.id),
    itemId: normalizeOptionalText(input.itemId || input.inventoryItemId || (isItemKind(input.sourceKind || input.slotKind || input.kind) ? input.id : '')),
    skillId: normalizeOptionalText(input.skillId || input.selectedActionId || (isSkillKind(input.sourceKind || input.slotKind || input.kind) ? input.id : '')),
    actionId: normalizeOptionalText(input.actionId),
    itemKind: normalizeOptionalText(input.itemKind || input.registryKind),
    targetIds,
    targetId: targetIds[0] || '',
    targetPolicy: normalizeOptionalText(input.targetPolicy || input.targetMode),
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    dryRun: Boolean(input.dryRun),
    requireOwned: input.requireOwned,
    requiresEquipped: input.requiresEquipped || input.requireEquipped,
    useMode: normalizeOptionalText(input.useMode || input.mode),
    consumeQuantity: optionalNumber(input.consumeQuantity ?? input.quantity ?? input.amount),
    consumeItem: input.consumeItem,
    executionMode: normalizeOptionalText(input.executionMode || input.modeOverride),
    directUseAllowed: input.directUseAllowed,
    executeAdjudication: input.executeAdjudication === true
  };
}

function resolveSourceKind(request) {
  if (isItemKind(request.sourceKind)) return 'item';
  if (isSkillKind(request.sourceKind)) return 'skill';
  if (request.itemId) return 'item';
  if (request.skillId || request.actionId) return 'skill';
  return '';
}

function buildItemSlots(actor = {}) {
  return normalizeArray(actor.inventory?.items).map((item) => {
    const metadata = normalizeObject(item.metadata);
    const effects = buildDirectBuffEffect(metadata, { id: item.id || item.itemId, name: item.name, sourceKind: 'item' });
    return removeUndefined({
      sourceKind: 'item',
      slotId: item.id || item.itemId || item.name,
      itemId: item.id || item.itemId,
      name: item.name || item.id,
      quantity: item.quantity,
      equipped: item.equipped,
      tags: item.tags,
      description: item.description,
      targetPolicy: metadata.targetPolicy || metadata.targetMode,
      executionMode: metadata.executionMode,
      directUseAllowed: metadata.directUseAllowed,
      routeHint: hasUseEffects({ ...normalizeObject(metadata.useEffects || metadata.effects || metadata.use), statusEffects: effects ? [effects] : [] }) ? 'deterministic' : undefined,
      metadata
    });
  });
}

function normalizeItemSlot(item, itemDefinition, request) {
  const data = itemDefinition?.data || {};
  return removeUndefined({
    sourceKind: 'item',
    slotId: request.slotId || request.itemId || item?.id || data.id,
    itemId: request.itemId || item?.id || item?.itemId || data.id,
    itemKind: request.itemKind || itemDefinition?.kind,
    name: item?.name || data.name || request.itemId,
    quantity: item?.quantity,
    equipped: item?.equipped,
    description: item?.description || data.description || data.mechanicalEffect,
    metadata: {
      ...normalizeObject(data.metadata),
      ...normalizeObject(item?.metadata)
    }
  });
}

function skillSlotFromChoice(choice = {}) {
  return removeUndefined({
    sourceKind: 'skill',
    slotId: choice.actionId || choice.id,
    skillId: choice.mechanic?.kind === 'skill' ? choice.mechanic.id : undefined,
    actionId: choice.actionId || choice.id,
    name: choice.name || choice.actionId,
    description: choice.description,
    actionKind: choice.actionKind,
    mode: choice.mode,
    targetPolicy: choice.targetPolicy,
    requiresTarget: choice.requiresTarget,
    defaultTargetId: choice.defaultTargetId,
    consumeAction: choice.consumeAction,
    mechanic: choice.mechanic,
    metadata: normalizeObject(choice.metadata)
  });
}

function compactSkillChoice(choice = {}) {
  return removeUndefined({
    actionId: choice.actionId,
    name: choice.name,
    actionKind: choice.actionKind,
    targetPolicy: choice.targetPolicy,
    requiresTarget: choice.requiresTarget,
    ready: choice.ready
  });
}

function collectExecutionConfig(request, slot = {}, definition = {}) {
  const metadata = mergePlainObjects(
    normalizeObject(definition.metadata),
    normalizeObject(slot.metadata),
    normalizeObject(request.metadata)
  );
  const specialHandling = mergePlainObjects(
    normalizeObject(definition.specialHandling),
    normalizeObject(metadata.specialHandling),
    normalizeObject(request.specialHandling)
  );
  const executionMode = normalizeExecutionMode(
    request.executionMode
    || metadata.executionMode
    || specialHandling.executionMode
    || (request.directUseAllowed === false || metadata.directUseAllowed === false ? 'adjudicated' : '')
  );
  return {
    ...metadata,
    specialHandling,
    executionMode,
    directUseAllowed: request.directUseAllowed ?? metadata.directUseAllowed,
    requiresAdjudication: request.requiresAdjudication ?? metadata.requiresAdjudication ?? specialHandling.requiresAdjudication,
    specialText: normalizeOptionalText(request.specialText || metadata.specialText || specialHandling.text || definition.specialText),
    adjudicationTool: normalizeOptionalText(request.adjudicationTool || specialHandling.routeTo || metadata.routeTo),
    targetPolicy: request.targetPolicy || metadata.targetPolicy || metadata.targetMode || specialHandling.targetPolicy,
    consumeItem: metadata.consumeItem,
    consumeQuantity: request.consumeQuantity ?? metadata.consumeQuantity,
    slot: metadata.slot || definition.slot
  };
}

function buildItemUseEffects(request, slot, definition = {}) {
  const metadata = mergePlainObjects(normalizeObject(definition.metadata), normalizeObject(slot.metadata));
  const raw = mergePlainObjects(
    extractUseEffects(definition),
    extractUseEffects(metadata),
    extractUseEffects(slot),
    normalizeObject(request.effects),
    normalizeObject(request.useEffects),
    extractInlineEffects(request)
  );
  const directBuff = buildDirectBuffEffect(mergePlainObjects(metadata, raw), {
    id: slot.itemId || slot.slotId,
    name: slot.name,
    sourceKind: 'item'
  });
  return removeUndefined({
    ...raw,
    damage: raw.damage ?? raw.damages,
    healing: raw.healing ?? raw.heals,
    temporaryHp: raw.temporaryHp ?? raw.tempHp,
    statusEffects: [
      ...normalizeArray(raw.statusEffects || raw.statuses || raw.conditions),
      ...(directBuff ? [directBuff] : [])
    ],
    resourceChanges: raw.resourceChanges ?? raw.resources ?? raw.resourceEffects,
    resourceCosts: raw.resourceCosts ?? raw.costs,
    consume: raw.consume ?? raw.consumes ?? raw.consumable,
    consumeQuantity: request.consumeQuantity ?? raw.consumeQuantity ?? raw.quantity ?? raw.amount
  });
}

function extractUseEffects(value = {}) {
  const object = normalizeObject(value);
  return firstPlainObject(
    object.useEffects,
    object.effects,
    object.use,
    object.uses?.effects,
    object.uses,
    object.useRules,
    object.activation?.effects,
    object.activation
  ) || {};
}

function extractInlineEffects(input = {}) {
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

function buildDirectBuffEffect(data = {}, { id, name, sourceKind } = {}) {
  const buff = removeUndefined({
    acBonus: optionalNumber(data.acBonus ?? data.armorClassBonus ?? data.defenseBonus),
    attackBonus: optionalNumber(data.attackBonus ?? data.attackModifier ?? data.toHitBonus),
    checkBonus: optionalNumber(data.checkBonus ?? data.allCheckBonus),
    saveBonus: optionalNumber(data.saveBonus ?? data.savingThrowBonus),
    damageBonus: optionalNumber(data.damageBonus ?? data.damageModifier),
    incomingAttackDisadvantage: data.incomingAttackDisadvantage,
    incomingAttackAdvantage: data.incomingAttackAdvantage,
    rollMode: data.rollMode,
    attackRollMode: data.attackRollMode,
    resistances: data.resistances,
    vulnerabilities: data.vulnerabilities,
    immunities: data.immunities,
    abilityModifiers: data.abilityModifiers,
    skillModifiers: data.skillModifiers,
    saveModifiers: data.saveModifiers
  });
  const hasBuff = Object.keys(buff).some((key) => buff[key] !== undefined && buff[key] !== false && !(Array.isArray(buff[key]) && !buff[key].length));
  if (!hasBuff) return undefined;
  const duration = optionalNumber(data.remainingTurns ?? data.durationRounds ?? data.rounds ?? data.duration);
  const statusId = safeSegment(data.statusId || data.buffId || `${id || name || sourceKind}_buff`);
  return {
    id: statusId,
    name: data.statusName || name || statusId,
    active: true,
    remainingTurns: duration ?? 1,
    source: `slot-use:${sourceKind || 'unknown'}`,
    description: data.description || data.mechanicalEffect || data.specialText,
    metadata: removeUndefined({
      ...buff,
      durationTiming: data.durationTiming || data.expiresAtTiming || 'endTurn',
      expiresOnActorId: data.expiresOnActorId,
      sourceKind
    })
  };
}

function hasUseEffects(effects = {}) {
  return Boolean(normalizeArray(effects.damage ?? effects.damages).length
    || normalizeArray(effects.damageRolls ?? effects.damageDice).length
    || normalizeArray(effects.healing ?? effects.heals).length
    || normalizeArray(effects.healingRolls ?? effects.healingDice).length
    || effects.temporaryHp !== undefined
    || effects.tempHp !== undefined
    || normalizeArray(effects.statusEffects ?? effects.statuses ?? effects.conditions).length
    || normalizeArray(effects.resourceChanges ?? effects.resourceEffects).length
    || normalizeArray(effects.resourceCosts ?? effects.costs).length
    || effects.consume === true
    || effects.consumeQuantity !== undefined);
}

function hasSkillEffects(choice = {}) {
  return Boolean(normalizeArray(choice.damage).length
    || normalizeArray(choice.damageRolls).length
    || choice.healing !== undefined
    || choice.temporaryHp !== undefined
    || normalizeArray(choice.statusEffects).length
    || normalizeArray(choice.resourceCosts).length
    || choice.attack !== undefined
    || ['defense', 'dodge', 'healing', 'status', 'effect'].includes(choice.actionKind));
}

function buildSpecialAssessment(request, config, { sourceKind, sourceText, hasDeterministic } = {}) {
  const explicit = Boolean(config.requiresAdjudication || config.specialHandling?.requiresAdjudication);
  const executionMode = normalizeExecutionMode(config.executionMode || request.executionMode);
  const hasSpecialText = Boolean(config.specialText || request.specialText || config.specialHandling?.text);
  const needsAdjudication = explicit
    || ['adjudicated', 'llm', 'narrative', 'special'].includes(executionMode)
    || (hasSpecialText && config.directUseAllowed !== true)
    || !hasDeterministic;
  const text = normalizeOptionalText(request.sourceText || config.specialText || sourceText);
  const tool = normalizeOptionalText(config.adjudicationTool)
    || (request.battleId ? 'system.combat.judge_special_action' : 'system.action.resolve');
  return {
    hasSpecialText,
    needsAdjudication,
    hasDeterministic,
    executionMode,
    adjudicationToolCall: needsAdjudication
      ? {
        tool,
        input: removeUndefined({
          chatSessionId: request.chatSessionId,
          sceneId: request.sceneId,
          battleId: request.battleId,
          actorId: request.actorId,
          targetId: request.targetId,
          targetIds: request.targetIds,
          sourceText: text || `${sourceKind} special use`,
          useLlm: request.useLlm === true,
          metadata: {
            ...normalizeObject(request.metadata),
            slotUse: true,
            sourceKind,
            specialHandling: true
          }
        })
      }
      : undefined
  };
}

function chooseRoute(config, hasDeterministic, special) {
  const mode = normalizeExecutionMode(config.executionMode);
  if (mode === 'deterministic') return 'deterministic';
  if (mode === 'hybrid') return hasDeterministic ? 'hybrid' : 'adjudicated';
  if (['adjudicated', 'llm', 'narrative', 'special'].includes(mode)) return hasDeterministic && config.directUseAllowed === true ? 'hybrid' : 'adjudicated';
  if (special.needsAdjudication && hasDeterministic) return 'hybrid';
  if (special.needsAdjudication) return 'adjudicated';
  return hasDeterministic ? 'deterministic' : 'adjudicated';
}

function resolveTargetPolicy(request, config, effects = {}, { sourceKind } = {}) {
  const explicit = normalizeOptionalText(request.targetPolicy || config.targetPolicy);
  if (explicit) return explicit;
  if (sourceKind === 'skill' && effects.targetPolicy) return effects.targetPolicy;
  const hasDamage = normalizeArray(effects.damage ?? effects.damages).length || normalizeArray(effects.damageRolls ?? effects.damageDice).length;
  const hasBeneficial = normalizeArray(effects.healing ?? effects.heals).length
    || effects.temporaryHp !== undefined
    || effects.tempHp !== undefined
    || normalizeArray(effects.statusEffects ?? effects.statuses ?? effects.conditions).length;
  if (hasDamage) return 'singleEnemy';
  if (hasBeneficial) return 'self';
  return 'noTarget';
}

function resolveTargetIds(request, targetPolicy, actor, defaultTargetId) {
  const supplied = normalizeStringArray(request.targetIds || request.targetId || request.targetNpcId);
  if (supplied.length) return supplied;
  if (isSelfTargetPolicy(targetPolicy)) return [actor.npcId || actor.actorId || request.actorId].filter(Boolean);
  if (defaultTargetId && isSelfTargetPolicy(targetPolicy)) return [defaultTargetId];
  if (defaultTargetId && !needsTarget(targetPolicy)) return [defaultTargetId];
  return [];
}

function firstTargetId(request) {
  return normalizeStringArray(request.targetIds || request.targetId || request.targetNpcId)[0] || '';
}

function needsTarget(targetPolicy) {
  const normalized = normalizeKey(targetPolicy);
  return ['singleally', 'singleenemy', 'singleactor', 'multipleactors', 'sceneobject', 'maplocation', 'target'].includes(normalized);
}

function isSelfTargetPolicy(targetPolicy) {
  return ['self', 'actor', 'caster', 'user', 'owner', '自己', '自身'].includes(normalizeKey(targetPolicy));
}

function filterCandidatesByPolicy(candidates, targetPolicy, actor) {
  if (isSelfTargetPolicy(targetPolicy)) {
    const selfId = actor.npcId || actor.actorId;
    return candidates.filter((candidate) => candidate.actorId === selfId);
  }
  return candidates;
}

function findInventoryItem(items = [], request = {}) {
  const id = normalizeKey(request.itemId || request.slotId || request.id);
  const name = normalizeKey(request.itemName || request.name);
  return normalizeArray(items).find((item) => {
    const itemId = normalizeKey(item.id || item.itemId || item.sourceItemId);
    const itemName = normalizeKey(item.name);
    return (id && itemId === id) || (name && itemName === name);
  });
}

function findListedMechanic(mechanics = [], selected = {}) {
  const mechanicId = selected.mechanic?.id;
  const kind = selected.mechanic?.kind;
  return normalizeArray(mechanics).find((entry) => (!kind || entry.kind === kind) && entry.id === mechanicId);
}

function matchesSlotId(choice = {}, selectedId) {
  const id = normalizeOptionalText(selectedId);
  return [choice.actionId, choice.id, choice.skillId, choice.mechanic?.id].some((value) => normalizeOptionalText(value) === id);
}

function registryGetToolName(kind) {
  if (kind === 'equipment') return 'system.item_registry.get_equipment';
  if (kind === 'accessory') return 'system.item_registry.get_accessory';
  if (kind === 'weapon') return 'system.item_registry.get_weapon';
  if (kind === 'mount') return 'system.item_registry.get_mount';
  if (kind === 'special_item') return 'system.item_registry.get_special_item';
  return 'system.item_registry.get_item';
}

function normalizeRegistryKind(value) {
  const normalized = normalizeKey(value);
  if (['equipment', 'equip', 'armor'].includes(normalized)) return 'equipment';
  if (['accessory', 'accessories', '饰品'].includes(normalized)) return 'accessory';
  if (['weapon', 'weapons', '武器'].includes(normalized)) return 'weapon';
  if (['mount', 'mounts', '坐骑'].includes(normalized)) return 'mount';
  if (['special', 'specialitem', 'special_item', '特殊道具'].includes(normalized)) return 'special_item';
  if (['item', 'items', '物品'].includes(normalized)) return 'item';
  return '';
}

function isItemKind(value) {
  return ['item', 'inventory', 'bag', 'backpack', 'equipment', 'weapon', 'accessory', 'mount', 'specialitem', 'special_item', '物品', '背包'].includes(normalizeKey(value));
}

function isSkillKind(value) {
  return ['skill', 'spell', 'ability', 'action', 'feat', 'status', '技能', '法术'].includes(normalizeKey(value));
}

function isEquipMode(value) {
  return ['equip', 'equip_item', '装备'].includes(normalizeKey(value));
}

function normalizeExecutionMode(value) {
  const normalized = normalizeKey(value);
  if (['direct', 'deterministic', 'numeric', 'nollm', 'no_llm'].includes(normalized)) return 'deterministic';
  if (['adjudicated', 'adjudication', 'llm', 'narrative', 'special'].includes(normalized)) return 'adjudicated';
  if (['hybrid', 'mixed'].includes(normalized)) return 'hybrid';
  if (['disabled', 'blocked'].includes(normalized)) return 'disabled';
  return normalized;
}

function compactActor(record = {}) {
  const data = record.data || record || {};
  return removeUndefined({
    actorId: data.npcId || data.actorId,
    name: data.name,
    actorType: data.actorType,
    isPlayer: data.isPlayer,
    sceneId: data.sceneId,
    values: data.values,
    statusBar: data.statusBar
  });
}

function blockedPlan(reason, request, actor, extra = {}) {
  return {
    ok: false,
    status: 'blocked',
    reason,
    llmUsed: false,
    dryRun: request.dryRun,
    request,
    actor: compactActor(actor),
    ...extra
  };
}

async function safeExecuteTool(toolManager, tool, input, context) {
  try {
    const result = await toolManager.executeTool(tool, removeUndefined(input), undefined, context);
    return { ok: true, output: result.output, trace: result.trace };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function firstPlainObject(...values) {
  return values.find((value) => isPlainObject(value)) || undefined;
}

function mergePlainObjects(...values) {
  return Object.assign({}, ...values.filter(isPlainObject));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(normalizeStringArray);
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeRequiredText(value, name) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError(`${name} is required`);
  return text;
}

function normalizeKey(value) {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff.-]+/g, '');
}

function safeSegment(value) {
  return normalizeOptionalText(value).replace(/[^A-Za-z0-9_.:-]+/g, '_') || 'slot_use';
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== ''));
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    details: error?.details
  };
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'SlotUseResolverError';
  error.statusCode = 400;
  return error;
}
