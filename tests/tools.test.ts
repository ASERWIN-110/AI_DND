// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextualChatProvider,
  ToolPluginManager,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

const samplePlugin = {
  id: 'campaign.notes',
  name: 'Campaign Notes',
  version: '0.1.0',
  tools: [
    {
      name: 'add_note',
      description: 'Add a note to the campaign log.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 }
        },
        required: ['text'],
        additionalProperties: false
      },
      mutatesState: true
    }
  ]
};

test('tool plugin manager supports plugin CRUD', () => {
  const manager = new ToolPluginManager();

  const created = manager.createPlugin(samplePlugin);
  assert.equal(created.id, 'campaign.notes');
  assert.equal(manager.listPlugins().length, 1);

  const updated = manager.updatePlugin('campaign.notes', {
    description: 'Updated description.',
    enabled: false
  });
  assert.equal(updated.description, 'Updated description.');
  assert.equal(manager.listTools({ includeDisabled: false }).length, 0);
  assert.equal(manager.listTools({ includeDisabled: true }).length, 1);

  const deleted = manager.deletePlugin('campaign.notes');
  assert.equal(deleted.id, 'campaign.notes');
  assert.equal(manager.listPlugins().length, 0);
});

test('tool plugin manager supports tool CRUD', () => {
  const manager = new ToolPluginManager();
  manager.createPlugin({ id: 'test.tools', name: 'Test Tools' });

  const created = manager.createTool('test.tools', {
    name: 'ping',
    description: 'Ping tool.'
  });
  assert.equal(created.id, 'test.tools.ping');

  const updated = manager.updateTool('test.tools', 'ping', {
    name: 'pong',
    description: 'Pong tool.'
  });
  assert.equal(updated.id, 'test.tools.pong');
  assert.equal(updated.description, 'Pong tool.');

  const deleted = manager.deleteTool('test.tools', 'pong');
  assert.equal(deleted.name, 'pong');
  assert.equal(manager.listTools({ includeDisabled: true }).length, 0);
});

test('tool execution validates input schema and runs handler', async () => {
  const manager = new ToolPluginManager();
  manager.createPlugin(samplePlugin, {
    handlers: {
      add_note: async ({ input }) => ({ saved: true, text: input.text })
    }
  });

  const result = await manager.executeTool('campaign.notes.add_note', {
    text: 'The tower door is locked.'
  });
  assert.deepEqual(result.output, {
    saved: true,
    text: 'The tower door is locked.'
  });

  await assert.rejects(
    () => manager.executeTool('campaign.notes.add_note', { text: '' }),
    /Invalid input/
  );
});

test('tool execution writes explicit input and output trace files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-tool-traces-'));
  try {
    const manager = new ToolPluginManager({
      trace: {
        directory
      }
    });
    manager.createPlugin(samplePlugin, {
      handlers: {
        add_note: async ({ input }) => ({ saved: true, text: input.text })
      }
    });

    const result = await manager.executeTool('campaign.notes.add_note', {
      text: 'Trace this call.'
    }, undefined, {
      apiKey: 'secret-key'
    });

    assert.equal(existsSync(result.trace.files.tool), true);
    assert.equal(existsSync(result.trace.files.input), true);
    assert.equal(existsSync(result.trace.files.output), true);
    assert.equal(existsSync(result.trace.files.summary), true);

    const inputTrace = JSON.parse(readFileSync(result.trace.files.input, 'utf8'));
    const outputTrace = JSON.parse(readFileSync(result.trace.files.output, 'utf8'));
    assert.equal(inputTrace.toolId, 'campaign.notes.add_note');
    assert.equal(inputTrace.input.text, 'Trace this call.');
    assert.equal(inputTrace.context.apiKey, '[REDACTED]');
    assert.equal(outputTrace.output.saved, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('tool execution writes error trace files for invalid calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-tool-error-traces-'));
  try {
    const manager = new ToolPluginManager({
      trace: {
        directory
      }
    });
    manager.createPlugin(samplePlugin, {
      handlers: {
        add_note: async ({ input }) => ({ saved: true, text: input.text })
      }
    });

    await assert.rejects(
      () => manager.executeTool('campaign.notes.add_note', { text: '' }),
      /Invalid input/
    );

    const dayDirectories = readdirSync(directory);
    assert.equal(dayDirectories.length, 1);
    const traceDirectories = readdirSync(join(directory, dayDirectories[0]));
    assert.equal(traceDirectories.length, 1);
    const traceDirectory = join(directory, dayDirectories[0], traceDirectories[0]);
    assert.equal(existsSync(join(traceDirectory, 'input.json')), true);
    assert.equal(existsSync(join(traceDirectory, 'error.json')), true);

    const errorTrace = JSON.parse(readFileSync(join(traceDirectory, 'error.json'), 'utf8'));
    assert.match(errorTrace.error.message, /Invalid input/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default manager exposes core echo tool', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({ dataManager });
  const tool = manager.getTool('core.utility.echo');
  assert.equal(tool.enabled, true);

  const result = await manager.executeTool('core.utility.echo', {
    text: 'hello'
  });
  assert.deepEqual(result.output, { text: 'hello' });
  dataManager.close();
});

test('default manager exposes dice check tool', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({ dataManager });
  const tool = manager.getTool('game.dice.check');
  assert.equal(tool.enabled, true);
  assert.equal(tool.autoCallable, true);

  const result = await manager.executeTool('game.dice.check', {
    successThreshold: 10,
    diceCount: 1,
    diceSides: 20,
    forceMode: 'success'
  });

  assert.equal(result.output.outcome, 'success');
  assert.equal(result.output.forced, true);
  dataManager.close();
});

