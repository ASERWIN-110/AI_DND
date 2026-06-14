// @ts-nocheck
import { RESOURCE_LIFECYCLE_FIELDS } from '../lifecycle/resource-lifecycle.js';
import {
  VISUAL_ASSET_FIELDS,
  VISUAL_ASSET_BINDING_FIELDS,
  VISUAL_EVENT_BINDING_FIELDS
} from '../visual/visual-asset-manager.js';

export const EXTENSION_DATABASE_NUMERIC_SETTING_FIELDS = [
  { name: 'numericValues', type: 'json', description: 'Final numeric settings used by adjudication, dice, DCs, modifiers, costs, cooldowns, durations, stack limits, etc.' },
  { name: 'textSettings', type: 'json', description: 'Optional non-numeric special settings produced by text quantification rules.' },
  { name: 'quantificationDefinition', type: 'json', description: 'User-defined fuzzy-text quantification fields, references, and rules used to create numericValues.' },
  { name: 'quantificationSourceText', type: 'text', description: 'Natural-language source text used for the latest quantification.' },
  { name: 'quantificationAudit', type: 'json', description: 'Latest quantification decisions for review and debugging.' },
  { name: 'quantificationUpdatedAt', type: 'text', description: 'Latest quantification timestamp.' }
];

export const EXTENSION_DATABASE_COMMON_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'User-defined category or subtype.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable description.' },
  { name: 'mechanicalEffect', type: 'text', description: 'Compact mechanical effect or prompt-ready rule.' },
  { name: 'prerequisites', type: 'json', description: 'Prerequisites, requirements, or unlock conditions.' },
  { name: 'grants', type: 'json', description: 'Granted skills, statuses, bonuses, resources, actions, or proficiencies.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, module, prompt, or homebrew reference.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS
];

export const CLASS_EXTENSION_FIELDS = [
  { name: 'tier', type: 'text', description: 'Class tier, archetype tier, or power band.' },
  { name: 'levelProgression', type: 'json', description: 'Level-by-level grants, features, resources, and numeric progression.' },
  { name: 'primaryAbilities', type: 'json', description: 'Primary abilities or attributes this class relies on.' },
  { name: 'hitDie', type: 'text', description: 'Optional HP/hit-die style marker, e.g. d6, d8, d10.' },
  { name: 'proficiencies', type: 'json', description: 'Weapon, armor, tool, save, or skill proficiencies.' },
  { name: 'resources', type: 'json', description: 'Class resources such as spell slots, stamina, rage, focus, or ki.' },
  { name: 'spellcasting', type: 'json', description: 'Optional magic/spellcasting progression and spell list references.' },
  { name: 'subclasses', type: 'json', description: 'Subclass, path, school, order, or specialization options.' },
  { name: 'startingEquipment', type: 'json', description: 'Starting equipment or kit options.' }
];

export const RACE_EXTENSION_FIELDS = [
  { name: 'lineageType', type: 'text', description: 'Race, ancestry, species, lineage, heritage, or culture marker.' },
  { name: 'abilityBonuses', type: 'json', description: 'Attribute bonuses, flexible boosts, or point-buy modifiers.' },
  { name: 'size', type: 'text', description: 'Size category or body-scale marker.' },
  { name: 'speed', type: 'json', description: 'Movement speeds such as walk, swim, climb, or fly.' },
  { name: 'languages', type: 'json', description: 'Known languages or communication modes.' },
  { name: 'vision', type: 'json', description: 'Darkvision, blindsight, scent, tremorsense, or custom perception traits.' },
  { name: 'resistances', type: 'json', description: 'Damage, condition, disease, charm, fear, or environmental resistances.' },
  { name: 'traits', type: 'json', description: 'Lineage features, cultural traits, or innate abilities.' },
  { name: 'variants', type: 'json', description: 'Subraces, cultures, bloodlines, or variant packages.' }
];

