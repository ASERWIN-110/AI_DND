#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT, 'dist');
const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const options = parseArgs(process.argv.slice(2));
const packageSuffix = options.includeNodeModules ? '-full' : '';
const PACKAGE_BASENAME = `${sanitizeName(packageJson.name || 'ai-dnd')}-${packageJson.version || '0.0.0'}${packageSuffix}`;
const STAGING_DIR = resolve(DIST_DIR, PACKAGE_BASENAME);
const ZIP_PATH = resolve(DIST_DIR, `${PACKAGE_BASENAME}.zip`);
const TGZ_PATH = resolve(DIST_DIR, `${PACKAGE_BASENAME}.tar.gz`);
let CRC_TABLE;

runBuild();

const COPY_ENTRIES = [
  'chc/AI_DND导入版存档latest',
  'examples',
  'launchers',
  'manuals',
  'public',
  'scripts',
  'src',
  'package-lock.json',
  'package.json',
  'quick-start.cmd',
  'quick-start.command',
  'quick-start.sh',
  'tsconfig.json'
];

const EXCLUDE_NAMES = new Set([
  '.DS_Store',
  '.git',
  '.npm-cache',
  '.npm-tmp',
  '.playwright-cli',
  '.runtime',
  'coverage',
  'data',
  'dist',
  'node_modules',
  'tmp'
]);

if (options.includeNodeModules) {
  COPY_ENTRIES.push('node_modules');
  EXCLUDE_NAMES.delete('node_modules');
}

await rm(STAGING_DIR, { recursive: true, force: true });
await rm(ZIP_PATH, { force: true });
await rm(TGZ_PATH, { force: true });
await mkdir(STAGING_DIR, { recursive: true });

for (const entry of COPY_ENTRIES) {
  const source = resolve(ROOT, entry);
  if (!(await exists(source))) continue;
  const target = resolve(STAGING_DIR, entry);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (sourcePath) => !shouldExclude(sourcePath)
  });
}

await copyBuildEntry('src', 'build/src');
await copyBuildEntry('public', 'build/public');

await writeFile(resolve(STAGING_DIR, 'START_HERE.txt'), startHereText(), 'utf8');
await chmodIfExists(resolve(STAGING_DIR, 'quick-start.sh'), 0o755);
await chmodIfExists(resolve(STAGING_DIR, 'quick-start.command'), 0o755);
await chmodIfExists(resolve(STAGING_DIR, 'launchers', 'start-linux.sh'), 0o755);
await chmodIfExists(resolve(STAGING_DIR, 'launchers', 'start-macos.command'), 0o755);

const files = await listFiles(STAGING_DIR);
await writeZip(ZIP_PATH, STAGING_DIR, files);
await writeTarGz(TGZ_PATH, STAGING_DIR, files);

const zipSize = await fileSize(ZIP_PATH);
const tgzSize = await fileSize(TGZ_PATH);

console.log(`AI DND ${options.includeNodeModules ? 'full' : 'source'} release package created.`);
console.log(`Folder: ${relative(ROOT, STAGING_DIR)}`);
console.log(`ZIP:    ${relative(ROOT, ZIP_PATH)} (${formatBytes(zipSize)})`);
console.log(`TAR.GZ: ${relative(ROOT, TGZ_PATH)} (${formatBytes(tgzSize)})`);