test('imports OpenAI Chat and Claude style tools into canonical descriptors', () => {
  const manager = new ToolPluginManager();
  manager.createPlugin({
    id: 'weather.tools',
    name: 'Weather Tools',
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather by city.',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' }
            },
            required: ['city'],
            additionalProperties: false
          },
          strict: true
        }
      },
      {
        name: 'get_forecast',
        description: 'Get forecast by city.',
        input_schema: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            days: { type: 'integer' }
          },
          required: ['city'],
          additionalProperties: false
        }
      }
    ]
  });

  const weather = manager.getTool('weather.tools.get_weather');
  assert.equal(weather.inputSchema.properties.city.type, 'string');
  assert.equal(weather.strict, true);

  const forecast = manager.getTool('weather.tools.get_forecast');
  assert.equal(forecast.inputSchema.properties.days.type, 'integer');
});

test('exports tools in agent, claude, and openai formats', () => {
  const manager = new ToolPluginManager();
  manager.createPlugin(samplePlugin);

  const [mcpTool] = manager.toMcpTools();
  assert.equal(mcpTool.name, 'campaign_notes_add_note');
  assert.ok(mcpTool.inputSchema);
  assert.equal(mcpTool._meta['ai-dnd/toolId'], 'campaign.notes.add_note');

  const [claudeTool] = manager.toClaudeTools();
  assert.equal(claudeTool.name, 'campaign_notes_add_note');
  assert.ok(claudeTool.input_schema);

  const [responsesTool] = manager.toOpenAIResponsesTools();
  assert.equal(responsesTool.type, 'function');
  assert.equal(responsesTool.name, 'campaign_notes_add_note');
  assert.ok(responsesTool.parameters);

  const [chatTool] = manager.toOpenAIChatTools();
  assert.equal(chatTool.type, 'function');
  assert.equal(chatTool.function.name, 'campaign_notes_add_note');
  assert.ok(chatTool.function.parameters);
});

test('executes a tool by provider exported name', async () => {
  const manager = new ToolPluginManager();
  manager.createPlugin(samplePlugin, {
    handlers: {
      add_note: async ({ input }) => ({ saved: true, text: input.text })
    }
  });

  const result = await manager.executeTool('campaign_notes_add_note', {
    text: 'Called through provider name.'
  });

  assert.equal(result.toolId, 'campaign.notes.add_note');
  assert.deepEqual(result.output, {
    saved: true,
    text: 'Called through provider name.'
  });
});