export const BACKGROUND_EXTENSION_FIELDS = [
  { name: 'origin', type: 'text', description: 'Origin, social role, profession, faction, or life path.' },
  { name: 'feature', type: 'json', description: 'Background feature, contact, shelter, privilege, or narrative hook.' },
  { name: 'skillOptions', type: 'json', description: 'Granted or selectable skills.' },
  { name: 'toolOptions', type: 'json', description: 'Granted or selectable tools, kits, crafts, or vehicles.' },
  { name: 'languages', type: 'json', description: 'Granted or selectable languages.' },
  { name: 'startingEquipment', type: 'json', description: 'Starting equipment, currency, documents, or keepsakes.' },
  { name: 'contacts', type: 'json', description: 'Allies, rivals, patrons, debts, or faction relationships.' },
  { name: 'hooks', type: 'json', description: 'Ideals, bonds, flaws, secrets, obligations, or unresolved plot hooks.' }
];

export const RELATIONSHIP_GRAPH_NODE_FIELDS = [
  { name: 'nodeId', type: 'text', description: 'Stable node id used by edges and memberships.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'nodeType', type: 'text', description: 'npc, player, faction, map, item, bloodline, organization, concept, event, custom, etc.' },
  { name: 'parentNodeId', type: 'text', description: 'Optional parent/container node id for hierarchy or containment.' },
  { name: 'status', type: 'text', description: 'active, hidden, archived, destroyed, dissolved, missing, dormant, etc.' },
  { name: 'visibility', type: 'text', description: 'known, public, suspected, hidden, secret, unknown, etc.' },
  { name: 'values', type: 'json', description: 'Optional numeric or symbolic state values for this node.' },
  { name: 'attributes', type: 'json', description: 'Domain-specific fields that future schemas can promote into first-class columns.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'summary', type: 'text', description: 'Short prompt-ready node summary.' },
  { name: 'publicNotes', type: 'text', description: 'Player-visible notes or rumors.' },
  { name: 'privateNotes', type: 'text', description: 'GM/agent-only notes; UI should filter this from player-visible output when needed.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt graph metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest graph update timestamp.' }
];

export const RELATIONSHIP_GRAPH_EDGE_FIELDS = [
  { name: 'fromNodeId', type: 'text', description: 'Source node id.' },
  { name: 'toNodeId', type: 'text', description: 'Target node id.' },
  { name: 'relationType', type: 'text', description: 'ally, enemy, contains, belongs_to, family, route, dependency, rivalry, trade, custom, etc.' },
  { name: 'label', type: 'text', description: 'Human-readable relation label.' },
  { name: 'direction', type: 'text', description: 'directed, undirected, mutual, parent_to_child, child_to_parent, etc.' },
  { name: 'weight', type: 'number', description: 'Generic relation strength, usually -100..100 or 0..100.' },
  { name: 'trust', type: 'number', description: 'Optional trust score.' },
  { name: 'tension', type: 'number', description: 'Optional tension or conflict score.' },
  { name: 'influence', type: 'number', description: 'Optional influence exerted through this relation.' },
  { name: 'familiarity', type: 'number', description: 'Optional familiarity or contact-depth score.' },
  { name: 'aspects', type: 'json', description: 'Multiple simultaneous aspects such as public alliance/private hostility, debt, blackmail, trade, kinship, route access.' },
  { name: 'sharedInterests', type: 'json', description: 'Reasons the nodes cooperate or align.' },
  { name: 'conflictingInterests', type: 'json', description: 'Reasons the nodes oppose or compete.' },
  { name: 'leverage', type: 'json', description: 'Blackmail, hostages, debts, secrets, supply chains, or social pressure.' },
  { name: 'dependencies', type: 'json', description: 'Mutual dependencies, prerequisites, containment, or shared-risk logic.' },
  { name: 'requirements', type: 'json', description: 'Keys, checks, permissions, resources, or narrative requirements for traversing/activating this relation.' },
  { name: 'conditions', type: 'json', description: 'Scene, time, weather, faction, status, or story conditions that affect this relation.' },
  { name: 'status', type: 'text', description: 'active, hidden, broken, archived, blocked, locked, severed, inactive, etc.' },
  { name: 'visibility', type: 'text', description: 'known, public, suspected, hidden, secret, unknown, etc.' },
  { name: 'evidence', type: 'text', description: 'Short evidence, source text, or audit note.' },
  { name: 'summary', type: 'text', description: 'Short prompt-ready edge summary.' },
  { name: 'tags', type: 'json', description: 'Edge tags.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt edge metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest graph update timestamp.' }
];

export const RELATIONSHIP_GRAPH_MEMBERSHIP_FIELDS = [
  { name: 'memberId', type: 'text', description: 'Actor, node, item, or concept id that belongs to a container node.' },
  { name: 'memberName', type: 'text', description: 'Display name for the member.' },
  { name: 'memberType', type: 'text', description: 'npc, player, faction, map, item, role, office, custom, etc.' },
  { name: 'containerNodeId', type: 'text', description: 'Faction, group, location, family, team, or parent node id.' },
  { name: 'role', type: 'text', description: 'Member role, office, cover identity, duty, route role, or relationship slot.' },
  { name: 'rank', type: 'text', description: 'Rank, title, authority band, or membership tier.' },
  { name: 'status', type: 'text', description: 'active, former, covert, coerced, infiltrator, traitor, dead, missing, etc.' },
  { name: 'loyalty', type: 'number', description: 'Optional loyalty score, usually -100..100 or 0..100.' },
  { name: 'influence', type: 'number', description: 'Optional member influence inside the container.' },
  { name: 'reasons', type: 'json', description: 'Why this membership exists, changed, or ended.' },
  { name: 'obligations', type: 'json', description: 'Duties, debts, oaths, leverage, or blackmail.' },
  { name: 'benefits', type: 'json', description: 'Benefits gained through membership or attachment.' },
  { name: 'visibility', type: 'text', description: 'known, public, suspected, hidden, secret, unknown, etc.' },
  { name: 'evidence', type: 'text', description: 'Short evidence, source text, or audit note.' },
  { name: 'summary', type: 'text', description: 'Short prompt-ready membership summary.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt membership metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest membership graph update timestamp.' }
];

export const EXTENSION_DATABASE_TEMPLATES = {
  class: createExtensionDatabaseTemplate({
    id: 'class',
    title: 'Class Database Template',
    description: 'Template-only schema for classes, jobs, archetypes, and progression packages.',
    aliases: ['classes', 'job', 'jobs', 'archetype', 'archetypes'],
    prefix: 'class',
    recordKey: 'classes',
    suggestedCollection: 'class_registry',
    fields: CLASS_EXTENSION_FIELDS,
    exampleRecord: {
      id: 'fighter',
      name: '战士',
      category: 'martial',
      primaryAbilities: ['str', 'dex', 'con'],
      hitDie: 'd10',
      proficiencies: { armor: ['light', 'medium', 'heavy'], weapons: ['simple', 'martial'] },
      levelProgression: [
        { level: 1, grants: ['second_wind'], numericValues: { proficiencyBonus: 2 } }
      ],
      resources: { secondWindUses: 1 }
    }
  }),
  race: createExtensionDatabaseTemplate({
    id: 'race',
    title: 'Race / Ancestry Database Template',
    description: 'Template-only schema for race, ancestry, species, lineage, heritage, or culture packages.',
    aliases: ['races', 'ancestry', 'ancestries', 'species', 'lineage', 'lineages', 'heritage', 'heritages'],
    prefix: 'race',
    recordKey: 'races',
    suggestedCollection: 'race_registry',
    fields: RACE_EXTENSION_FIELDS,
    exampleRecord: {
      id: 'moon_elf',
      name: '月精灵',
      lineageType: 'ancestry',
      abilityBonuses: { dex: 2, int: 1 },
      size: 'medium',
      speed: { walk: 30 },
      languages: ['common', 'elvish'],
      vision: { darkvisionFeet: 60 },
      traits: ['fey_ancestry', 'trance']
    }
  }),
  background: createExtensionDatabaseTemplate({
    id: 'background',
    title: 'Background Database Template',
    description: 'Template-only schema for backgrounds, origins, professions, factions, and life-path packages.',
    aliases: ['backgrounds', 'origin', 'origins', 'profession', 'professions', 'faction', 'factions'],
    prefix: 'background',
    recordKey: 'backgrounds',
    suggestedCollection: 'background_registry',
    fields: BACKGROUND_EXTENSION_FIELDS,
    exampleRecord: {
      id: 'street_urchin',
      name: '街头孤儿',
      origin: 'urban_survivor',
      skillOptions: ['sleight_of_hand', 'stealth'],
      toolOptions: ['disguise_kit', 'thieves_tools'],
      contacts: [{ type: 'ally', description: 'A child informant network in the old market.' }],
      hooks: ['owes_money_to_local_gang']
    }
  }),
  relationship_graph: createRelationshipGraphDatabaseTemplate(),
  visual_assets: createVisualAssetsDatabaseTemplate()
};

export function buildExtensionDatabaseFields(specificFields = []) {
  return [
    ...cloneJson(EXTENSION_DATABASE_COMMON_FIELDS),
    ...cloneJson(specificFields),
    ...cloneJson(EXTENSION_DATABASE_NUMERIC_SETTING_FIELDS),
    { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp if this template is later promoted to a registry.' }
  ];
}

export function extensionTemplateToRulePackTemplate(template) {
  const collections = Array.isArray(template.collections) ? cloneJson(template.collections) : undefined;
  const fields = cloneJson(template.fields || []);
  return {
    id: `${template.id}_database_schema`,
    name: template.title,
    category: 'databaseSchema',
    templateType: 'databaseSchema',
    status: 'active',
    tags: [...new Set(['database-schema', 'extension-database', 'mechanics', template.id, ...(template.tags || [])])],
    aliases: [...new Set([template.id, template.recordKey, template.suggestedCollection, ...(template.aliases || [])].filter(Boolean))],
    description: template.description,
    template: {
      templateId: template.id,
      collection: template.suggestedCollection,
      recordKey: template.recordKey,
      prefix: template.prefix,
      fields,
      fieldNames: cloneJson(template.fieldNames),
      collections,
      quantificationTemplate: cloneJson(template.quantificationTemplate),
      lifecycleDefaults: {
        lifecycleScope: 'character',
        lifecycleLevel: 'L1',
        lifecycleClonePolicy: 'copy_to_chat'
      }
    },
    schema: {
      type: 'object',
      anyOf: [
        { required: ['collection', 'fields'] },
        { required: ['collections'] }
      ],
      properties: {
        collection: { type: 'string' },
        recordKey: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              description: { type: 'string' },
              defaultValue: {}
            },
            additionalProperties: true
          }
        },
        collections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['role', 'fields'],
            properties: {
              role: { type: 'string' },
              collection: { type: 'string' },
              suggestedCollection: { type: 'string' },
              recordKey: { type: 'string' },
              suffix: { type: 'string' },
              idField: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string' },
                    description: { type: 'string' },
                    defaultValue: {}
                  },
                  additionalProperties: true
                }
              }
            },
            additionalProperties: true
          }
        }
      },
      additionalProperties: true
    },
    examples: [cloneJson(template.exampleRecord)],
    sourceRef: 'ai-dnd-built-in:extension-database-template',
    metadata: {
      builtIn: true,
      extensionDatabaseTemplate: true,
      multiCollectionDatabaseTemplate: Boolean(collections?.length),
      sourceTemplateId: template.id,
      suggestedCollection: template.suggestedCollection,
      managedBy: 'system.rule_packs'
    }
  };
}

