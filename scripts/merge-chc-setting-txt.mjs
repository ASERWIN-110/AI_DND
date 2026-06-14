#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = resolve(ROOT, 'chc/设定资料包_txt');
const DEFAULT_OUTPUT_PATH = resolve(ROOT, 'chc/AI_DND导入版存档latest/八荒RPG_最终设定存档.txt');

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const inputDir = resolve(ROOT, options.input || DEFAULT_INPUT_DIR);
  const outputPath = resolve(ROOT, options.output || DEFAULT_OUTPUT_PATH);
  const records = await collectTxtFiles(inputDir, outputPath, options);

  if (!records.length) {
    throw new Error(`No .txt files found in ${inputDir}`);
  }

  const archive = buildArchive({
    inputDir,
    outputPath,
    records,
    title: options.title || '八荒RPG 最终设定存档'
  });

  if (options.dryRun) {
    printDryRun({ inputDir, outputPath, records, archive });
    return;
  }

  if (!options.force) {
    await assertOutputDoesNotExist(outputPath);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive, 'utf8');

  console.log(`Merged ${records.length} files into ${relative(ROOT, outputPath)}`);
}

function parseArgs(args) {
  const options = {
    input: '',
    output: '',
    title: '',
    dryRun: false,
    force: false,
    noHash: false,
    requireNumericPrefix: true,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force' || arg === '-f') options.force = true;
    else if (arg === '--no-hash') options.noHash = true;
    else if (arg === '--allow-unprefixed') options.requireNumericPrefix = false;
    else if (arg === '--input' || arg === '-i') options.input = requireValue(args, ++index, arg);
    else if (arg === '--output' || arg === '-o') options.output = requireValue(args, ++index, arg);
    else if (arg === '--title' || arg === '-t') options.title = requireValue(args, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function collectTxtFiles(inputDir, outputPath, options) {
  const dirStat = await stat(inputDir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  const entries = await readdir(inputDir, { withFileTypes: true });
  const txtEntries = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => extname(entry.name).toLowerCase() === '.txt')
    .filter((entry) => resolve(inputDir, entry.name) !== outputPath)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));

  if (options.requireNumericPrefix) {
    const badNames = txtEntries
      .map((entry) => entry.name)
      .filter((name) => !/^\d{2}_/.test(name));
    if (badNames.length) {
      throw new Error([
        'All input files must start with a two-digit order prefix by default.',
        'Bad files:',
        ...badNames.map((name) => `- ${name}`),
        'Use --allow-unprefixed to merge them anyway.'
      ].join('\n'));
    }
  }

  const records = [];
  for (const entry of txtEntries) {
    const filePath = resolve(inputDir, entry.name);
    const content = normalizeText(await readFile(filePath, 'utf8'));
    records.push({
      name: entry.name,
      path: filePath,
      relativePath: relative(ROOT, filePath),
      lines: countLines(content),
      chars: content.length,
      sha256: options.noHash ? '' : sha256(content),
      content
    });
  }
  return records;
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function countLines(content) {
  if (!content) return 0;
  return content.split('\n').length;
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildArchive({ inputDir, outputPath, records, title }) {
  const now = new Date().toISOString();
  const sourceList = records.map((record, index) => {
    const hash = record.sha256 ? ` | sha256=${record.sha256}` : '';
    return `${index + 1}. ${record.name} | lines=${record.lines} | chars=${record.chars}${hash}`;
  });

  const toc = records.map((record, index) => `${index + 1}. ${stripPrefix(record.name)}`);
  const body = records.map((record, index) => formatSection(record, index + 1));

  return [
    `# ${title}`,
    '',
    '## 合并元数据',
    `生成时间：${now}`,
    `输入目录：${relative(ROOT, inputDir)}`,
    `输出文件：${relative(ROOT, outputPath)}`,
    `文件数量：${records.length}`,
    '合并规则：按文件名升序；保留每个源文件的边界、来源路径、行数、字符数和 sha256。',
    '',
    '## 文件目录',
    ...toc,
    '',
    '## 来源清单',
    ...sourceList,
    '',
    '## 正文',
    '',
    ...body
  ].join('\n');
}

function stripPrefix(name) {
  return basename(name, '.txt').replace(/^\d{2}_/, '');
}

function formatSection(record, order) {
  const hash = record.sha256 ? `sha256：${record.sha256}\n` : '';
  return [
    `===== BEGIN SOURCE ${String(order).padStart(2, '0')}: ${record.name} =====`,
    `source：${record.relativePath}`,
    `lines：${record.lines}`,
    `chars：${record.chars}`,
    hash.trimEnd(),
    '',
    record.content,
    '',
    `===== END SOURCE ${String(order).padStart(2, '0')}: ${record.name} =====`,
    ''
  ].filter((part) => part !== '').join('\n');
}

async function assertOutputDoesNotExist(outputPath) {
  const outputStat = await stat(outputPath).catch(() => null);
  if (outputStat) {
    throw new Error(`Output already exists: ${outputPath}\nUse --force to overwrite.`);
  }
}

function printDryRun({ inputDir, outputPath, records, archive }) {
  console.log(`Input: ${relative(ROOT, inputDir)}`);
  console.log(`Output: ${relative(ROOT, outputPath)}`);
  console.log(`Files: ${records.length}`);
  console.log(`Archive chars: ${archive.length}`);
  for (const record of records) {
    const hash = record.sha256 ? ` sha256=${record.sha256.slice(0, 12)}...` : '';
    console.log(`- ${record.name} lines=${record.lines} chars=${record.chars}${hash}`);
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/merge-chc-setting-txt.mjs [options]',
    '',
    'Options:',
    '  -i, --input <dir>       Input txt directory. Default: chc/设定资料包_txt',
    '  -o, --output <file>     Output merged txt. Default: chc/AI_DND导入版存档latest/八荒RPG_最终设定存档.txt',
    '  -t, --title <title>     Archive title.',
    '  --dry-run              Print merge plan without writing output.',
    '  -f, --force            Overwrite output file if it exists.',
    '  --no-hash              Omit per-file sha256 hashes.',
    '  --allow-unprefixed     Allow txt files without NN_ filename prefix.',
    '  -h, --help             Show this help.',
    '',
    'Examples:',
    '  node scripts/merge-chc-setting-txt.mjs --dry-run',
    '  node scripts/merge-chc-setting-txt.mjs --force',
    '  node scripts/merge-chc-setting-txt.mjs -i chc/设定资料包_txt -o chc/AI_DND导入版存档latest/八荒RPG_最终设定存档.txt'
  ].join('\n');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