test('contextual chat provider uses tool execution api override', async () => {
  const defaultProvider = {
    generate: async () => ({ content: 'default' })
  };
  const overrideProvider = {
    generate: async ({ temperature, maxTokens }) => ({
      content: `override:${temperature}:${maxTokens}`
    })
  };
  const contextualProvider = new ContextualChatProvider({
    defaultProvider,
    resolveProvider: ({ api }) => api.provider === 'override'
      ? overrideProvider
      : defaultProvider
  });
  const manager = new ToolPluginManager();
  manager.createPlugin({
    id: 'test.llm',
    name: 'Test LLM Tools',
    tools: [
      {
        name: 'generate',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    ]
  }, {
    handlers: {
      generate: async () => contextualProvider.generate({ messages: [] })
    }
  });

  const fallback = await manager.executeTool('test.llm.generate', {});
  assert.equal(fallback.output.content, 'default');

  const overridden = await manager.executeTool('test.llm.generate', {}, undefined, {
    api: {
      provider: 'override',
      temperature: '0.2',
      maxTokens: '12'
    }
  });
  assert.equal(overridden.output.content, 'override:0.2:12');
});

test('contextual chat provider applies tool prompt overrides', async () => {
  const captured = [];
  const defaultProvider = {
    generate: async (request) => {
      captured.push(request);
      return { content: 'ok' };
    }
  };
  const contextualProvider = new ContextualChatProvider({
    defaultProvider,
    resolveProvider: () => defaultProvider
  });
  const manager = new ToolPluginManager();
  manager.createPlugin({
    id: 'test.llm',
    name: 'Test LLM Tools',
    tools: [
      {
        name: 'generate',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        tags: ['llm']
      }
    ]
  }, {
    handlers: {
      generate: async () => contextualProvider.generate({
        messages: [
          { role: 'system', content: 'base system' },
          { role: 'user', content: 'base prompt' }
        ]
      })
    }
  });

  await manager.executeTool('test.llm.generate', {}, undefined, {
    llmPromptOverrides: {
      'test.llm.generate': {
        enabled: true,
        mode: 'inject',
        systemPrompt: 'managed system',
        promptPrefix: 'managed prefix',
        promptSuffix: 'managed suffix',
        references: 'managed reference'
      }
    }
  });
  assert.equal(captured[0].messages[0].role, 'system');
  assert.match(captured[0].messages.map((message) => message.content).join('\n'), /managed system/);
  assert.match(captured[0].messages.map((message) => message.content).join('\n'), /managed reference/);
  assert.match(captured[0].messages.at(-1).content, /managed prefix\n\nbase prompt\n\nmanaged suffix/);

  await manager.executeTool('test.llm.generate', {}, undefined, {
    llm: {
      promptOverrides: {
        'test.llm.generate': {
          enabled: true,
          mode: 'replace',
          replacementPrompt: 'replacement prompt'
        }
      }
    }
  });
  assert.equal(captured[1].messages.at(-1).content, 'replacement prompt');
});

test('tool plugin manager enforces agent database and rag access policy', async () => {
  const manager = new ToolPluginManager();
  manager.createPlugin({
    id: 'test.storage',
    name: 'Storage Tools',
    permissions: ['database:read', 'database:write', 'rag-runtime:read', 'rag-runtime:write'],
    tools: [
      {
        name: 'write_db',
        description: 'Patch one SQLite database record.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        mutatesState: true,
        tags: ['database', 'write']
      },
      {
        name: 'search_rag',
        description: 'Search runtime RAG memory.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        mutatesState: false,
        tags: ['rag', 'search']
      },
      {
        name: 'search_permanent_rag',
        description: 'Search permanent RAG character lore.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        mutatesState: false,
        tags: ['rag', 'permanent', 'search']
      }
    ]
  }, {
    handlers: {
      write_db: async () => ({ ok: true }),
      search_rag: async () => ({ ok: true }),
      search_permanent_rag: async () => ({ ok: true })
    }
  });
  manager.createPlugin({
    id: 'system.npc_profiles',
    name: 'NPC Profile Database Tools',
    permissions: ['npc-profiles:read', 'npc-profiles:write'],
    tools: [
      {
        name: 'get_profile_bundle',
        description: 'Get all requested L1/L2/L3 profiles for one NPC.',
        inputSchema: {
          type: 'object',
          properties: {
            npcId: { type: 'string' },
            levels: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['npcId'],
          additionalProperties: false
        },
        mutatesState: false,
        tags: ['npc', 'profile', 'query']
      },
      {
        name: 'upsert_profile',
        description: 'Create or replace one L1/L2/L3 NPC profile.',
        inputSchema: {
          type: 'object',
          properties: {
            npcId: { type: 'string' },
            level: { type: 'string' },
            summary: { type: 'string' }
          },
          required: ['npcId', 'level'],
          additionalProperties: false
        },
        mutatesState: true,
        tags: ['npc', 'profile', 'write']
      }
    ]
  }, {
    handlers: {
      get_profile_bundle: async () => ({ ok: true }),
      upsert_profile: async () => ({ ok: true })
    }
  });

  await assert.rejects(
    () => manager.executeTool('test.storage.write_db', {}, undefined, {
      agentAccessPolicy: { database: { read: true, write: false }, rag: { read: true, write: true } }
    }),
    /blocks database write/
  );
  await assert.rejects(
    () => manager.executeTool('test.storage.search_rag', {}, undefined, {
      agentAccessPolicy: { database: { read: true, write: true }, rag: { read: false, write: true } }
    }),
    /blocks rag read/
  );
  await assert.rejects(
    () => manager.executeTool('test.storage.search_permanent_rag', {}, undefined, {
      agentAccessPolicy: {
        database: { read: true, write: true },
        rag: { read: true, write: true },
        permanentRag: { read: false, write: true }
      }
    }),
    /blocks permanentRag read/
  );
  await assert.rejects(
    () => manager.executeTool('system.npc_profiles.get_profile_bundle', {
      npcId: 'mira',
      levels: ['L3']
    }, undefined, {
      agentAccessPolicy: {
        database: { read: true, write: true },
        databaseL3: { read: false, write: true },
        rag: { read: true, write: true }
      }
    }),
    /blocks databaseL3 read/
  );
  const l1Allowed = await manager.executeTool('system.npc_profiles.get_profile_bundle', {
    npcId: 'mira',
    levels: ['L1']
  }, undefined, {
    agentAccessPolicy: {
      database: { read: true, write: true },
      databaseL3: { read: false, write: true },
      rag: { read: true, write: true }
    }
  });
  assert.equal(l1Allowed.output.ok, true);

  const allowed = await manager.executeTool('test.storage.write_db', {}, undefined, {
    agentAccessPolicy: {
      database: { read: true, write: false },
      rag: { read: true, write: true },
      tools: { 'test.storage.write_db': 'allowed' }
    }
  });
  assert.equal(allowed.output.ok, true);
});