function createRelationshipGraphDatabaseTemplate() {
  const collections = [
    createGraphCollectionTemplate({
      role: 'nodes',
      recordKey: 'nodes',
      suffix: 'nodes',
      suggestedCollection: 'relationship_graph_nodes',
      idField: 'nodeId',
      fields: RELATIONSHIP_GRAPH_NODE_FIELDS,
      exampleRecord: {
        id: 'node_old_watch',
        nodeId: 'node_old_watch',
        name: 'Old Watch',
        nodeType: 'faction',
        status: 'active',
        visibility: 'known',
        summary: 'A sample graph node used by the generic relationship graph template.'
      }
    }),
    createGraphCollectionTemplate({
      role: 'edges',
      recordKey: 'edges',
      suffix: 'edges',
      suggestedCollection: 'relationship_graph_edges',
      idField: 'id',
      fields: RELATIONSHIP_GRAPH_EDGE_FIELDS,
      exampleRecord: {
        id: 'edge_old_watch_old_gate',
        fromNodeId: 'node_old_watch',
        toNodeId: 'node_old_gate',
        relationType: 'guards',
        label: 'guards route',
        direction: 'directed',
        weight: 60,
        status: 'active',
        visibility: 'known',
        summary: 'The Old Watch controls access through the Old Gate.'
      }
    }),
    createGraphCollectionTemplate({
      role: 'memberships',
      recordKey: 'memberships',
      suffix: 'memberships',
      suggestedCollection: 'relationship_graph_memberships',
      idField: 'id',
      optional: true,
      fields: RELATIONSHIP_GRAPH_MEMBERSHIP_FIELDS,
      exampleRecord: {
        id: 'membership_watch_captain_old_watch',
        memberId: 'npc_watch_captain',
        memberName: 'Watch Captain',
        memberType: 'npc',
        containerNodeId: 'node_old_watch',
        role: 'captain',
        status: 'active',
        loyalty: 75,
        summary: 'The captain is an active officer of the Old Watch.'
      }
    })
  ];
  return {
    id: 'relationship_graph',
    title: 'Relationship Graph Database Template',
    description: 'Template-only multi-collection schema for future relationship graphs such as NPC networks, factions, map routes, bloodlines, trade webs, politics, or custom graph-like systems.',
    registered: false,
    templateOnly: true,
    collection: '',
    suggestedCollection: 'relationship_graph',
    recordKey: 'relationshipGraph',
    aliases: [
      'relationship_graphs',
      'relation_graph',
      'relation_graphs',
      'graph',
      'graphs',
      'node_edge_graph',
      'network',
      'networks',
      '关系图',
      '图谱'
    ],
    prefix: 'graph',
    tags: ['mechanics', 'relationship-graph', 'graph', 'network', 'template-only', 'extension-database'],
    fields: [],
    fieldNames: [],
    collections,
    exampleRecord: Object.fromEntries(collections.map((collection) => [
      collection.recordKey,
      [cloneJson(collection.exampleRecord)]
    ])),
    quantificationTemplate: {
      prompt: 'Use this template as a structural graph schema. Quantification is optional; prefer explicit numeric edge/node fields supplied by the user.',
      numericFields: [
        { name: 'weight', type: 'number', min: -100, max: 100, defaultValue: 0, description: 'Generic relation strength or route weight.' },
        { name: 'trust', type: 'number', min: -100, max: 100, defaultValue: 0, description: 'Optional trust score for social or political relations.' },
        { name: 'tension', type: 'number', min: 0, max: 100, defaultValue: 0, description: 'Optional conflict/tension score.' },
        { name: 'influence', type: 'number', min: -100, max: 100, defaultValue: 0, description: 'Optional influence score.' }
      ],
      referenceDocuments: []
    },
    notes: [
      'Template only. Use system.rule_packs.create_collection_from_template to create nodes/edges/memberships collections explicitly.',
      'Existing concrete NPC, faction, and map relationship graph modules remain the specialized runtime implementations.'
    ]
  };
}