function parseArgs(args) {
  const parsed = { includeNodeModules: false };
  for (const arg of args) {
    if (arg === '--include-node-modules' || arg === '--full') {
      parsed.includeNodeModules = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/package-release.mjs [--include-node-modules]

Options:
  --include-node-modules, --full  Bundle installed npm dependencies into the package.
  -h, --help                     Show this help text.
`);
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

function sanitizeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ai-dnd';
}

function shouldExclude(sourcePath) {
  const rel = relative(ROOT, sourcePath);
  if (!rel || rel.startsWith('..')) return false;
  return shouldExcludeParts(rel.split(sep));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function chmodIfExists(path, mode) {
  if (await exists(path)) await chmod(path, mode);
}

async function listFiles(root) {
  const output = [];
  await walk(root);
  output.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
  return output;

  async function walk(dir) {
    for (const dirent of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, dirent.name);
      const rel = relative(root, fullPath);
      if (shouldExcludeParts(rel.split(sep))) continue;
      if (dirent.isDirectory()) {
        await walk(fullPath);
      } else if (dirent.isFile()) {
        const archivePath = `${PACKAGE_BASENAME}/${toPosix(relative(root, fullPath))}`;
        output.push({ fullPath, archivePath, stat: await stat(fullPath) });
      }
    }
  }
}

function shouldExcludeParts(parts) {
  if (parts.some((part) => part === '.DS_Store')) return true;
  if (parts[0] === 'node_modules') {
    if (!options.includeNodeModules) return true;
    if (isDevOnlyNodeModule(parts)) return true;
    return parts.some((part) => part === '.git');
  }
  return EXCLUDE_NAMES.has(parts[0]);
}

function isDevOnlyNodeModule(parts) {
  const packageName = parts[1] || '';
  if (['tsx', 'typescript', 'esbuild'].includes(packageName)) return true;
  if (packageName === '@esbuild' || packageName === '@types') return true;
  return false;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function startHereText() {
  return `AI DND ${packageJson.version || ''}

Requirements:
  Node.js 24 or newer, or network access for first-run local Node.js setup.

Windows Node update:
  Check your version with node -v. If it prints v22.x or lower, update Node.js itself.
  Recommended: install the Node.js 24+ Windows Installer from https://nodejs.org/.
  Do not use npm install -g npm for this project.

Automatic local Node setup:
  If Node.js 24+ is missing, or .runtime/node belongs to a different OS/CPU,
  the launcher downloads the official Node.js 24 package for the current platform
  into .runtime/node inside this folder and runs the app with that local node.
  It does not install Node globally.

Quick start:
  Windows: double-click quick-start.cmd or launchers\\start-windows.cmd
  macOS:   double-click quick-start.command or launchers/start-macos.command
  Linux:   run ./quick-start.sh or ./launchers/start-linux.sh

Dependency mode:
  Source package: installs npm dependencies inside this folder when node_modules is missing.
                  If node_modules was copied from another OS, delete node_modules
                  and launch again to reinstall locally.
                  npm cache and temp files stay under .npm-cache/ and .npm-tmp/.
  Full package:   includes node_modules and normally starts without npm install.
                  Release startup uses prebuilt JS under build/, so copied
                  platform-specific TypeScript/esbuild dev tools are not needed.

Default URLs:
  Chat:         http://127.0.0.1:8787/
  Tool Manager: http://127.0.0.1:8787/tool-manager/

Included CHC import bundle:
  chc/AI_DND导入版存档latest/八荒RPG_最终导入存档.bundle.json

Phone / Tailscale access:
  Run quick-start with --tailscale --no-open, then open the printed
  http://<computer-ip>:8787/ URL on the phone.
`;
}

function runBuild() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_update_notifier: 'false'
    }
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function copyBuildEntry(sourceEntry, targetEntry) {
  const source = resolve(DIST_DIR, sourceEntry);
  if (!(await exists(source))) return;
  const target = resolve(STAGING_DIR, targetEntry);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith('.DS_Store')
  });
}

async function writeZip(outputPath, baseDir, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await readFile(entry.fullPath);
    const name = Buffer.from(entry.archivePath, 'utf8');
    const crc = crc32(data);
    const { dosTime, dosDate } = dosTimestamp(entry.stat.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((unixMode(entry.fullPath, entry.stat) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);

    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(outputPath, Buffer.concat([...chunks, ...central, end]));
}

function unixMode(path, stats) {
  if (path.endsWith('.sh') || path.endsWith('.command')) return 0o100755;
  return 0o100000 | (stats.mode & 0o777);
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function crc32(buffer) {
  CRC_TABLE ||= buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

async function writeTarGz(outputPath, baseDir, entries) {
  await mkdir(dirname(outputPath), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const out = createWriteStream(outputPath);
  gzip.pipe(out);

  for (const entry of entries) {
    const data = await readFile(entry.fullPath);
    gzip.write(tarHeader(entry.archivePath, data.length, entry.stat));
    gzip.write(data);
    const remainder = data.length % 512;
    if (remainder) gzip.write(Buffer.alloc(512 - remainder));
  }
  gzip.write(Buffer.alloc(1024));
  gzip.end();

  await new Promise((resolvePromise, rejectPromise) => {
    out.on('finish', resolvePromise);
    out.on('error', rejectPromise);
    gzip.on('error', rejectPromise);
  });
}

function tarHeader(path, size, stats) {
  const header = Buffer.alloc(512, 0);
  const name = Buffer.from(path, 'utf8');
  if (name.length > 100) {
    const split = splitTarPath(path);
    writeString(header, split.name, 0, 100);
    writeString(header, split.prefix, 345, 155);
  } else {
    writeString(header, path, 0, 100);
  }
  writeOctal(header, unixMode(path, stats) & 0o777, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor(stats.mtimeMs / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 'ustar', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, 'user', 265, 32);
  writeString(header, 'group', 297, 32);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeOctal(header, checksum, 148, 8);
  return header;
}

function splitTarPath(path) {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join('/');
    const name = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name };
  }
  throw new Error(`Path too long for tar archive: ${path}`);
}

function writeString(buffer, value, offset, length) {
  const bytes = Buffer.from(String(value), 'utf8');
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, '0').slice(-(length - 1));
  buffer.write(text, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

async function fileSize(path) {
  return (await stat(path)).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
