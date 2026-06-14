// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocuments, evaluateRagRetrieval, RagService } from '../src/index.js';

test('ingests and retrieves related Chinese text', async () => {
  const rag = new RagService({ chunkSize: 80, overlap: 10 });

  await rag.ingestText({
    sourceId: 'world',
    text: '钟楼地下有废弃排水道。银雾港的潮工会留下了三枚铜钥匙。'
  });

  const hits = await rag.retrieve({
    query: '我想调查钟楼和铜钥匙',
    minScore: 0
  });

  assert.ok(hits.length > 0);
  assert.match(hits[0].text, /钟楼|铜钥匙/);
});

test('filters retrieved chunks by metadata', async () => {
  const rag = new RagService();

  await rag.ingestText({
    sourceId: 'world-a',
    text: '钟楼下面有铜钥匙。',
    metadata: { kind: 'world' }
  });
  await rag.ingestText({
    sourceId: 'rule-a',
    text: '检定使用一枚二十面骰。',
    metadata: { kind: 'rules' }
  });

  const hits = await rag.retrieve({
    query: '钟楼 钥匙',
    minScore: -1,
    filter: { kind: 'world' }
  });

  assert.ok(hits.length > 0);
  assert.equal(hits.every((hit) => hit.metadata.kind === 'world'), true);
});

test('markdown and structured chunking preserve source references', async () => {
  const markdownChunks = chunkDocuments('# 钟楼\n地下有银钥匙。\n\n## 男爵\n男爵不知道密道。', {
    format: 'markdown',
    chunking: 'markdown'
  });
  assert.equal(markdownChunks.length, 2);
  assert.equal(markdownChunks[0].metadata.heading, '钟楼');

  const structuredChunks = chunkDocuments(JSON.stringify({
    database: 'global-data',
    collections: [
      {
        collection: 'npc_registry',
        records: [
          { id: 'npc_mira', data: { id: 'npc_mira', name: '米拉', summary: '知道银钥匙。' } }
        ]
      }
    ]
  }), {
    format: 'json',
    chunking: 'database'
  });
  assert.equal(structuredChunks.length, 1);
  assert.equal(structuredChunks[0].metadata.sourceCollection, 'npc_registry');
  assert.equal(structuredChunks[0].metadata.recordId, 'npc_mira');

  const fieldChunks = chunkDocuments(JSON.stringify({
    collections: [
      {
        collection: 'npc_profiles',
        records: [
          {
            id: 'npc_mira',
            data: {
              id: 'npc_mira',
              secret: '米拉知道钟楼密门需要银钥匙，并且男爵巡逻队正在寻找这条路。'
            }
          }
        ]
      }
    ]
  }), {
    format: 'json',
    chunking: 'database'
  });
  assert.ok(fieldChunks.some((chunk) => chunk.metadata.fieldPath === '$.secret'));
});

test('hybrid retrieval returns compact hits, source refs, and score breakdowns', async () => {
  const rag = new RagService({ chunkSize: 120, overlap: 10 });

  await rag.ingestText({
    collection: 'lore',
    sourceId: 'mira-profile',
    text: JSON.stringify({
      database: 'global-data',
      collections: [
        {
          collection: 'npc_profiles',
          records: [
            { id: 'npc_mira', data: { id: 'npc_mira', name: '米拉', secret: '钟楼密门需要银钥匙。' } }
          ]
        }
      ]
    }),
    format: 'json',
    chunking: 'database',
    metadata: { sourceKind: 'database' }
  });

  const hits = await rag.retrieve({
    collection: 'lore',
    query: 'npc_mira 银钥匙',
    mode: 'hybrid',
    minScore: 0
  });

  assert.ok(hits.length > 0);
  assert.equal(hits[0].metadata.recordId, 'npc_mira');
  assert.equal(hits[0].sourceRef.recordId, 'npc_mira');
  assert.ok(hits[0].compact.claim);
  assert.equal(typeof hits[0].scores.keyword, 'number');
  assert.equal(hits[0].metadata.embeddingProvider, 'hash');
  assert.match(hits[0].metadata.embeddingVersion, /hash/);
});

test('rag evaluation reports recall and precision for expected hits', async () => {
  const rag = new RagService({ chunkSize: 120, overlap: 10 });
  await rag.ingestText({
    collection: 'lore',
    sourceId: 'mira-profile',
    text: JSON.stringify({
      collections: [
        {
          collection: 'npc_profiles',
          records: [
            { id: 'npc_mira', data: { id: 'npc_mira', name: '米拉', secret: '银钥匙打开钟楼密门。' } }
          ]
        }
      ]
    }),
    format: 'json',
    chunking: 'database'
  });

  const evaluated = await evaluateRagRetrieval({
    ragService: rag,
    collection: 'lore',
    cases: [
      {
        id: 'silver-key',
        query: '谁知道银钥匙和钟楼密门',
        expected: ['npc_mira']
      }
    ],
    limit: 3,
    minScore: 0
  });

  assert.equal(evaluated.total, 1);
  assert.equal(evaluated.passed, 1);
  assert.equal(evaluated.results[0].matched.includes('npc_mira'), true);
});

test('reindex recomputes vectors while preserving documents', async () => {
  const rag = new RagService({ chunkSize: 80, overlap: 10 });
  await rag.ingestText({
    collection: 'lore',
    sourceId: 'world',
    text: '旧市场钟楼有银钥匙。'
  });

  const reindexed = await rag.reindexCollection({ collection: 'lore' });
  assert.equal(reindexed.reindexedDocuments, 1);

  const docs = rag.listDocuments({ collection: 'lore' }).documents;
  assert.equal(docs.length, 1);
  assert.ok(docs[0].metadata.reindexedAt);
});