function createVisualAssetsDatabaseTemplate() {
  const collections = [
    createGraphCollectionTemplate({
      role: 'assets',
      recordKey: 'assets',
      suffix: 'assets',
      suggestedCollection: 'visual_assets',
      idField: 'assetId',
      fields: VISUAL_ASSET_FIELDS,
      exampleRecord: {
        id: 'asset_mira_portrait',
        assetId: 'asset_mira_portrait',
        name: 'Mira Portrait Placeholder',
        assetType: 'image',
        uri: '',
        prompt: 'Portrait art direction for Mira, if generated later.',
        source: 'placeholder',
        status: 'draft',
        tags: ['npc', 'portrait']
      }
    }),
    createGraphCollectionTemplate({
      role: 'bindings',
      recordKey: 'bindings',
      suffix: 'bindings',
      suggestedCollection: 'visual_asset_bindings',
      idField: 'bindingId',
      fields: VISUAL_ASSET_BINDING_FIELDS,
      exampleRecord: {
        id: 'binding_mira_portrait',
        bindingId: 'binding_mira_portrait',
        targetType: 'npc',
        targetId: 'npc_mira',
        slot: 'portrait',
        assetId: 'asset_mira_portrait',
        priority: 100,
        conditions: {},
        status: 'active'
      }
    }),
    createGraphCollectionTemplate({
      role: 'eventBindings',
      recordKey: 'eventBindings',
      suffix: 'event_bindings',
      suggestedCollection: 'visual_event_bindings',
      idField: 'eventBindingId',
      fields: VISUAL_EVENT_BINDING_FIELDS,
      exampleRecord: {
        id: 'event_binding_d20_critical',
        eventBindingId: 'event_binding_d20_critical',
        eventType: 'dice_roll',
        slot: 'animation',
        assetId: 'asset_d20_critical_flash',
        priority: 100,
        conditions: { result: 'critical_success' },
        status: 'active'
      }
    })
  ];
  return {
    id: 'visual_assets',
    title: 'Visual Asset Binding Database Template',
    description: 'Template-only multi-collection schema for future images, animations, sounds, icons, sprites, videos, models, and event visual effects. It only stores references and bindings; rendering and generation are separate future systems.',
    registered: false,
    templateOnly: true,
    collection: '',
    suggestedCollection: 'visual_assets',
    recordKey: 'visualAssets',
    aliases: ['assets', 'asset_bindings', 'visuals', 'visual_asset_bindings', '图片绑定', '动画绑定', '资源绑定'],
    prefix: 'visual',
    tags: ['visual', 'asset', 'binding', 'template-only', 'extension-database'],
    fields: [],
    fieldNames: [],
    collections,
    exampleRecord: Object.fromEntries(collections.map((collection) => [
      collection.recordKey,
      [cloneJson(collection.exampleRecord)]
    ])),
    quantificationTemplate: {
      prompt: 'Visual asset bindings are references, not mechanics. Do not quantify unless the user adds custom numeric fields such as priority or duration.',
      numericFields: [
        { name: 'priority', type: 'integer', min: -1000, max: 1000, defaultValue: 0, description: 'Binding priority for resolving multiple visual assets.' }
      ],
      referenceDocuments: []
    },
    notes: [
      'Template only. Rendering, animation playback, asset generation, caching, and UI display are intentionally out of scope.',
      'Visual references must not become world facts. They are presentation hints resolved by system.visual.resolve_assets.'
    ]
  };
}

