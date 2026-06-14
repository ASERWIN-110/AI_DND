import { readFile } from 'node:fs/promises';
import { AgentChatRuntime, MockChatProvider } from '../src/index.js';

const card = JSON.parse(await readFile(new URL('./characters/mira.card.json', import.meta.url), 'utf8'));

const runtime = new AgentChatRuntime({
  chatProvider: new MockChatProvider()
});

await runtime.ingestMemory({
  collection: 'campaign-default',
  sourceId: 'silvermist-primer',
  text: [
    '银雾港旧城区的钟楼地下有一条废弃排水道。',
    '潮工会曾经用三枚铜钥匙控制地下闸门。',
    '最近几个夜晚，居民听到钟楼下方传出铁链拖动声。'
  ].join('\n'),
  metadata: {
    kind: 'world'
  }
});

const session = await runtime.createSession({
  characterCard: card,
  userName: 'Player'
});

const result = await runtime.sendMessage(
  session.id,
  '我靠近钟楼的青铜门，先听里面有没有铁链声。'
);

console.log(result.assistantMessage.content);
console.log('\nPrompt itemization:');
console.table(result.prompt.itemization);

