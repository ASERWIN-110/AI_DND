// @ts-nocheck
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createMessage } from '../core/messages.js';
import { normalizeCharacterCard } from '../characters/character-card.js';
import { SQLiteDataManager, normalizeCollectionName } from '../data/sqlite-data-manager.js';
import { resolveResourceLifecycle } from '../lifecycle/resource-lifecycle.js';
import { createId, nowIso } from '../utils/id.js';
import { getDatabaseSync } from '../utils/node-sqlite.js';

let DatabaseSync;

export class AppDatabase {
  constructor({
    databasePath = 'data/app.sqlite',
    cwd = process.cwd(),
    now = nowIso,
    chatDataDirectory
  } = {}) {
    this.cwd = cwd;
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(cwd, databasePath);
    const defaultChatDataDirectory = databasePath === ':memory:' ? null : 'data/chat-databases';
    const resolvedChatDataDirectory = chatDataDirectory === undefined
      ? defaultChatDataDirectory
      : chatDataDirectory;
    this.chatDataDirectory = resolvedChatDataDirectory === null
      ? null
      : resolve(cwd, resolvedChatDataDirectory);
    this.now = now;
    this.chatDataManagers = new Map();

    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }
    if (this.chatDataDirectory) {
      mkdirSync(this.chatDataDirectory, { recursive: true });
    }

