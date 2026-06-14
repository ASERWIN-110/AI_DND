// @ts-nocheck
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import { importDocumentToDataManager } from '../data/structured-document-importer.js';
import { quantifyTextToDataManager } from '../data/text-quantifier.js';
import { attachResourceLifecycle, lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

export const DATA_PLUGIN = {
  id: 'system.data',
  name: 'System Data Tools',
  version: '0.1.0',
  description: 'Zero-config SQLite-backed record storage with automatic collection schema management.',
  enabled: true,
  permissions: ['database:read', 'database:write'],
  tools: [
    {
      name: 'import_document',
      title: 'Import Structured Document',
      description: 'Parse JSON, YAML, or XML text, infer collections and fields, then create/update database tables and initialize records automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            minLength: 1,
            description: 'Structured document text.'
          },
          format: {
            type: 'string',
            enum: ['auto', 'json', 'yaml', 'yml', 'xml'],
            default: 'auto'
          },
          collection: {
            type: 'string',
            description: 'Optional target collection for single-record or array documents.'
          },
          collectionMap: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Optional top-level key to collection-name mapping.'
          },
          idField: {
            type: 'string',
            default: 'id',
            description: 'Field to use as record id when present.'
          },
          ...lifecycleSchemaProperties()
        },
        required: ['text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['data', 'sqlite', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'semantic_update',
      title: 'Semantic Update',
      description: 'Apply model-extracted values from fuzzy natural language to a record using optional prompt/rule metadata. Values are coerced by declared field rules and the original text can be stored for audit.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { type: 'string' },
          text: {
            type: 'string',
            description: 'Original fuzzy natural language description.'
          },
          values: {
            type: 'object',
            additionalProperties: true,
            description: 'Structured values extracted by the model according to the imported prompt/rules.'
          },
          rules: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional field rules. Example: { fields: [{ name: "hp", type: "integer", min: 0, max: 999 }] }.'
          },
          rawTextField: {
            type: 'string',
            default: 'notes'
          },
          storeRawText: {
            type: 'boolean',
            default: true
          },
          ...lifecycleSchemaProperties()
        },
        required: ['collection', 'values'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['data', 'sqlite', 'semantic', 'update']
    },
    {
      name: 'quantify_text',
      title: 'Quantify Text',
      description: 'Use a user-defined quantification prompt, numeric/text field definitions, scoring rules, and references to convert fuzzy descriptions into structured numeric values and special text settings, then store them in SQLite.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { type: 'string' },
          text: {
            type: 'string',
            description: 'Fuzzy natural language description to score and store.'
          },
          definition: {
            type: 'object',
            description: 'User-defined quantification mode. Supports fields, numericFields, textFields, prompt, references, and rules.',
            properties: {
              version: { type: 'string' },
              prompt: {
                type: 'string',
                description: 'Human-readable instruction used to define how the model/user expects this quantification to work.'
              },
              fields: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              },
              numericFields: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              },
              textFields: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              }
            },
            additionalProperties: true
          },
          values: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional model/user-provided field values. Provided values are validated and take precedence over rule scoring.'
          },
          mode: {
            type: 'string',
            enum: ['upsert', 'patch'],
            default: 'upsert'
          },
          storeRawText: {
            type: 'boolean',
            default: true
          },
          rawTextField: {
            type: 'string',
            default: 'sourceText'
          },
          storeAudit: {
            type: 'boolean',
            default: true
          },
          auditField: {
            type: 'string',
            default: 'quantificationAudit'
          },
          useLlm: {
            type: 'boolean',
            default: false,
            description: 'Use the configured chatProvider to quantify fields with field-specific reference material.'
          },
          preferLlm: {
            type: 'boolean',
            default: false,
            description: 'Prefer LLM quantification over deterministic scoring when a chatProvider is available.'
          },
          requireLlm: {
            type: 'boolean',
            default: false,
            description: 'Fail instead of falling back to deterministic scoring when no chatProvider is available.'
          },
          allowNewFields: {
            type: 'boolean',
            default: false,
            description: 'Allow the LLM to create additional numeric/text fields when the source text implies values not covered by the definition.'
          },
          maxNewFields: {
            type: 'integer',
            minimum: 0,
            maximum: 50,
            default: 12
          },
          referenceText: referenceInputSchema(),
          referenceDocuments: referenceInputSchema(),
          referenceDocs: referenceInputSchema(),
          referenceFiles: referenceInputSchema(),
          referenceFilePaths: referenceInputSchema(),
          allowReferenceFilePaths: {
            type: 'boolean',
            default: false,
            description: 'Allow reading local reference paths. Requires explicit user authorization in the tool context.'
          },
          cwd: { type: 'string' },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1 },
          newFieldsMaxTokens: { type: 'integer', minimum: 1 },
          ...lifecycleSchemaProperties()
        },
        required: ['collection', 'text', 'definition'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['data', 'sqlite', 'quantify', 'scoring', 'prompt']
    },
    {
      name: 'get_record',
      title: 'Get Record',
      description: 'Fetch a record by collection and id.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { type: 'string' }
        },
        required: ['collection', 'id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['data', 'sqlite', 'record']
    },
    {
      name: 'query_fields',
      title: 'Query Fields',
      description: 'Query specific fields from records using structured filters. Use this when a request only needs selected columns instead of full records.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          fields: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1
          },
          filter: {
            type: 'object',
            additionalProperties: true
          },
          sort: {
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
          },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['collection', 'fields'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['data', 'sqlite', 'query', 'fields']
    },
    {
      name: 'alter_fields',
      title: 'Alter Fields',
      description: 'Add or delete fields for a collection and synchronize the collection schema/format JSON file. Use one operation for both add and delete to avoid duplicate schema tools.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          add: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['text', 'string', 'integer', 'int', 'number', 'float', 'real', 'boolean', 'json', 'object', 'array']
                },
                description: { type: 'string' },
                defaultValue: {},
                source: { type: 'string' }
              },
              required: ['name'],
              additionalProperties: false
            }
          },
          delete: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    name: { type: 'string' }
                  },
                  required: ['name'],
                  additionalProperties: false
                }
              ]
            }
          },
          reason: {
            type: 'string',
            description: 'Short reason for schema history in the synchronized format file.'
          }
        },
        required: ['collection'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['data', 'sqlite', 'schema', 'fields']
    },
    {
      name: 'delete_record',
      title: 'Delete Record',
      description: 'Delete a record by collection and id.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          id: { type: 'string' }
        },
        required: ['collection', 'id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      tags: ['data', 'sqlite', 'record']
    },
    {
      name: 'describe_collection',
      title: 'Describe Collection',
      description: 'Show whether a collection exists and list its generated columns.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' }
        },
        required: ['collection'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['data', 'sqlite', 'schema']
    },
    {
      name: 'list_collections',
      title: 'List Collections',
      description: 'List all data collections.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['data', 'sqlite', 'schema']
    },
    {
      name: 'delete_collection',
      title: 'Delete Collection',
      description: 'Drop an entire collection table. Intended for administrative use.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string' }
        },
        required: ['collection'],
        additionalProperties: false
      },
      visibility: 'internal',
      autoCallable: false,
      mutatesState: true,
      tags: ['data', 'sqlite', 'schema', 'admin']
    }
  ]
};