function createGraphCollectionTemplate({
  role,
  recordKey,
  suffix,
  suggestedCollection,
  idField,
  optional = false,
  fields = [],
  exampleRecord = {}
}) {
  return {
    role,
    recordKey,
    suffix,
    collection: suggestedCollection,
    suggestedCollection,
    idField,
    optional,
    fields: cloneJson(fields),
    fieldNames: fields.map((field) => field.name),
    exampleRecord: cloneJson(exampleRecord)
  };
}

function createExtensionDatabaseTemplate({
  id,
  title,
  description,
  aliases = [],
  prefix = '',
  recordKey = '',
  suggestedCollection = '',
  fields = [],
  exampleRecord = {},
  quantificationTemplate
}) {
  const fullFields = buildExtensionDatabaseFields(fields);
  return {
    id,
    title,
    description,
    registered: false,
    templateOnly: true,
    collection: '',
    suggestedCollection,
    recordKey,
    aliases,
    prefix,
    tags: ['mechanics', id, 'template-only', 'extension-database'],
    fields: fullFields,
    fieldNames: fullFields.map((field) => field.name),
    exampleRecord: cloneJson(exampleRecord),
    quantificationTemplate: cloneJson(quantificationTemplate || defaultQuantificationTemplate(id)),
    notes: ['Template only. Use system.rule_packs.create_collection_from_template to create a managed collection explicitly.']
  };
}

function defaultQuantificationTemplate(id) {
  return {
    prompt: `Quantify ${id} mechanics from fuzzy text using user-provided field references first.`,
    numericFields: [
      {
        name: 'powerScore',
        type: 'integer',
        min: 0,
        max: 10,
        defaultValue: 0,
        description: 'Optional generic power or impact score for debugging templates.'
      }
    ],
    referenceDocuments: []
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