    DatabaseSync ||= getDatabaseSync();
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  close() {
    for (const manager of this.chatDataManagers.values()) {
      manager.close();
    }
    this.chatDataManagers.clear();
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS character_cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        spec TEXT NOT NULL,
        spec_version TEXT NOT NULL,
        current_revision_id TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        avatar_asset_id TEXT,
        source TEXT,
        source_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS character_card_revisions (
        id TEXT PRIMARY KEY,
        character_card_id TEXT NOT NULL REFERENCES character_cards(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(character_card_id, revision),
        UNIQUE(character_card_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        character_card_id TEXT NOT NULL REFERENCES character_cards(id) ON DELETE CASCADE,
        character_card_revision_id TEXT NOT NULL REFERENCES character_card_revisions(id),
        title TEXT NOT NULL,
        user_name TEXT NOT NULL,
        player_persona TEXT NOT NULL DEFAULT '',
        model_provider TEXT,
        model_name TEXT,
        prompt_preset_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        name TEXT,
        content TEXT NOT NULL,
        parts_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        token_count INTEGER,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_generations (
        id TEXT PRIMARY KEY,
        chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        assistant_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
        provider TEXT,
        model TEXT,
        prompt_snapshot_json TEXT,
        prompt_itemization_json TEXT,
        rag_context_json TEXT,
        world_info_json TEXT,
        usage_json TEXT,
        raw_response_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_data_schemas (
        character_card_id TEXT PRIMARY KEY REFERENCES character_cards(id) ON DELETE CASCADE,
        schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_data_databases (
        chat_session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
        character_card_id TEXT NOT NULL REFERENCES character_cards(id) ON DELETE CASCADE,
        database_path TEXT NOT NULL,
        schema_directory TEXT,
        schema_snapshot_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_chat_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
        character_card_id TEXT REFERENCES character_cards(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lifecycle_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        layer TEXT,
        collection TEXT,
        source_id TEXT,
        record_id TEXT,
        lifecycle_scope TEXT NOT NULL,
        lifecycle_level TEXT NOT NULL,
        character_card_id TEXT REFERENCES character_cards(id) ON DELETE CASCADE,
        chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
        lifecycle_inherited INTEGER NOT NULL DEFAULT 0,
        registered_by TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(resource_type, resource_id)
      );

      CREATE INDEX IF NOT EXISTS idx_character_cards_name ON character_cards(name);
      CREATE INDEX IF NOT EXISTS idx_character_cards_hash ON character_cards(source_hash);
      CREATE INDEX IF NOT EXISTS idx_character_revisions_card ON character_card_revisions(character_card_id, revision);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_card ON chat_sessions(character_card_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_order ON chat_messages(chat_session_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_chat_data_databases_card ON chat_data_databases(character_card_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_resources_chat ON lifecycle_resources(chat_session_id, lifecycle_scope);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_resources_character ON lifecycle_resources(character_card_id, lifecycle_scope);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_resources_ref ON lifecycle_resources(resource_type, collection, record_id, source_id);
    `);
  }

  importCharacterCard(characterCard, {
    characterCardId,
    source = 'import',
    notes = ''
  } = {}) {
    const card = normalizeCharacterCard(characterCard);
    const timestamp = this.now();
    const hash = stableHash(card);
    const cardId = characterCardId || createId('char');

    const existingRevision = this.db.prepare(`
      SELECT r.*, c.id AS card_id
      FROM character_card_revisions r
      JOIN character_cards c ON c.id = r.character_card_id
      WHERE r.content_hash = ?
      LIMIT 1
    `).get(hash);
    if (existingRevision && !characterCardId) {
      return this.getCharacterCard(existingRevision.card_id);
    }

    const existingCard = characterCardId
      ? this.db.prepare('SELECT id FROM character_cards WHERE id = ?').get(cardId)
      : undefined;
    if (characterCardId) {
      const existingCardRevision = this.db.prepare(`
        SELECT id
        FROM character_card_revisions
        WHERE character_card_id = ? AND content_hash = ?
        LIMIT 1
      `).get(cardId, hash);
      if (existingCardRevision) {
        this.db.prepare(`
          UPDATE character_cards
          SET current_revision_id = ?, updated_at = ?, archived_at = NULL
          WHERE id = ?
        `).run(existingCardRevision.id, timestamp, cardId);
        return this.getCharacterCard(cardId);
      }
    }

    const dataJson = JSON.stringify(card.data);
    const tagsJson = JSON.stringify(card.data.tags || []);
    const revision = existingCard ? this.getNextRevisionNumber(cardId) : 1;
    const revisionId = createId('charrev');

    if (!existingCard) {
      this.db.prepare(`
        INSERT INTO character_cards (
          id, name, spec, spec_version, current_revision_id, tags_json,
          avatar_asset_id, source, source_hash, created_at, updated_at, archived_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        cardId,
        card.data.name || 'Unnamed Character',
        card.spec,
        card.spec_version,
        revisionId,
        tagsJson,
        card.data.extensions?.avatar_asset_id ?? null,
        source,
        hash,
        timestamp,
        timestamp
      );
    }

    this.db.prepare(`
      INSERT INTO character_card_revisions (
        id, character_card_id, revision, data_json, content_hash, notes, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(revisionId, cardId, revision, dataJson, hash, notes, timestamp);

    this.db.prepare(`
      UPDATE character_cards
      SET name = ?, spec = ?, spec_version = ?, current_revision_id = ?,
          tags_json = ?, source = ?, source_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(
      card.data.name || 'Unnamed Character',
      card.spec,
      card.spec_version,
      revisionId,
      tagsJson,
      source,
      hash,
      timestamp,
      cardId
    );

    return this.getCharacterCard(cardId);
  }

  updateCharacterCard(characterCardId, characterCard, {
    source = 'update',
    notes = ''
  } = {}) {
    this.getCharacterCard(characterCardId);
    return this.importCharacterCard(characterCard, {
      characterCardId,
      source,
      notes
    });
  }

  patchCharacterCard(characterCardId, patch = {}, {
    source = 'patch',
    notes = ''
  } = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw validationError('character card patch must be a plain object');
    }
    const current = this.exportCharacterCard(characterCardId);
    const input = patch.characterCard || patch.card;
    if (input) {
      return this.updateCharacterCard(characterCardId, input, { source, notes });
    }

    const dataPatch = {
      ...(patch.data || {})
    };
    for (const key of [
      'name',
      'description',
      'personality',
      'scenario',
      'first_mes',
      'mes_example',
      'creator_notes',
      'system_prompt',
      'post_history_instructions',
      'tags'
    ]) {
      if (Object.hasOwn(patch, key)) {
        dataPatch[key] = patch[key];
      }
    }

    return this.updateCharacterCard(characterCardId, {
      spec: patch.spec || current.spec,
      spec_version: patch.spec_version || patch.specVersion || current.spec_version,
      data: {
        ...current.data,
        ...dataPatch
      }
    }, { source, notes });
  }

  listCharacterCards({ includeArchived = false } = {}) {
    const rows = this.db.prepare(`
      SELECT *
      FROM character_cards
      ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
      ORDER BY updated_at DESC
    `).all();
    return rows.map((row) => this.rowToCharacterCardSummary(row));
  }

  getCharacterCard(characterCardId) {
    const card = this.db.prepare('SELECT * FROM character_cards WHERE id = ?').get(characterCardId);
    if (!card) throw notFound(`Character card not found: ${characterCardId}`);

    const revisions = this.db.prepare(`
      SELECT *
      FROM character_card_revisions
      WHERE character_card_id = ?
      ORDER BY revision DESC
    `).all(characterCardId).map((row) => this.rowToRevision(row));

    const currentRevision = revisions.find((revision) => revision.id === card.current_revision_id) || revisions[0];
    return {
      ...this.rowToCharacterCardSummary(card),
      currentRevision,
      revisions
    };
  }

  exportCharacterCard(characterCardId, { revisionId } = {}) {
    const card = this.getCharacterCard(characterCardId);
    const revision = revisionId
      ? card.revisions.find((candidate) => candidate.id === revisionId)
      : card.currentRevision;
    if (!revision) throw notFound(`Character card revision not found: ${revisionId}`);

    return {
      spec: card.spec,
      spec_version: card.specVersion,
      data: revision.data
    };
  }

  archiveCharacterCard(characterCardId, {
    archiveChats = true
  } = {}) {
    const character = this.getCharacterCard(characterCardId);
    const timestamp = this.now();
    this.db.prepare(`
      UPDATE character_cards
      SET archived_at = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, characterCardId);

    if (archiveChats) {
      this.db.prepare(`
        UPDATE chat_sessions
        SET archived_at = ?, updated_at = ?
        WHERE character_card_id = ? AND archived_at IS NULL
      `).run(timestamp, timestamp, characterCardId);
    }

    const active = this.getActiveChatState();
    if (active?.characterCardId === characterCardId) {
      this.db.prepare('DELETE FROM active_chat_state WHERE id = 1').run();
    }

    return {
      archived: true,
      character,
      archiveChats: Boolean(archiveChats),
      archivedAt: timestamp
    };
  }

  restoreCharacterCard(characterCardId, {
    restoreChats = false
  } = {}) {
    const character = this.getCharacterCard(characterCardId);
    const timestamp = this.now();
    this.db.prepare(`
      UPDATE character_cards
      SET archived_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(timestamp, characterCardId);

    if (restoreChats) {
      this.db.prepare(`
        UPDATE chat_sessions
        SET archived_at = NULL, updated_at = ?
        WHERE character_card_id = ?
      `).run(timestamp, characterCardId);
    }

    return {
      restored: true,
      character,
      restoreChats: Boolean(restoreChats)
    };
  }

  deleteCharacterCard(characterCardId) {
    const character = this.getCharacterCard(characterCardId);
    const chats = this.listChatSessions({
      characterCardId,
      includeArchived: true
    });
    const deletedChats = [];
    for (const chat of chats) {
      deletedChats.push(this.deleteChatSession(chat.id));
    }
    const lifecycleResources = this.deleteLifecycleResourcesForCharacter(characterCardId);

    const active = this.getActiveChatState();
    if (active?.characterCardId === characterCardId) {
      this.db.prepare('DELETE FROM active_chat_state WHERE id = 1').run();
    }

    const result = this.db.prepare('DELETE FROM character_cards WHERE id = ?').run(characterCardId);
    return {
      deleted: result.changes > 0,
      character,
      deletedChats,
      lifecycleResources
    };
  }

  registerCharacterDataSchema(characterCardId, schema, {
    syncExisting = true,
    syncMode = 'merge'
  } = {}) {
    this.getCharacterCard(characterCardId);
    const normalized = normalizeChatDataSchema(schema);
    const timestamp = this.now();
    const existing = this.db.prepare(`
      SELECT character_card_id
      FROM character_data_schemas
      WHERE character_card_id = ?
    `).get(characterCardId);

    if (existing) {
      this.db.prepare(`
        UPDATE character_data_schemas
        SET schema_json = ?, updated_at = ?
        WHERE character_card_id = ?
      `).run(JSON.stringify(normalized), timestamp, characterCardId);
    } else {
      this.db.prepare(`
        INSERT INTO character_data_schemas (
          character_card_id, schema_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?)
      `).run(characterCardId, JSON.stringify(normalized), timestamp, timestamp);
    }

    if (syncExisting) {
      const chats = this.db.prepare(`
        SELECT id
        FROM chat_sessions
        WHERE character_card_id = ? AND archived_at IS NULL
      `).all(characterCardId);
      for (const chat of chats) {
        this.ensureChatDataDatabase(chat.id, { forceSync: true, syncMode });
      }
    }

    return this.getCharacterDataSchema(characterCardId);
  }

  getCharacterDataSchema(characterCardId, { missing = 'throw' } = {}) {
    this.getCharacterCard(characterCardId);
    const row = this.db.prepare(`
      SELECT *
      FROM character_data_schemas
      WHERE character_card_id = ?
    `).get(characterCardId);
    if (!row) {
      if (missing === 'undefined') return undefined;
      throw notFound(`Character data schema not found: ${characterCardId}`);
    }
    return this.rowToCharacterDataSchema(row);
  }

  unregisterCharacterDataSchema(characterCardId) {
    this.getCharacterCard(characterCardId);
    const result = this.db.prepare(`
      DELETE FROM character_data_schemas
      WHERE character_card_id = ?
    `).run(characterCardId);
    return {
      characterCardId,
      deleted: result.changes > 0
    };
  }

  exportInitialSetting(characterCardId, {
    includeLocations = true,
    includeChats = true,
    exportedAt
  } = {}) {
    const current = this.getInitialSetting(characterCardId);
    return removeUndefined({
      format: 'ai-dnd-initial-setting-v1',
      version: 1,
      exportedAt: exportedAt || this.now(),
      saved: Boolean(current.dataSchema),
      character: current.character,
      initialSetting: current.initialSetting,
      stats: current.stats,
      dataSchema: current.dataSchema ? {
        characterCardId: current.dataSchema.characterCardId,
        createdAt: current.dataSchema.createdAt,
        updatedAt: current.dataSchema.updatedAt
      } : undefined,
      locations: includeLocations ? current.locations : undefined,
      chats: includeChats ? current.chats : undefined
    });
  }

  exportAllInitialSettings({
    includeArchived = true,
    includeEmpty = false,
    includeLocations = true,
    includeChats = false
  } = {}) {
    const exportedAt = this.now();
    const savedRows = this.db.prepare(`
      SELECT character_card_id
      FROM character_data_schemas
    `).all();
    const savedCharacterIds = new Set(savedRows.map((row) => row.character_card_id));
    const characters = this.listCharacterCards({ includeArchived });
    const selectedCharacters = includeEmpty
      ? characters
      : characters.filter((character) => savedCharacterIds.has(character.id));
    const initialSettings = selectedCharacters.map((character) => this.exportInitialSetting(character.id, {
      includeLocations,
      includeChats,
      exportedAt
    }));

    return {
      format: 'ai-dnd-initial-settings-bundle-v1',
      version: 1,
      exportedAt,
      includeArchived: Boolean(includeArchived),
      includeEmpty: Boolean(includeEmpty),
      count: initialSettings.length,
      initialSettings
    };
  }

  deleteInitialSetting(characterCardId) {
    const character = this.getCharacterCard(characterCardId);
    const current = this.getCharacterDataSchema(characterCardId, { missing: 'undefined' });
    const previous = current
      ? this.exportInitialSetting(characterCardId, {
        includeLocations: true,
        includeChats: true
      })
      : undefined;
    const result = this.unregisterCharacterDataSchema(characterCardId);
    return removeUndefined({
      characterCardId,
      character: compactCharacterSummary(character),
      deleted: result.deleted,
      scope: 'character-data-schema',
      chatDataRetained: true,
      previous
    });
  }

  updateInitialSettingField(characterCardId, collectionName, fieldName, input = {}, {
    syncExisting = false,
    includeArchived = false,
    chatSessionIds
  } = {}) {
    const current = this.getCharacterDataSchema(characterCardId);
    const schema = normalizeInitialSettingSchema(current.schema);
    const collection = findInitialSettingCollection(schema, collectionName);
    const fromName = normalizeSchemaFieldName(fieldName);
    const fieldIndex = collection.fields.findIndex((field) => field.name === fromName);
    if (fieldIndex < 0) throw notFound(`Initial setting field not found: ${collection.name}.${fromName}`);

    const patch = input.field && typeof input.field === 'object' && !Array.isArray(input.field)
      ? input.field
      : input;
    const requestedName = patch.name || input.name || input.newName || input.to || fromName;
    const toName = normalizeSchemaFieldName(requestedName);
    if (toName !== fromName && collection.fields.some((field) => field.name === toName)) {
      throw validationError(`Initial setting field already exists: ${collection.name}.${toName}`);
    }

    const previousField = collection.fields[fieldIndex];
    const nextField = normalizeSchemaField({
      ...previousField,
      ...patch,
      name: toName
    });
    collection.fields[fieldIndex] = nextField;

    if (toName !== fromName) {
      for (const record of collection.seedRecords) {
        if (Object.hasOwn(record, fromName)) {
          if (!Object.hasOwn(record, toName)) record[toName] = record[fromName];
          delete record[fromName];
        }
      }
    }

    const nextSchema = normalizeInitialSettingSchema(schema);
    const dataSchema = this.registerCharacterDataSchema(characterCardId, nextSchema, {
      syncExisting: false
    });
    const syncedChats = syncExisting
      ? this.syncInitialSettingSchemaToChats(characterCardId, dataSchema.schema, {
        includeArchived,
        chatSessionIds,
        syncMode: 'merge',
        applySeedRecords: false,
        renameField: toName !== fromName
          ? {
            collection: collection.name,
            from: fromName,
            to: toName,
            field: nextField
          }
          : undefined
      })
      : [];

    const character = this.getCharacterCard(characterCardId);
    const chats = this.listChatSessions({ characterCardId, includeArchived: true });
    return {
      ...buildInitialSettingResponse({
        character,
        dataSchema,
        schema: dataSchema.schema,
        chats,
        locations: this.describeInitialSettingLocations(characterCardId, dataSchema.schema, { dataSchema, chats })
      }),
      fieldOperation: {
        type: toName === fromName ? 'update' : 'rename',
        collection: collection.name,
        from: fromName,
        to: toName,
        previousField,
        field: nextField,
        syncExisting: Boolean(syncExisting),
        syncedChats
      }
    };
  }

  deleteInitialSettingField(characterCardId, collectionName, fieldName, {
    syncExisting = false,
    includeArchived = false,
    chatSessionIds
  } = {}) {
    const current = this.getCharacterDataSchema(characterCardId);
    const schema = normalizeInitialSettingSchema(current.schema);
    const collection = findInitialSettingCollection(schema, collectionName);
    const targetName = normalizeSchemaFieldName(fieldName);
    const fieldIndex = collection.fields.findIndex((field) => field.name === targetName);
    if (fieldIndex < 0) {
      const character = this.getCharacterCard(characterCardId);
      const chats = this.listChatSessions({ characterCardId, includeArchived: true });
      return {
        ...buildInitialSettingResponse({
          character,
          dataSchema: current,
          schema,
          chats,
          locations: this.describeInitialSettingLocations(characterCardId, schema, { dataSchema: current, chats })
        }),
        fieldOperation: {
          type: 'delete',
          collection: collection.name,
          field: targetName,
          deleted: false,
          reason: 'field_not_found',
          syncExisting: Boolean(syncExisting),
          syncedChats: []
        }
      };
    }

    const [deletedField] = collection.fields.splice(fieldIndex, 1);
    for (const record of collection.seedRecords) {
      delete record[targetName];
    }

    const nextSchema = normalizeInitialSettingSchema(schema);
    const dataSchema = this.registerCharacterDataSchema(characterCardId, nextSchema, {
      syncExisting: false
    });
    const syncedChats = syncExisting
      ? this.syncInitialSettingSchemaToChats(characterCardId, dataSchema.schema, {
        includeArchived,
        chatSessionIds,
        syncMode: 'replace',
        applySeedRecords: false
      })
      : [];

    const character = this.getCharacterCard(characterCardId);
    const chats = this.listChatSessions({ characterCardId, includeArchived: true });
    return {
      ...buildInitialSettingResponse({
        character,
        dataSchema,
        schema: dataSchema.schema,
        chats,
        locations: this.describeInitialSettingLocations(characterCardId, dataSchema.schema, { dataSchema, chats })
      }),
      fieldOperation: {
        type: 'delete',
        collection: collection.name,
        field: targetName,
        deleted: true,
        previousField: deletedField,
        syncExisting: Boolean(syncExisting),
        syncedChats
      }
    };
  }

  syncInitialSettingSchemaToChats(characterCardId, schema, {
    chatSessionIds,
    includeArchived = false,
    syncMode = 'merge',
    applySeedRecords = false,
    renameField
  } = {}) {
    this.getCharacterCard(characterCardId);
    const selectedIds = Array.isArray(chatSessionIds) && chatSessionIds.length > 0
      ? chatSessionIds.map((id) => String(id))
      : this.listChatSessions({ characterCardId, includeArchived }).map((chat) => chat.id);
    const normalized = normalizeInitialSettingSchema(schema);
    const selectedSyncMode = normalizeSyncMode(syncMode);

    return selectedIds.map((chatSessionId) => {
      const row = this.db.prepare(`
        SELECT *
        FROM chat_data_databases
        WHERE chat_session_id = ?
      `).get(chatSessionId);
      if (!row) {
        return {
          chatSessionId,
          created: true,
          dataDatabase: this.ensureChatDataDatabase(chatSessionId, {
            forceSync: true,
            syncMode: selectedSyncMode
          })
        };
      }

      const manager = this.openChatDataManager(row);
      const fieldChange = renameField
        ? manager.renameField(renameField.collection, renameField.from, renameField.to, renameField.field, { sync: false })
        : undefined;
      applyChatDataSchema(manager, normalized, {
        syncMode: selectedSyncMode,
        applySeedRecords
      });
      this.db.prepare(`
        UPDATE chat_data_databases
        SET schema_snapshot_json = ?, updated_at = ?
        WHERE chat_session_id = ?
      `).run(JSON.stringify(normalized), this.now(), chatSessionId);
      const updated = this.db.prepare(`
        SELECT *
        FROM chat_data_databases
        WHERE chat_session_id = ?
      `).get(chatSessionId);

      return removeUndefined({
        chatSessionId,
        created: false,
        fieldChange,
        dataDatabase: this.rowToChatDataDatabase(updated)
      });
    });
  }

  describeInitialSettingLocations(characterCardId, schema = {}, {
    dataSchema,
    chats
  } = {}) {
    this.getCharacterCard(characterCardId);
    const normalized = normalizeInitialSettingSchema(schema || dataSchema?.schema || normalizeChatDataSchema());
    const chatList = chats || this.listChatSessions({ characterCardId, includeArchived: true });
    const chatRows = this.db.prepare(`
      SELECT *
      FROM chat_data_databases
      WHERE character_card_id = ?
    `).all(characterCardId);
    const chatRowsById = new Map(chatRows.map((row) => [row.chat_session_id, row]));
    const active = this.getActiveChatState();

    const characterSchema = {
      kind: 'character-data-schema',
      databasePath: this.databasePath,
      table: 'character_data_schemas',
      key: { characterCardId },
      column: 'schema_json',
      jsonPath: '$',
      updatedAt: dataSchema?.updatedAt,
      saveAction: '保存初始设定'
    };

    const chatTargets = chatList.map((chat) => {
      const row = chatRowsById.get(chat.id);
      return {
        kind: 'chat-data-database',
        chatSessionId: chat.id,
        title: chat.title,
        active: active?.chatSessionId === chat.id,
        archivedAt: chat.archivedAt,
        databasePath: row?.database_path,
        schemaDirectory: row?.schema_directory,
        status: row?.status || 'pending',
        applyAction: '应用初始设定'
      };
    });

    return {
      characterSchema,
      chatTargets,
      collections: normalized.collections.map((collection, index) => ({
        name: collection.name,
        index,
        characterSchema: {
          ...characterSchema,
          jsonPath: `$.collections[${index}]`
        },
        chatTargets: chatTargets.map((target) => ({
          ...target,
          table: collection.name,
          schemaFile: target.schemaDirectory
            ? resolve(target.schemaDirectory, `${collection.name}.schema.json`)
            : undefined,
          seedRecordIds: collection.seedRecords.map((record) => record.id)
        }))
      }))
    };
  }

  getInitialSetting(characterCardId) {
    const character = this.getCharacterCard(characterCardId);
    const dataSchema = this.getCharacterDataSchema(characterCardId, { missing: 'undefined' });
    const schema = dataSchema?.schema || normalizeChatDataSchema();
    const chats = this.listChatSessions({ characterCardId, includeArchived: true });
    return buildInitialSettingResponse({
      character,
      dataSchema,
      schema,
      chats,
      locations: this.describeInitialSettingLocations(characterCardId, schema, { dataSchema, chats })
    });
  }

  previewInitialSetting(characterCardId, input = {}) {
    const character = this.getCharacterCard(characterCardId);
    const current = this.getCharacterDataSchema(characterCardId, { missing: 'undefined' });
    const schema = normalizeInitialSettingSchema(input.schema || input.initialSetting || input);
    const chats = this.listChatSessions({ characterCardId, includeArchived: true });
    return {
      character: compactCharacterSummary(character),
      initialSetting: schema,
      stats: summarizeInitialSettingSchema(schema),
      diff: diffInitialSettingSchemas(current?.schema || normalizeChatDataSchema(), schema),
      locations: this.describeInitialSettingLocations(characterCardId, schema, { dataSchema: current, chats }),
      validation: {
        ok: true,
        errors: []
      }
    };
  }

  saveInitialSetting(characterCardId, input = {}, {
    syncExisting = false,
    syncMode = 'merge'
  } = {}) {
    const schema = normalizeInitialSettingSchema(input.schema || input.initialSetting || input);
    const dataSchema = this.registerCharacterDataSchema(characterCardId, schema, {
      syncExisting,
      syncMode
    });
    const character = this.getCharacterCard(characterCardId);
    const chats = this.listChatSessions({ characterCardId, includeArchived: true });
    return {
      ...buildInitialSettingResponse({
        character,
        dataSchema,
        schema: dataSchema.schema,
        chats,
        locations: this.describeInitialSettingLocations(characterCardId, dataSchema.schema, { dataSchema, chats })
      }),
      saved: true,
      syncExisting: Boolean(syncExisting),
      syncMode: normalizeSyncMode(syncMode)
    };
  }

  applyInitialSettingToChat(chatSessionId, {
    mode = 'merge',
    syncMode,
    includeDataDatabase = true
  } = {}) {
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const dataSchema = this.getCharacterDataSchema(session.characterCardId, { missing: 'undefined' });
    const schema = dataSchema?.schema || normalizeChatDataSchema();
    const applyMode = normalizeInitialSettingApplyMode(mode);
    const selectedSyncMode = normalizeSyncMode(syncMode || applyMode);
    const before = this.getChatDataDatabase(chatSessionId);
    let database;

    if (applyMode === 'replace') {
      database = this.replaceChatDataDatabase(chatSessionId, { schema }).database;
    } else {
      database = this.ensureChatDataDatabase(chatSessionId, {
        forceSync: true,
        syncMode: selectedSyncMode
      });
    }

    return {
      chatSessionId,
      characterCardId: session.characterCardId,
      mode: applyMode,
      syncMode: selectedSyncMode,
      stats: summarizeInitialSettingSchema(schema),
      locations: this.describeInitialSettingLocations(session.characterCardId, schema, {
        dataSchema,
        chats: [session]
      }),
      before,
      dataDatabase: includeDataDatabase ? database : undefined
    };
  }

  applyInitialSettingToCharacterChats(characterCardId, {
    chatSessionIds,
    includeArchived = false,
    mode = 'merge',
    syncMode
  } = {}) {
    this.getCharacterCard(characterCardId);
    const selectedIds = Array.isArray(chatSessionIds) && chatSessionIds.length > 0
      ? chatSessionIds.map((id) => String(id))
      : this.listChatSessions({ characterCardId, includeArchived }).map((chat) => chat.id);
    const applied = selectedIds.map((chatSessionId) => this.applyInitialSettingToChat(chatSessionId, {
      mode,
      syncMode,
      includeDataDatabase: false
    }));
    return {
      characterCardId,
      applied,
      count: applied.length
    };
  }

  createChatSession({
    characterCardId,
    characterCardRevisionId,
    title,
    userName = 'User',
    playerPersona = '',
    modelProvider,
    modelName,
    promptPresetId,
    metadata = {},
    includeGreeting = true
  } = {}) {
    const card = this.getCharacterCard(characterCardId);
    const revision = characterCardRevisionId
      ? card.revisions.find((candidate) => candidate.id === characterCardRevisionId)
      : card.currentRevision;
    if (!revision) throw notFound(`Character card revision not found: ${characterCardRevisionId}`);

    const timestamp = this.now();
    const sessionId = createId('chat');
    const sessionTitle = title || `${card.name} Chat`;

    this.db.prepare(`
      INSERT INTO chat_sessions (
        id, character_card_id, character_card_revision_id, title, user_name,
        player_persona, model_provider, model_name, prompt_preset_id,
        metadata_json, created_at, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      sessionId,
      characterCardId,
      revision.id,
      sessionTitle,
      userName,
      playerPersona,
      modelProvider ?? null,
      modelName ?? null,
      promptPresetId ?? null,
      JSON.stringify(metadata || {}),
      timestamp,
      timestamp
    );

    this.ensureChatDataDatabase(sessionId);

    if (includeGreeting && revision.data.first_mes) {
      this.addChatMessage(sessionId, {
        role: 'assistant',
        name: revision.data.name || card.name,
        content: revision.data.first_mes,
        metadata: { greeting: true }
      });
    }

    return this.switchChatSession(sessionId);
  }

  listChatSessions({ characterCardId, includeArchived = false } = {}) {
    const where = [];
    const params = [];
    if (characterCardId) {
      where.push('character_card_id = ?');
      params.push(characterCardId);
    }
    if (!includeArchived) {
      where.push('archived_at IS NULL');
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM chat_sessions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC
    `).all(...params);
    return rows.map((row) => this.rowToChatSessionSummary(row));
  }

  getChatSession(chatSessionId, {
    includeMessages = true,
    includeCharacter = true,
    includeDataDatabase = true
  } = {}) {
    const row = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatSessionId);
    if (!row) throw notFound(`Chat session not found: ${chatSessionId}`);

    const session = this.rowToChatSessionSummary(row);
    if (includeMessages) {
      session.messages = this.listChatMessages(chatSessionId);
    }
    if (includeCharacter) {
      session.characterCard = this.exportCharacterCard(row.character_card_id, {
        revisionId: row.character_card_revision_id
      });
    }
    if (includeDataDatabase) {
      session.dataDatabase = this.ensureChatDataDatabase(chatSessionId);
    }
    return session;
  }

  updateChatSession(chatSessionId, patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw validationError('chat session patch must be a plain object');
    }
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const title = Object.hasOwn(patch, 'title')
      ? normalizeRequiredText(patch.title, 'title')
      : session.title;
    const timestamp = this.now();
    this.db.prepare(`
      UPDATE chat_sessions
      SET title = ?,
          updated_at = ?
      WHERE id = ?
    `).run(title, timestamp, chatSessionId);
    return this.getChatSession(chatSessionId);
  }

  restoreChatSessionSnapshot(chatSession = {}) {
    const chatSessionId = normalizeRequiredText(chatSession.id || chatSession.chatSessionId, 'chatSessionId');
    const current = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    if (chatSession.characterCardId && chatSession.characterCardId !== current.characterCardId) {
      throw validationError(`Cannot restore chat session to a different character card: ${chatSessionId}`);
    }

    const metadata = chatSession.metadata && typeof chatSession.metadata === 'object' && !Array.isArray(chatSession.metadata)
      ? chatSession.metadata
      : current.metadata;
    const timestamp = chatSession.updatedAt || this.now();
    this.db.prepare(`
      UPDATE chat_sessions
      SET title = ?,
          user_name = ?,
          player_persona = ?,
          model_provider = ?,
          model_name = ?,
          prompt_preset_id = ?,
          metadata_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      chatSession.title || current.title,
      chatSession.userName || current.userName,
      chatSession.playerPersona ?? current.playerPersona,
      chatSession.modelProvider ?? current.modelProvider ?? null,
      chatSession.modelName ?? current.modelName ?? null,
      chatSession.promptPresetId ?? current.promptPresetId ?? null,
      JSON.stringify(metadata || {}),
      timestamp,
      chatSessionId
    );
    return this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
  }

  switchChatSession(chatSessionId) {
    const session = this.getChatSession(chatSessionId);
    const timestamp = this.now();
    this.db.prepare(`
      INSERT INTO active_chat_state (id, chat_session_id, character_card_id, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chat_session_id = excluded.chat_session_id,
        character_card_id = excluded.character_card_id,
        updated_at = excluded.updated_at
    `).run(chatSessionId, session.characterCardId, timestamp);

    const dataDatabase = this.ensureChatDataDatabase(chatSessionId);
    session.dataDatabase = dataDatabase;
    return {
      active: this.getActiveChatState(),
      session,
      dataDatabase
    };
  }

  switchCharacterCard(characterCardId, {
    chatSessionId,
    createIfMissing = false,
    title,
    userName = 'User',
    playerPersona = '',
    includeGreeting = true
  } = {}) {
    const character = this.getCharacterCard(characterCardId);

    if (chatSessionId) {
      const session = this.getChatSession(chatSessionId, {
        includeMessages: false,
        includeCharacter: false,
        includeDataDatabase: false
      });
      if (session.characterCardId !== characterCardId) {
        throw validationError(`Chat session does not belong to character card: ${chatSessionId}`);
      }
      return {
        character,
        ...this.switchChatSession(chatSessionId)
      };
    }

    const latestChat = this.db.prepare(`
      SELECT id
      FROM chat_sessions
      WHERE character_card_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(characterCardId);
    if (latestChat) {
      return {
        character,
        ...this.switchChatSession(latestChat.id)
      };
    }

    if (createIfMissing) {
      return {
        character,
        ...this.createChatSession({
          characterCardId,
          title: title || `${character.name} Chat`,
          userName,
          playerPersona,
          includeGreeting
        })
      };
    }

    const timestamp = this.now();
    this.db.prepare(`
      INSERT INTO active_chat_state (id, chat_session_id, character_card_id, updated_at)
      VALUES (1, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chat_session_id = NULL,
        character_card_id = excluded.character_card_id,
        updated_at = excluded.updated_at
    `).run(characterCardId, timestamp);

    return {
      active: this.getActiveChatState(),
      character,
      session: undefined,
      dataDatabase: undefined
    };
  }

  getActiveChatState() {
    const row = this.db.prepare('SELECT * FROM active_chat_state WHERE id = 1').get();
    if (!row || (!row.chat_session_id && !row.character_card_id)) return undefined;
    return {
      chatSessionId: row.chat_session_id || undefined,
      characterCardId: row.character_card_id || undefined,
      updatedAt: row.updated_at
    };
  }

  registerLifecycleResource(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw validationError('lifecycle resource must be a plain object');
    }
    const lifecycle = resolveResourceLifecycle(input, {
      appDatabase: this,
      defaultLevel: input.lifecycleLevel || input.importanceLevel || 'L1',
      now: this.now,
      attachByDefault: true
    });
    if (!lifecycle) throw validationError('lifecycle resource could not be resolved');

    if (lifecycle.lifecycleScope === 'chat' && !lifecycle.chatSessionId) {
      throw validationError('chat-scoped lifecycle resource requires chatSessionId or an active chat');
    }
    if (lifecycle.lifecycleScope === 'character' && !lifecycle.characterCardId) {
      throw validationError('character-scoped lifecycle resource requires characterCardId or an active character');
    }
    if (lifecycle.chatSessionId) {
      this.getChatSession(lifecycle.chatSessionId, {
        includeMessages: false,
        includeCharacter: false,
        includeDataDatabase: false
      });
    }
    if (lifecycle.characterCardId) {
      this.getCharacterCard(lifecycle.characterCardId);
    }

    const resourceType = normalizeRequiredText(input.resourceType || input.type, 'resourceType');
    const resourceId = normalizeOptionalText(input.resourceId)
      || buildLifecycleResourceId({ ...input, resourceType });
    const timestamp = this.now();
    const id = normalizeOptionalText(input.id) || createId('life');
    const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {};

    this.db.prepare(`
      INSERT INTO lifecycle_resources (
        id, resource_type, resource_id, layer, collection, source_id, record_id,
        lifecycle_scope, lifecycle_level, character_card_id, chat_session_id,
        lifecycle_inherited, registered_by, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_type, resource_id) DO UPDATE SET
        layer = excluded.layer,
        collection = excluded.collection,
        source_id = excluded.source_id,
        record_id = excluded.record_id,
        lifecycle_scope = excluded.lifecycle_scope,
        lifecycle_level = excluded.lifecycle_level,
        character_card_id = excluded.character_card_id,
        chat_session_id = excluded.chat_session_id,
        lifecycle_inherited = excluded.lifecycle_inherited,
        registered_by = excluded.registered_by,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      resourceType,
      resourceId,
      normalizeOptionalText(input.layer) || null,
      normalizeOptionalText(input.collection) || null,
      normalizeOptionalText(input.sourceId) || null,
      normalizeOptionalText(input.recordId) || null,
      lifecycle.lifecycleScope,
      lifecycle.lifecycleLevel,
      lifecycle.characterCardId || null,
      lifecycle.chatSessionId || null,
      lifecycle.lifecycleInherited ? 1 : 0,
      normalizeOptionalText(input.registeredBy) || null,
      JSON.stringify({
        ...metadata,
        resourceLifecycle: lifecycle
      }),
      timestamp,
      timestamp
    );

    const row = this.db.prepare(`
      SELECT *
      FROM lifecycle_resources
      WHERE resource_type = ? AND resource_id = ?
    `).get(resourceType, resourceId);
    return this.rowToLifecycleResource(row);
  }

  listLifecycleResources({
    resourceType,
    layer,
    collection,
    lifecycleScope,
    lifecycleLevel,
    characterCardId,
    chatSessionId,
    limit = 500,
    offset = 0
  } = {}) {
    const where = [];
    const params = [];
    for (const [column, value] of [
      ['resource_type', resourceType],
      ['layer', layer],
      ['collection', collection],
      ['lifecycle_scope', lifecycleScope],
      ['lifecycle_level', lifecycleLevel],
      ['character_card_id', characterCardId],
      ['chat_session_id', chatSessionId]
    ]) {
      if (value === undefined || value === null || value === '') continue;
      where.push(`${column} = ?`);
      params.push(String(value));
    }
    const safeLimit = clampLifecycleLimit(limit);
    const safeOffset = normalizeLifecycleOffset(offset);
    const rows = this.db.prepare(`
      SELECT *
      FROM lifecycle_resources
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return {
      resources: rows.map((row) => this.rowToLifecycleResource(row)),
      limit: safeLimit,
      offset: safeOffset
    };
  }

  deleteLifecycleResource(resourceIdOrRecordId) {
    const value = normalizeRequiredText(resourceIdOrRecordId, 'resourceId');
    const row = this.db.prepare(`
      SELECT *
      FROM lifecycle_resources
      WHERE id = ? OR resource_id = ?
      LIMIT 1
    `).get(value, value);
    if (!row) {
      return {
        deleted: false,
        resourceId: value
      };
    }
    this.db.prepare('DELETE FROM lifecycle_resources WHERE id = ?').run(row.id);
    return {
      deleted: true,
      resource: this.rowToLifecycleResource(row)
    };
  }

  deleteLifecycleResourcesForChat(chatSessionId) {
    const rows = this.db.prepare(`
      SELECT *
      FROM lifecycle_resources
      WHERE lifecycle_scope = 'chat' AND chat_session_id = ?
      ORDER BY updated_at DESC
    `).all(String(chatSessionId));
    this.db.prepare(`
      DELETE FROM lifecycle_resources
      WHERE lifecycle_scope = 'chat' AND chat_session_id = ?
    `).run(String(chatSessionId));
    return {
      chatSessionId,
      deleted: rows.map((row) => this.rowToLifecycleResource(row))
    };
  }

  deleteLifecycleResourcesForCharacter(characterCardId) {
    const rows = this.db.prepare(`
      SELECT *
      FROM lifecycle_resources
      WHERE character_card_id = ?
      ORDER BY updated_at DESC
    `).all(String(characterCardId));
    this.db.prepare(`
      DELETE FROM lifecycle_resources
      WHERE character_card_id = ?
    `).run(String(characterCardId));
    return {
      characterCardId,
      deleted: rows.map((row) => this.rowToLifecycleResource(row))
    };
  }

  deleteChatSession(chatSessionId) {
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const active = this.getActiveChatState();
    const lifecycleResources = this.deleteLifecycleResourcesForChat(chatSessionId);
    const dataDatabase = this.deleteChatDataDatabase(chatSessionId);
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(chatSessionId);
    if (active?.chatSessionId === chatSessionId) {
      this.db.prepare('DELETE FROM active_chat_state WHERE id = 1').run();
    }
    return {
      deleted: true,
      session,
      dataDatabase,
      lifecycleResources
    };
  }

  addChatMessage(chatSessionId, messageInput) {
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const message = createMessage({
      ...messageInput,
      role: messageInput.role,
      content: messageInput.content,
      name: messageInput.name,
      metadata: messageInput.metadata || {}
    });
    const timestamp = message.createdAt || this.now();
    const maxOrder = this.db.prepare(`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM chat_messages
      WHERE chat_session_id = ?
    `).get(chatSessionId).max_order;
    const orderIndex = Number.isInteger(messageInput.orderIndex) ? messageInput.orderIndex : maxOrder + 1;

    this.db.prepare(`
      INSERT INTO chat_messages (
        id, chat_session_id, role, name, content, parts_json, metadata_json,
        token_count, order_index, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      chatSessionId,
      message.role,
      message.name ?? null,
      message.content,
      messageInput.parts ? JSON.stringify(messageInput.parts) : null,
      JSON.stringify(message.metadata || {}),
      messageInput.tokenCount ?? null,
      orderIndex,
      timestamp
    );

    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(this.now(), session.id);
    return this.getChatMessage(message.id);
  }

  listChatMessages(chatSessionId) {
    return this.db.prepare(`
      SELECT *
      FROM chat_messages
      WHERE chat_session_id = ?
      ORDER BY order_index ASC, created_at ASC
    `).all(chatSessionId).map((row) => this.rowToChatMessage(row));
  }

  getChatMessage(messageId) {
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId);
    if (!row) throw notFound(`Chat message not found: ${messageId}`);
    return this.rowToChatMessage(row);
  }

  updateChatMessage(chatSessionId, messageId, patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw validationError('chat message patch must be a plain object');
    }

    const message = this.getChatMessage(messageId);
    if (message.chatSessionId !== chatSessionId) {
      throw validationError(`Chat message does not belong to chat session: ${messageId}`);
    }

    const content = Object.hasOwn(patch, 'content') ? String(patch.content ?? '') : message.content;
    const timestamp = this.now();
    const metadata = {
      ...(message.metadata || {}),
      ...(patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata) ? patch.metadata : {}),
      editedAt: timestamp
    };

    this.db.prepare(`
      UPDATE chat_messages
      SET content = ?,
          metadata_json = ?
      WHERE id = ?
    `).run(
      content,
      JSON.stringify(metadata),
      message.id
    );
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(timestamp, chatSessionId);
    return this.getChatMessage(message.id);
  }

  deleteChatMessage(messageId) {
    const message = this.getChatMessage(messageId);
    const result = this.db.prepare('DELETE FROM chat_messages WHERE id = ?').run(message.id);
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(this.now(), message.chatSessionId);
    return {
      deleted: result.changes > 0,
      message
    };
  }

  deleteChatMessagesAfter(chatSessionId, {
    messageId,
    orderIndex,
    inclusive = false
  } = {}) {
    this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const cutoffOrderIndex = resolveMessageCutoff(this, chatSessionId, { messageId, orderIndex });
    const comparator = inclusive ? '>=' : '>';
    const deletedMessages = this.db.prepare(`
      SELECT *
      FROM chat_messages
      WHERE chat_session_id = ? AND order_index ${comparator} ?
      ORDER BY order_index ASC, created_at ASC
    `).all(chatSessionId, cutoffOrderIndex).map((row) => this.rowToChatMessage(row));

    if (deletedMessages.length > 0) {
      const deleteStatement = this.db.prepare('DELETE FROM chat_messages WHERE id = ?');
      for (const message of deletedMessages) {
        deleteStatement.run(message.id);
      }
      this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(this.now(), chatSessionId);
    }

    return {
      chatSessionId,
      cutoffOrderIndex,
      inclusive: Boolean(inclusive),
      deletedMessages
    };
  }

  restoreChatMessages(chatSessionId, messages = [], { replaceExisting = false } = {}) {
    this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const restored = [];
    for (const message of normalizeImportedMessages(messages)) {
      if (replaceExisting && message.id) {
        this.db.prepare('DELETE FROM chat_messages WHERE id = ?').run(message.id);
      }
      const existing = message.id
        ? this.db.prepare('SELECT id FROM chat_messages WHERE id = ?').get(message.id)
        : undefined;
      if (existing) continue;
      restored.push(this.addChatMessage(chatSessionId, message));
    }
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(this.now(), chatSessionId);
    return {
      chatSessionId,
      restoredMessages: restored
    };
  }

  replaceChatMessages(chatSessionId, messages = []) {
    this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    this.db.prepare('DELETE FROM chat_messages WHERE chat_session_id = ?').run(chatSessionId);
    const restored = [];
    for (const [index, message] of normalizeImportedMessages(messages).entries()) {
      restored.push(this.addChatMessage(chatSessionId, {
        ...message,
        orderIndex: Number.isInteger(message.orderIndex) ? message.orderIndex : index
      }));
    }
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(this.now(), chatSessionId);
    return {
      chatSessionId,
      restoredMessages: restored
    };
  }

  exportChatSession(chatSessionId) {
    const session = this.getChatSession(chatSessionId);
    return {
      format: 'ai-dnd-chat-v1',
      exportedAt: this.now(),
      characterCard: session.characterCard,
      chatSession: {
        id: session.id,
        characterCardId: session.characterCardId,
        characterCardRevisionId: session.characterCardRevisionId,
        title: session.title,
        userName: session.userName,
        playerPersona: session.playerPersona,
        modelProvider: session.modelProvider,
        modelName: session.modelName,
        promptPresetId: session.promptPresetId,
        metadata: session.metadata,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      },
      messages: session.messages,
      dataDatabase: this.exportChatDataDatabase(chatSessionId)
    };
  }

  importChatSession(payload = {}) {
    const character = payload.characterCardId
      ? this.getCharacterCard(payload.characterCardId)
      : this.importCharacterCard(payload.characterCard || payload.card || payload.character, {
        source: payload.source || 'chat-import'
      });
    const exportedSession = payload.chatSession || payload.session || {};
    const session = this.createChatSession({
      characterCardId: character.id,
      title: payload.title || exportedSession.title,
      userName: payload.userName || exportedSession.userName || 'User',
      playerPersona: payload.playerPersona || exportedSession.playerPersona || '',
      modelProvider: exportedSession.modelProvider,
      modelName: exportedSession.modelName,
      promptPresetId: exportedSession.promptPresetId,
      metadata: exportedSession.metadata || {},
      includeGreeting: false
    }).session;

    const messages = normalizeImportedMessages(payload.messages || payload.chat || []);
    for (const [index, message] of messages.entries()) {
      this.addChatMessage(session.id, {
        ...message,
        id: undefined,
        orderIndex: index
      });
    }

    if (payload.dataDatabase) {
      this.importChatDataDatabase(session.id, payload.dataDatabase);
    }

    return this.getChatSession(session.id);
  }

  ensureChatDataDatabase(chatSessionId, {
    forceSync = false,
    syncMode = 'merge'
  } = {}) {
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const timestamp = this.now();
    let row = this.db.prepare(`
      SELECT *
      FROM chat_data_databases
      WHERE chat_session_id = ?
    `).get(chatSessionId);
    const isNew = !row;

    if (!row) {
      const paths = this.createChatDataPaths(chatSessionId);
      this.db.prepare(`
        INSERT INTO chat_data_databases (
          chat_session_id, character_card_id, database_path, schema_directory,
          schema_snapshot_json, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        chatSessionId,
        session.characterCardId,
        paths.databasePath,
        paths.schemaDirectory,
        '{}',
        timestamp,
        timestamp
      );
      row = this.db.prepare(`
        SELECT *
        FROM chat_data_databases
        WHERE chat_session_id = ?
      `).get(chatSessionId);
    }

    const schemaRecord = this.getCharacterDataSchema(session.characterCardId, { missing: 'undefined' });
    const schema = schemaRecord?.schema || normalizeChatDataSchema();
    const snapshotChanged = stableStringify(safeJsonParse(row.schema_snapshot_json, {})) !== stableStringify(schema);
    if (isNew || forceSync || snapshotChanged) {
      const manager = this.openChatDataManager(row);
      applyChatDataSchema(manager, schema, { syncMode });
      this.db.prepare(`
        UPDATE chat_data_databases
        SET schema_snapshot_json = ?, updated_at = ?
        WHERE chat_session_id = ?
      `).run(JSON.stringify(schema), this.now(), chatSessionId);
      row = this.db.prepare(`
        SELECT *
        FROM chat_data_databases
        WHERE chat_session_id = ?
      `).get(chatSessionId);
    }

    return this.rowToChatDataDatabase(row);
  }

  getChatDataDatabase(chatSessionId) {
    return this.ensureChatDataDatabase(chatSessionId);
  }

  listChatDataCollections(chatSessionId) {
    const metadata = this.ensureChatDataDatabase(chatSessionId);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return {
      database: metadata,
      collections: manager.listCollections().map((collection) => manager.describeCollection(collection))
    };
  }

  describeChatDataCollection(chatSessionId, collection) {
    this.ensureChatDataDatabase(chatSessionId);
    const name = normalizeCollectionName(collection);
    this.assertChatDataCollectionRegistered(chatSessionId, name);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.describeCollection(name);
  }

  upsertChatDataRecord(chatSessionId, collection, record, { id } = {}) {
    const recordId = id ?? record?.id;
    const { name, data } = this.normalizeChatDataRecord(chatSessionId, collection, record);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.upsertRecord(name, data, { id: recordId });
  }

  patchChatDataRecord(chatSessionId, collection, id, patch) {
    const { name, data } = this.normalizeChatDataPatch(chatSessionId, collection, patch);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.patchRecord(name, id, data);
  }

  getChatDataRecord(chatSessionId, collection, id) {
    this.ensureChatDataDatabase(chatSessionId);
    const name = normalizeCollectionName(collection);
    this.assertChatDataCollectionRegistered(chatSessionId, name);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.getRecord(name, id);
  }

  queryChatDataRecords(chatSessionId, collection, query = {}) {
    this.ensureChatDataDatabase(chatSessionId);
    const name = normalizeCollectionName(collection);
    this.assertChatDataCollectionRegistered(chatSessionId, name);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.queryRecords(name, query);
  }

  deleteChatDataRecord(chatSessionId, collection, id) {
    this.ensureChatDataDatabase(chatSessionId);
    const name = normalizeCollectionName(collection);
    this.assertChatDataCollectionRegistered(chatSessionId, name);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    return manager.deleteRecord(name, id);
  }

  exportChatDataDatabase(chatSessionId) {
    const metadata = this.ensureChatDataDatabase(chatSessionId);
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    const collections = manager.listCollections().map((collection) => ({
      collection,
      records: manager.queryRecords(collection, { limit: 500 }).records
    }));
    return {
      database: metadata,
      schema: metadata.schemaSnapshot,
      collections
    };
  }

  importChatDataDatabase(chatSessionId, payload = {}) {
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const existingSchema = this.getCharacterDataSchema(session.characterCardId, { missing: 'undefined' });
    if (!existingSchema && payload.schema) {
      this.registerCharacterDataSchema(session.characterCardId, payload.schema, {
        syncExisting: true,
        syncMode: 'merge'
      });
    }

    const metadata = this.ensureChatDataDatabase(chatSessionId, { forceSync: true });
    const manager = this.openChatDataManagerByChatId(chatSessionId);
    const collections = Array.isArray(payload.collections) ? payload.collections : [];
    for (const collection of collections) {
      const name = normalizeCollectionName(collection.collection || collection.name);
      const records = Array.isArray(collection.records) ? collection.records : [];
      for (const record of records) {
        manager.upsertRecord(name, record.data || record, { id: record.id });
      }
    }

    return {
      database: metadata,
      importedCollections: collections.length
    };
  }

  replaceChatDataDatabase(chatSessionId, payload = {}) {
    const metadata = this.ensureChatDataDatabase(chatSessionId, { forceSync: true });
    const manager = this.openChatDataManagerByChatId(chatSessionId);

    for (const collection of manager.listCollections()) {
      manager.deleteCollection(collection);
    }

    const schema = payload.schema || payload.database?.schemaSnapshot || metadata.schemaSnapshot || normalizeChatDataSchema();
    applyChatDataSchema(manager, schema, { syncMode: 'replace' });
    this.db.prepare(`
      UPDATE chat_data_databases
      SET schema_snapshot_json = ?, updated_at = ?
      WHERE chat_session_id = ?
    `).run(JSON.stringify(normalizeChatDataSchema(schema)), this.now(), chatSessionId);

    const collections = Array.isArray(payload.collections) ? payload.collections : [];
    for (const collection of collections) {
      const name = normalizeCollectionName(collection.collection || collection.name);
      const records = Array.isArray(collection.records) ? collection.records : [];
      for (const record of records) {
        manager.upsertRecord(name, record.data || record, { id: record.id });
      }
    }

    return {
      database: this.getChatDataDatabase(chatSessionId),
      replacedCollections: collections.map((collection) => collection.collection || collection.name).filter(Boolean)
    };
  }

  deleteChatDataDatabase(chatSessionId) {
    const row = this.db.prepare(`
      SELECT *
      FROM chat_data_databases
      WHERE chat_session_id = ?
    `).get(chatSessionId);
    if (!row) {
      return {
        chatSessionId,
        deleted: false
      };
    }

    const manager = this.chatDataManagers.get(chatSessionId);
    if (manager) {
      manager.close();
      this.chatDataManagers.delete(chatSessionId);
    }

    if (row.database_path !== ':memory:') {
      for (const filePath of [
        row.database_path,
        `${row.database_path}-wal`,
        `${row.database_path}-shm`
      ]) {
        if (existsSync(filePath)) unlinkSync(filePath);
      }
    }
    if (row.schema_directory && existsSync(row.schema_directory)) {
      rmSync(row.schema_directory, { recursive: true, force: true });
    }

    this.db.prepare(`
      DELETE FROM chat_data_databases
      WHERE chat_session_id = ?
    `).run(chatSessionId);
    return {
      chatSessionId,
      deleted: true,
      databasePath: row.database_path,
      schemaDirectory: row.schema_directory
    };
  }

  createChatDataPaths(chatSessionId) {
    if (!this.chatDataDirectory) {
      return {
        databasePath: ':memory:',
        schemaDirectory: null
      };
    }
    const safeChatId = pathSegment(chatSessionId);
    const directory = resolve(this.chatDataDirectory, safeChatId);
    const schemaDirectory = resolve(directory, 'schemas');
    mkdirSync(schemaDirectory, { recursive: true });
    return {
      databasePath: resolve(directory, 'chat-data.sqlite'),
      schemaDirectory
    };
  }

  openChatDataManagerByChatId(chatSessionId) {
    const row = this.db.prepare(`
      SELECT *
      FROM chat_data_databases
      WHERE chat_session_id = ?
    `).get(chatSessionId);
    if (!row) throw notFound(`Chat data database not found: ${chatSessionId}`);
    return this.openChatDataManager(row);
  }

  openChatDataManager(row) {
    const cached = this.chatDataManagers.get(row.chat_session_id);
    if (cached) return cached;

    const manager = new SQLiteDataManager({
      databasePath: row.database_path,
      schemaDirectory: row.schema_directory,
      cwd: this.cwd,
      now: this.now
    });
    this.chatDataManagers.set(row.chat_session_id, manager);
    return manager;
  }

  assertChatDataCollectionRegistered(chatSessionId, collection) {
    this.getChatDataCollectionTemplate(chatSessionId, collection);
  }

  getChatDataCollectionTemplate(chatSessionId, collection) {
    const name = normalizeCollectionName(collection);
    const session = this.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const schemaRecord = this.getCharacterDataSchema(session.characterCardId, { missing: 'undefined' });
    const template = schemaRecord?.schema.collections.find((candidate) => candidate.name === name);
    if (!template) {
      throw validationError(`Chat data collection is not registered for this character card: ${name}`);
    }
    return template;
  }

  normalizeChatDataRecord(chatSessionId, collection, record = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw validationError('chat data record must be a plain object');
    }

    const name = normalizeCollectionName(collection);
    const template = this.getChatDataCollectionTemplate(chatSessionId, name);
    const allowedFields = new Set(template.fields.map((field) => field.name));
    for (const field of Object.keys(record || {})) {
      if (field === 'id' || allowedFields.has(field)) continue;
      throw validationError(`Field is not registered in chat data schema: ${name}.${field}`);
    }

    const data = {};
    for (const field of template.fields) {
      if (Object.hasOwn(record, field.name)) {
        data[field.name] = coerceChatDataValue(record[field.name], field);
      } else if (Object.hasOwn(field, 'defaultValue')) {
        data[field.name] = field.defaultValue;
      } else if (field.required) {
        throw validationError(`Missing required chat data field: ${name}.${field.name}`);
      }
    }

    return { name, data };
  }

  normalizeChatDataPatch(chatSessionId, collection, patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw validationError('chat data patch must be a plain object');
    }

    const name = normalizeCollectionName(collection);
    const template = this.getChatDataCollectionTemplate(chatSessionId, name);
    const fields = new Map(template.fields.map((field) => [field.name, field]));
    const data = {};

    for (const [fieldName, value] of Object.entries(patch)) {
      if (fieldName === 'id') continue;
      const field = fields.get(fieldName);
      if (!field) {
        throw validationError(`Field is not registered in chat data schema: ${name}.${fieldName}`);
      }
      data[fieldName] = coerceChatDataValue(value, field);
    }

    return { name, data };
  }

  getNextRevisionNumber(characterCardId) {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
      FROM character_card_revisions
      WHERE character_card_id = ?
    `).get(characterCardId);
    return row.next_revision;
  }

  rowToCharacterCardSummary(row) {
    return {
      id: row.id,
      name: row.name,
      spec: row.spec,
      specVersion: row.spec_version,
      currentRevisionId: row.current_revision_id,
      tags: safeJsonParse(row.tags_json, []),
      avatarAssetId: row.avatar_asset_id,
      source: row.source,
      sourceHash: row.source_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at
    };
  }

  rowToRevision(row) {
    return {
      id: row.id,
      characterCardId: row.character_card_id,
      revision: row.revision,
      data: safeJsonParse(row.data_json, {}),
      contentHash: row.content_hash,
      notes: row.notes,
      createdAt: row.created_at
    };
  }

  rowToCharacterDataSchema(row) {
    return {
      characterCardId: row.character_card_id,
      schema: safeJsonParse(row.schema_json, normalizeChatDataSchema()),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  rowToChatSessionSummary(row) {
    return {
      id: row.id,
      characterCardId: row.character_card_id,
      characterCardRevisionId: row.character_card_revision_id,
      title: row.title,
      userName: row.user_name,
      playerPersona: row.player_persona,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptPresetId: row.prompt_preset_id,
      metadata: safeJsonParse(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at
    };
  }

  rowToChatDataDatabase(row) {
    const active = this.getActiveChatState();
    return {
      chatSessionId: row.chat_session_id,
      characterCardId: row.character_card_id,
      databasePath: row.database_path,
      schemaDirectory: row.schema_directory,
      schemaSnapshot: safeJsonParse(row.schema_snapshot_json, normalizeChatDataSchema()),
      status: row.status,
      active: active?.chatSessionId === row.chat_session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  rowToChatMessage(row) {
    return {
      id: row.id,
      chatSessionId: row.chat_session_id,
      role: row.role,
      name: row.name,
      content: row.content,
      parts: row.parts_json ? safeJsonParse(row.parts_json, undefined) : undefined,
      metadata: safeJsonParse(row.metadata_json, {}),
      tokenCount: row.token_count,
      orderIndex: row.order_index,
      createdAt: row.created_at
    };
  }

  rowToLifecycleResource(row) {
    return {
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      layer: row.layer,
      collection: row.collection,
      sourceId: row.source_id,
      recordId: row.record_id,
      lifecycleScope: row.lifecycle_scope,
      lifecycleLevel: row.lifecycle_level,
      characterCardId: row.character_card_id,
      chatSessionId: row.chat_session_id,
      lifecycleInherited: Boolean(row.lifecycle_inherited),
      registeredBy: row.registered_by,
      metadata: safeJsonParse(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function normalizeImportedMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.filter((message) => message && typeof message === 'object').map((message) => {
    if (message.role && message.content !== undefined) {
      return {
        id: message.id,
        role: message.role,
        name: message.name,
        content: String(message.content || ''),
        metadata: message.metadata || {},
        parts: message.parts,
        tokenCount: message.tokenCount,
        orderIndex: message.orderIndex,
        createdAt: message.createdAt
      };
    }

    return {
      id: message.id,
      role: message.is_user ? 'user' : 'assistant',
      name: message.name || message.user_name || message.character_name,
      content: String(message.mes || message.content || ''),
      metadata: {
        imported: true,
        source: 'sillytavern-like',
        original: message
      },
      orderIndex: message.orderIndex,
      createdAt: message.createdAt
    };
  }).filter((message) => message.content);
}

function resolveMessageCutoff(appDatabase, chatSessionId, { messageId, orderIndex } = {}) {
  if (Number.isInteger(orderIndex)) return orderIndex;
  if (messageId) {
    const message = appDatabase.getChatMessage(messageId);
    if (message.chatSessionId !== chatSessionId) {
      throw validationError(`Chat message does not belong to chat session: ${messageId}`);
    }
    return message.orderIndex;
  }
  const messages = appDatabase.listChatMessages(chatSessionId);
  if (messages.length === 0) return -1;
  return messages[messages.length - 1].orderIndex;
}

export function normalizeChatDataSchema(schema = {}) {
  const input = Array.isArray(schema) ? { collections: schema } : (schema || {});
  const rawCollections = Array.isArray(input.collections)
    ? input.collections
    : Object.entries(input.collections || {}).map(([name, collection]) => ({
      ...collection,
      name
    }));
  const collections = [];
  const seenCollections = new Set();

  for (const collection of rawCollections) {
    const normalized = normalizeCollectionTemplate(collection);
    if (seenCollections.has(normalized.name)) continue;
    seenCollections.add(normalized.name);
    collections.push(normalized);
  }

  return {
    version: String(input.version || '1'),
    description: input.description || '',
    collections
  };
}

export function normalizeInitialSettingSchema(schema = {}) {
  const normalized = normalizeChatDataSchema(schema);
  return {
    ...normalized,
    collections: normalized.collections.map((collection) => ({
      ...collection,
      seedRecords: collection.seedRecords.map((record, index) => normalizeInitialSeedRecord(collection, record, index))
    }))
  };
}

function normalizeInitialSeedRecord(collection, record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw validationError(`initial seed record must be a plain object: ${collection.name}[${index}]`);
  }
  const fields = new Map(collection.fields.map((field) => [field.name, field]));
  const source = !fields.has('data') && record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? { id: record.id, ...record.data }
    : record;
  const id = normalizeOptionalText(source.id);
  if (!id) {
    throw validationError(`initial seed record id is required: ${collection.name}[${index}]`);
  }

  for (const fieldName of Object.keys(source)) {
    if (fieldName === 'id') continue;
    if (!fields.has(fieldName)) {
      throw validationError(`Field is not registered in initial setting schema: ${collection.name}.${fieldName}`);
    }
  }

  const normalized = { id };
  for (const field of collection.fields) {
    if (Object.hasOwn(source, field.name)) {
      normalized[field.name] = coerceChatDataValue(source[field.name], field);
    } else if (Object.hasOwn(field, 'defaultValue')) {
      normalized[field.name] = field.defaultValue;
    } else if (field.required) {
      throw validationError(`Missing required initial seed field: ${collection.name}.${field.name}`);
    }
  }
  return normalized;
}

function buildInitialSettingResponse({ character, dataSchema, schema, chats = [], locations }) {
  const normalized = normalizeInitialSettingSchema(schema);
  return {
    character: compactCharacterSummary(character),
    dataSchema,
    initialSetting: normalized,
    stats: summarizeInitialSettingSchema(normalized),
    locations,
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      archivedAt: chat.archivedAt,
      updatedAt: chat.updatedAt
    }))
  };
}

function compactCharacterSummary(character) {
  return {
    id: character.id,
    name: character.name,
    currentRevisionId: character.currentRevisionId,
    updatedAt: character.updatedAt,
    archivedAt: character.archivedAt
  };
}

function summarizeInitialSettingSchema(schema) {
  const normalized = normalizeChatDataSchema(schema);
  const collections = normalized.collections.map((collection) => ({
    name: collection.name,
    fieldCount: collection.fields.length,
    requiredFieldCount: collection.fields.filter((field) => field.required).length,
    seedRecordCount: collection.seedRecords.length
  }));
  return {
    collectionCount: collections.length,
    fieldCount: collections.reduce((total, collection) => total + collection.fieldCount, 0),
    requiredFieldCount: collections.reduce((total, collection) => total + collection.requiredFieldCount, 0),
    seedRecordCount: collections.reduce((total, collection) => total + collection.seedRecordCount, 0),
    collections
  };
}

function diffInitialSettingSchemas(before, after) {
  const beforeSchema = normalizeChatDataSchema(before);
  const afterSchema = normalizeChatDataSchema(after);
  const beforeCollections = new Map(beforeSchema.collections.map((collection) => [collection.name, collection]));
  const afterCollections = new Map(afterSchema.collections.map((collection) => [collection.name, collection]));
  const addedCollections = [];
  const removedCollections = [];
  const changedCollections = [];

  for (const name of afterCollections.keys()) {
    if (!beforeCollections.has(name)) {
      addedCollections.push(name);
    } else if (stableStringify(beforeCollections.get(name)) !== stableStringify(afterCollections.get(name))) {
      changedCollections.push(name);
    }
  }
  for (const name of beforeCollections.keys()) {
    if (!afterCollections.has(name)) removedCollections.push(name);
  }

  return {
    addedCollections,
    removedCollections,
    changedCollections
  };
}

function findInitialSettingCollection(schema, collectionName) {
  const name = normalizeCollectionName(collectionName);
  const collection = schema.collections.find((candidate) => candidate.name === name);
  if (!collection) throw notFound(`Initial setting collection not found: ${name}`);
  return collection;
}

function normalizeInitialSettingApplyMode(mode) {
  const normalized = String(mode || 'merge').toLowerCase();
  if (normalized === 'replace' || normalized === 'reset') return 'replace';
  if (normalized === 'merge' || normalized === 'sync') return 'merge';
  throw validationError('initial setting apply mode must be "merge" or "replace"');
}

function normalizeSyncMode(syncMode) {
  const normalized = String(syncMode || 'merge').toLowerCase();
  if (normalized === 'replace' || normalized === 'merge') return normalized;
  throw validationError('syncMode must be "merge" or "replace"');
}

function normalizeCollectionTemplate(collection = {}) {
  const name = normalizeCollectionName(collection.name || collection.collection);
  const rawFields = Array.isArray(collection.fields)
    ? collection.fields
    : Object.entries(collection.fields || {}).map(([fieldName, field]) => ({
      ...field,
      name: fieldName
    }));
  const fields = [];
  const seenFields = new Set();

  for (const field of rawFields) {
    const normalized = normalizeSchemaField(field);
    if (seenFields.has(normalized.name)) continue;
    seenFields.add(normalized.name);
    fields.push(normalized);
  }

  return {
    name,
    description: collection.description || '',
    fields,
    seedRecords: Array.isArray(collection.seedRecords)
      ? collection.seedRecords
      : (Array.isArray(collection.records) ? collection.records : [])
  };
}

function normalizeSchemaField(field) {
  if (typeof field === 'string') {
    return {
      name: normalizeSchemaFieldName(field),
      type: 'text'
    };
  }
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw validationError('chat data schema field must be a string or object');
  }
  const normalized = {
    name: normalizeSchemaFieldName(field.name),
    type: normalizeSchemaFieldType(field.type),
    description: field.description || '',
    required: Boolean(field.required)
  };
  if (Object.hasOwn(field, 'defaultValue')) {
    normalized.defaultValue = field.defaultValue;
  }
  return normalized;
}

function normalizeSchemaFieldName(field) {
  const name = String(field || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw validationError('chat data schema field name must match /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/');
  }
  if (['id', 'created_at', 'updated_at', '_json', 'createdAt', 'updatedAt'].includes(name)) {
    throw validationError(`Cannot use system field name in chat data schema: ${name}`);
  }
  return name;
}

function normalizeSchemaFieldType(type) {
  const normalized = String(type || 'text').toLowerCase();
  if (['string', 'text'].includes(normalized)) return 'text';
  if (['integer', 'int'].includes(normalized)) return 'integer';
  if (['number', 'float', 'real'].includes(normalized)) return 'number';
  if (normalized === 'boolean') return 'boolean';
  if (['json', 'object', 'array'].includes(normalized)) return 'json';
  return 'text';
}

function coerceChatDataValue(value, field) {
  if (value === undefined) {
    if (field.required) throw validationError(`Missing required chat data field: ${field.name}`);
    return undefined;
  }
  if (value === null) {
    if (field.required) throw validationError(`Required chat data field cannot be null: ${field.name}`);
    return null;
  }

  switch (field.type) {
    case 'integer': {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(number)) {
        throw validationError(`Chat data field must be an integer: ${field.name}`);
      }
      return number;
    }
    case 'number': {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) {
        throw validationError(`Chat data field must be a number: ${field.name}`);
      }
      return number;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      throw validationError(`Chat data field must be a boolean: ${field.name}`);
    }
    case 'json':
      return value;
    case 'text':
    default:
      return String(value);
  }
}

function applyChatDataSchema(manager, schema, {
  syncMode = 'merge',
  applySeedRecords = true
} = {}) {
  const normalized = normalizeChatDataSchema(schema);

  for (const collection of normalized.collections) {
    manager.ensureCollection(collection.name);
    if (collection.fields.length > 0) {
      manager.alterFields(collection.name, {
        add: collection.fields,
        reason: 'characterDataSchema'
      });
    }

    if (syncMode === 'replace') {
      const keep = new Set(collection.fields.map((field) => field.name));
      const description = manager.describeCollection(collection.name);
      const deleteFields = description.fields
        .filter((field) => !field.system && !keep.has(field.name))
        .map((field) => field.name);
      if (deleteFields.length > 0) {
        manager.alterFields(collection.name, {
          delete: deleteFields,
          reason: 'characterDataSchema:replace'
        });
      }
    }

    if (applySeedRecords) {
      for (const seedRecord of collection.seedRecords) {
        if (!seedRecord || typeof seedRecord !== 'object' || Array.isArray(seedRecord)) continue;
        manager.upsertRecord(collection.name, seedRecord, { id: seedRecord.id });
      }
    }
  }
}

function stableHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeJsonParse(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)])
    );
  }
  return value;
}

function buildLifecycleResourceId({
  resourceType,
  layer,
  collection,
  sourceId,
  recordId
} = {}) {
  const parts = [
    resourceType,
    layer,
    collection,
    sourceId,
    recordId
  ].map(normalizeOptionalText).filter(Boolean);
  if (parts.length < 2) throw validationError('lifecycle resource requires resourceId, sourceId, or recordId');
  return parts.join(':');
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

function clampLifecycleLimit(limit) {
  const number = Number(limit ?? 500);
  if (!Number.isInteger(number) || number < 1) return 500;
  return Math.min(number, 5000);
}

function normalizeLifecycleOffset(offset) {
  const number = Number(offset || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'AppDataNotFoundError';
  error.statusCode = 404;
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'AppDataValidationError';
  error.statusCode = 400;
  return error;
}

function pathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
}