export function createDataHandlers(dataManager = new SQLiteDataManager(), { chatProvider, appDatabase } = {}) {
  return {
    import_document: async ({ input }) => importDocumentToDataManager(dataManager, input, { appDatabase }),
    semantic_update: async ({ input }) => dataManager.applySemanticUpdate(input.collection, {
      ...input,
      values: attachResourceLifecycle({
        resourceLifecycle: input.resourceLifecycle,
        lifecycleScope: input.lifecycleScope,
        lifecycleLevel: input.lifecycleLevel,
        importanceLevel: input.importanceLevel,
        characterCardId: input.characterCardId,
        chatSessionId: input.chatSessionId,
        lifecycleClonePolicy: input.lifecycleClonePolicy,
        cloneForChat: input.cloneForChat,
        ...(input.values || {})
      }, { appDatabase, defaultLevel: 'L1' })
    }),
    quantify_text: async ({ input, context }) => {
      if (input.allowReferenceFilePaths && !isUserAuthorized(context)) {
        const error = new Error('allowReferenceFilePaths requires explicit user authorization');
        error.name = 'ToolAuthorizationError';
        error.statusCode = 403;
        throw error;
      }
      return quantifyTextToDataManager(dataManager, input, { chatProvider, appDatabase });
    },
    get_record: async ({ input }) => dataManager.getRecord(input.collection, input.id),
    query_fields: async ({ input }) => dataManager.queryFields(input.collection, input),
    alter_fields: async ({ input }) => dataManager.alterFields(input.collection, input),
    delete_record: async ({ input }) => dataManager.deleteRecord(input.collection, input.id),
    describe_collection: async ({ input }) => dataManager.describeCollection(input.collection),
    list_collections: async () => ({ collections: dataManager.listCollections() }),
    delete_collection: async ({ input }) => dataManager.deleteCollection(input.collection)
  };
}

function referenceInputSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      },
      { type: 'object', additionalProperties: true }
    ]
  };
}

function isUserAuthorized(context = {}) {
  const authorization = context?.authorization ?? context?.userAuthorization ?? context?.approval;
  if (authorization === true || context?.manual === true || context?.actor === 'user' || context?.actor === 'manual') return true;
  if (!authorization || typeof authorization !== 'object') return false;
  return authorization.approved === true || authorization.userApproved === true || authorization.granted === true;
}
