// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  TIME_PLUGIN,
  TimeTurnManager,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createTimeHandlers
} from '../src/index.js';

function createTestChat(options = {}) {
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: options.chatDataDirectory
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Test GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Time Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('time manager starts encounters, advances turns, ticks effects, and resolves due events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-time-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const time = new TimeTurnManager({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const started = time.startEncounter({
      chatSessionId: chat.id,
      encounterId: 'ambush',
      sceneId: 'gate',
      name: 'Gate Ambush',
      participants: [
        { participantId: 'pc', name: 'Player', actorType: 'player', initiative: 12, dexterityModifier: 2 },
        { participantId: 'guard', name: 'Guard', actorType: 'npc', initiative: 12, dexterityModifier: 1 },
        { participantId: 'wolf', name: 'Wolf', actorType: 'monster', initiative: 15, dexterityModifier: 3 }
      ]
    });

    assert.equal(started.encounter.data.currentParticipantId, 'wolf');
    assert.deepEqual(started.turnOrder.map((record) => record.data.participantId), ['wolf', 'pc', 'guard']);
    assert.equal(existsSync(started.trace.files.input), true);

    const effect = time.addEffect({
      chatSessionId: chat.id,
      encounterId: 'ambush',
      effectId: 'bless',
      name: 'Bless',
      targetParticipantId: 'pc',
      durationType: 'rounds',
      remainingRounds: 1,
      tickTiming: 'endRound'
    });
    assert.equal(effect.data.remainingRounds, 1);

    const event = time.scheduleEvent({
      chatSessionId: chat.id,
      encounterId: 'ambush',
      eventId: 'reinforcement',
      title: 'Reinforcement',
      afterRounds: 1
    });
    assert.equal(event.data.dueRound, 2);

    const first = time.nextTurn({
      chatSessionId: chat.id,
      encounterId: 'ambush'
    });
    assert.equal(first.currentParticipantId, 'pc');
    assert.equal(first.roundAdvanced, false);

    const second = time.nextTurn({
      chatSessionId: chat.id,
      encounterId: 'ambush'
    });
    assert.equal(second.currentParticipantId, 'guard');

    const third = time.nextTurn({
      chatSessionId: chat.id,
      encounterId: 'ambush'
    });
    assert.equal(third.currentParticipantId, 'wolf');
    assert.equal(third.roundAdvanced, true);
    assert.equal(third.encounter.data.roundNumber, 2);
    assert.equal(third.tickedEffects[0].data.status, 'expired');
    assert.equal(third.dueEvents[0].data.eventId, 'reinforcement');

    const resolved = time.resolveDueEvents({
      chatSessionId: chat.id,
      markResolved: true
    });
    assert.equal(resolved.count, 1);
    assert.equal(resolved.events[0].data.status, 'resolved');

    const described = time.describe(chat.id);
    assert.ok(described.collections.time_clocks.formatFile.endsWith('time_clocks.schema.json'));
    assert.equal(existsSync(described.collections.time_clocks.formatFile), true);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('time tools support chat-scoped CRUD, import, and export', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-time-tools-'));
  const { appDatabase, chat } = createTestChat();
  const time = new TimeTurnManager({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(TIME_PLUGIN, {
    handlers: createTimeHandlers({ manager: time })
  });

  try {
    const started = await manager.executeTool('system.time.start_encounter', {
      chatSessionId: chat.id,
      encounterId: 'duel',
      sceneId: 'arena',
      participants: [
        { participantId: 'pc', name: 'Player', actorType: 'player', initiative: 11 },
        { participantId: 'rival', name: 'Rival', actorType: 'npc', initiative: 13 }
      ]
    });
    assert.equal(started.output.encounter.data.currentParticipantId, 'rival');

    const set = await manager.executeTool('system.time.set_initiative', {
      chatSessionId: chat.id,
      encounterId: 'duel',
      participantId: 'pc',
      initiative: 20
    });
    assert.equal(set.output.turnOrder[0].data.participantId, 'pc');

    const advanced = await manager.executeTool('system.time.advance_time', {
      chatSessionId: chat.id,
      minutes: 10
    });
    assert.equal(advanced.output.deltaSeconds, 600);

    const exported = await manager.executeTool('system.time.export_timeline', {
      chatSessionId: chat.id,
      format: 'yaml'
    });
    assert.match(exported.output.text, /turnOrder:/);

    const imported = await manager.executeTool('system.time.import_timeline', {
      chatSessionId: chat.id,
      format: 'yaml',
      text: [
        'events:',
        '  - eventId: bell',
        '    title: Bell Rings',
        '    status: scheduled',
        '    dueElapsedSeconds: 600'
      ].join('\n')
    });
    assert.equal(imported.output.count, 1);

    const due = await manager.executeTool('system.time.resolve_due_events', {
      chatSessionId: chat.id
    });
    assert.equal(due.output.events[0].data.eventId, 'bell');
    assert.equal(due.output.events[0].data.status, 'due');
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('time interpreter uses rules first and only calls LLM when enabled', async () => {
  const { appDatabase, chat } = createTestChat();
  const calls = [];
  const fakeProvider = {
    async generate({ messages }) {
      calls.push(messages);
      return {
        content: JSON.stringify({
          action: 'advance_time',
          confidence: 0.82,
          needsConfirmation: false,
          reason: 'LLM judged the scene description as a two-minute negotiation.',
          seconds: 120
        }),
        raw: { provider: 'fake' }
      };
    }
  };
  const time = new TimeTurnManager({
    appDatabase,
    chatProvider: fakeProvider,
    trace: false
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(TIME_PLUGIN, {
    handlers: createTimeHandlers({ manager: time })
  });

  try {
    await manager.executeTool('system.time.start_encounter', {
      chatSessionId: chat.id,
      encounterId: 'turn_rules',
      participants: [
        { participantId: 'pc', initiative: 10 },
        { participantId: 'guard', initiative: 8 }
      ]
    });

    const settings = await manager.executeTool('system.time.get_interpreter_settings', {
      chatSessionId: chat.id
    });
    assert.equal(settings.output.data.llmEnabled, 0);
    assert.equal(settings.output.data.timeEstimationEnabled, 0);

    const endTurn = await manager.executeTool('system.time.interpret_advance', {
      chatSessionId: chat.id,
      text: '我结束回合。'
    });
    assert.equal(endTurn.output.decision.action, 'next_turn');
    assert.equal(endTurn.output.decision.needsConfirmation, false);
    assert.equal(endTurn.output.llm.used, false);
    assert.equal(calls.length, 0);

    const search = await manager.executeTool('system.time.interpret_advance', {
      chatSessionId: chat.id,
      text: '我仔细搜索这个房间。'
    });
    assert.equal(search.output.decision.action, 'none');

    const explicit = await manager.executeTool('system.time.interpret_advance', {
      chatSessionId: chat.id,
      text: '我等待十分钟。'
    });
    assert.equal(explicit.output.decision.action, 'advance_time');
    assert.equal(explicit.output.decision.seconds, 600);

    await assert.rejects(
      () => manager.executeTool('system.time.set_interpreter_settings', {
        chatSessionId: chat.id,
        llmEnabled: true
      }),
      /requires explicit user authorization/
    );

    const enabled = await manager.executeTool('system.time.set_interpreter_settings', {
      chatSessionId: chat.id,
      llmEnabled: true,
      timeEstimationEnabled: true
    }, undefined, {
      authorization: true
    });
    assert.equal(enabled.output.settings.data.llmEnabled, 1);
    assert.equal(enabled.output.settings.data.timeEstimationEnabled, 1);

    const llm = await manager.executeTool('system.time.interpret_advance', {
      chatSessionId: chat.id,
      text: '我和商人周旋一阵，试着压低价格。',
      preferLlm: true
    });
    assert.equal(llm.output.llm.used, true);
    assert.equal(llm.output.decision.action, 'advance_time');
    assert.equal(llm.output.decision.seconds, 120);
    assert.equal(calls.length, 1);

    const prompt = await manager.executeTool('system.time.build_advance_prompt', {
      chatSessionId: chat.id,
      text: '我检查走廊尽头的门。'
    });
    assert.match(prompt.output.prompt, /Rule pack/);
    assert.match(prompt.output.prompt, /Output JSON schema reference/);
  } finally {
    appDatabase.close();
  }
});

test('world clock generates inspectable pulses and only schedules when requested', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-world-clock-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const time = new TimeTurnManager({
    appDatabase,
    random: () => 0,
    trace: {
      directory: join(directory, 'traces')
    }
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(TIME_PLUGIN, {
    handlers: createTimeHandlers({ manager: time })
  });

  try {
    await assert.rejects(
      () => manager.executeTool('system.time.set_world_clock', {
        chatSessionId: chat.id,
        intervalSeconds: 60
      }),
      /requires explicit user authorization/
    );

    const configured = await manager.executeTool('system.time.set_world_clock', {
      chatSessionId: chat.id,
      intervalSeconds: 60,
      npcActionChance: 1,
      factionActionChance: 1,
      disasterChance: 1,
      environmentEventChance: 0,
      randomEventChance: 0,
      maxEventsPerPulse: 3
    }, undefined, {
      authorization: true
    });
    assert.equal(configured.output.worldClock.data.nextPulseElapsedSeconds, 60);
    assert.equal(existsSync(configured.output.trace.files.input), true);

    const advanced = await manager.executeTool('system.time.advance_time', {
      chatSessionId: chat.id,
      minutes: 1
    });
    assert.equal(advanced.output.dueWorldClocks.length, 1);

    const pulseInput = {
      chatSessionId: chat.id,
      npcRefs: [{ id: 'guard_captain', name: 'Guard Captain' }],
      factionRefs: [{ id: 'city_watch', name: 'City Watch' }]
    };
    const dryRun = await manager.executeTool('system.time.run_world_pulse', {
      ...pulseInput,
      dryRun: true
    });
    assert.equal(dryRun.output.dryRun, true);
    assert.equal(dryRun.output.pulse.events.length, 3);
    assert.equal(dryRun.output.pulse.events[0].category, 'npc_action');
    assert.equal(dryRun.output.pulse.events[0].proposedToolCalls[0].tool, 'system.npc_behavior.resolve');

    const noEventsAfterDryRun = await manager.executeTool('system.time.list_events', {
      chatSessionId: chat.id,
      status: 'due',
      includeResolved: true
    });
    assert.equal(noEventsAfterDryRun.output.records.length, 0);

    const applied = await manager.executeTool('system.time.run_world_pulse', {
      ...pulseInput,
      dryRun: false
    });
    assert.equal(applied.output.scheduledEvents.length, 3);
    assert.equal(applied.output.worldClock.data.pulseCount, 1);
    assert.equal(applied.output.worldClock.data.nextPulseElapsedSeconds, 120);

    const dueEvents = await manager.executeTool('system.time.list_events', {
      chatSessionId: chat.id,
      status: 'due',
      includeResolved: true
    });
    assert.equal(dueEvents.output.records.length, 3);
    assert.equal(dueEvents.output.records[0].data.payload.kind, 'world_pulse_event');

    const prompt = await manager.executeTool('system.time.build_world_pulse_prompt', {
      chatSessionId: chat.id,
      contextText: 'Ash clouds gather over the pass.'
    });
    assert.match(prompt.output.prompt, /World pulse generation/);

    const exported = await manager.executeTool('system.time.export_timeline', {
      chatSessionId: chat.id,
      format: 'json'
    });
    assert.equal(exported.output.payload.worldClocks.length, 1);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default tool manager registers system.time when app database exists', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    trace: false
  });

  try {
    assert.equal(manager.getTool('system.time.get_clock').id, 'system.time.get_clock');
    const clock = await manager.executeTool('system.time.get_clock', {
      chatSessionId: chat.id
    });
    assert.equal(clock.output.data.phase, 'narrative');
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});
