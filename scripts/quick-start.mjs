#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT || 8787);
const NODE_MAJOR_MIN = 24;
const NODE_BOOTSTRAP_ENV = 'AI_DND_NODE_BOOTSTRAPPED';

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message || String(error));
  console.error('Run with --help for usage.');
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

await ensureCompatibleNodeRuntime();
assertNodeVersion();

if (options.install && dependenciesMissing({
  sourceMode: options.source || !hasCompiledServer()
})) {
  runNpmInstall();
}

const serverCommand = resolveServerCommand(options);

const port = await resolvePort(options.host, options.port, options.portExplicit);
const browserHost = ['0.0.0.0', '::'].includes(options.host) ? '127.0.0.1' : options.host;
const baseUrl = `http://${browserHost}:${port}/`;
const urls = {
  chat: baseUrl,
  manager: `${baseUrl}tool-manager/`
};
const networkUrls = isWildcardHost(options.host) ? discoverNetworkUrls(port) : [];

console.log('');
console.log('AI DND quick start');
console.log(`Chat:         ${urls.chat}`);
console.log(`Tool Manager: ${urls.manager}`);
if (networkUrls.length) {
  console.log('Other devices:');
  for (const url of networkUrls) console.log(`  ${url}`);
} else if (isWildcardHost(options.host)) {
  console.log(`Other devices: open http://<this-computer-tailscale-or-lan-ip>:${port}/`);
}
console.log('Press Ctrl+C to stop.');
console.log('');

const server = spawn(process.execPath, serverCommand.args, {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: options.host,
    PORT: String(port)
  },
  stdio: 'inherit'
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.kill(signal);
  });
}

server.on('exit', (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});

const ready = await waitForServer(urls.chat, 15000);
if (ready && options.open !== 'none') {
  openUrl(urls[options.open] || urls.manager);
}

function parseArgs(argv) {
  const parsed = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    portExplicit: false,
    install: true,
    open: 'manager',
    source: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--no-open') parsed.open = 'none';
    else if (arg === '--skip-install') parsed.install = false;
    else if (arg === '--source' || arg === '--dev-source') parsed.source = true;
    else if (arg === '--public' || arg === '--lan' || arg === '--tailscale') parsed.host = '0.0.0.0';
    else if (arg === '--host') parsed.host = String(argv[++index] || parsed.host);
    else if (arg.startsWith('--host=')) parsed.host = arg.slice('--host='.length) || parsed.host;
    else if (arg === '--port') {
      parsed.port = parsePort(argv[++index]);
      parsed.portExplicit = true;
    } else if (arg.startsWith('--port=')) {
      parsed.port = parsePort(arg.slice('--port='.length));
      parsed.portExplicit = true;
    } else if (arg === '--open') {
      parsed.open = normalizeOpenTarget(argv[++index]);
    } else if (arg.startsWith('--open=')) {
      parsed.open = normalizeOpenTarget(arg.slice('--open='.length));
    } else {
      throw new Error(`Unknown quick-start option: ${arg}`);
    }
  }
  return parsed;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function normalizeOpenTarget(value) {
  const target = String(value || 'manager').toLowerCase();
  if (['chat', 'manager', 'none'].includes(target)) return target;
  throw new Error(`Invalid --open target: ${value}. Use chat, manager, or none.`);
}

function isWildcardHost(host) {
  return ['0.0.0.0', '::'].includes(String(host || '').trim());
}

function discoverNetworkUrls(port) {
  const addresses = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.address) continue;
      if (!isLikelyRemoteReachableAddress(entry.address, name)) continue;
      addresses.push({ name, address: entry.address });
    }
  }
  return addresses
    .sort((a, b) => networkAddressRank(a) - networkAddressRank(b) || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((entry) => `http://${entry.address}:${port}/ (${entry.name})`);
}

function isLikelyRemoteReachableAddress(address, interfaceName = '') {
  const [a, b] = address.split('.').map((part) => Number(part));
  if (isReservedLocalAddress(a, b)) return false;
  if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return /tail|tailscale|utun|tun|wg|en|eth|wlan|wi-fi/i.test(interfaceName);
}

function isReservedLocalAddress(a, b) {
  if (a === 0 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function networkAddressRank(entry) {
  const [a, b] = entry.address.split('.').map((part) => Number(part));
  if (a === 100 && b >= 64 && b <= 127) return 0;
  if (/tail|tailscale/i.test(entry.name)) return 0;
  if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return 1;
  return 2;
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < NODE_MAJOR_MIN) {
    console.error(`Node ${NODE_MAJOR_MIN}+ is required. Current version: ${process.version}`);
    console.error('Automatic local Node.js setup failed. Install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }
}

async function ensureCompatibleNodeRuntime() {
  if (isCurrentNodeOk()) return;
  if (process.env[NODE_BOOTSTRAP_ENV] === '1') return;

  const localNode = runtimeNodePath();
  if (!isNodeExecutableOk(localNode)) {
    await installLocalNode();
  }

  if (!isNodeExecutableOk(localNode)) {
    console.error(`Node ${NODE_MAJOR_MIN}+ is required. Current version: ${process.version}`);
    console.error('Could not configure a compatible local Node.js runtime under .runtime/node.');
    console.error('Install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }

  respawnWithNode(localNode);
}

function isCurrentNodeOk() {
  const major = Number(process.versions.node.split('.')[0]);
  return Number.isInteger(major) && major >= NODE_MAJOR_MIN;
}

function runtimeNodePath() {
  return resolve(ROOT, '.runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
}

function runtimeBinDirectory() {
  return dirname(runtimeNodePath());
}

function isNodeExecutableOk(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  const result = spawnSync(candidate, [
    '-p',
    `Number(process.versions.node.split(".")[0]) >= ${NODE_MAJOR_MIN} ? "ok" : "old"`
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && String(result.stdout || '').trim() === 'ok';
}

async function installLocalNode() {
  if (process.platform === 'win32') {
    installLocalNodeWindows();
    return;
  }

  const platform = detectNodePackagePlatform();
  if (!platform) {
    console.error(`Unsupported platform for automatic Node.js setup: ${process.platform} ${process.arch}`);
    console.error('Install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }

  if (!commandExists('tar')) {
    console.error('Node.js 24+ is required and tar is not available to extract it.');
    console.error('Install tar, or install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }

  mkdirSync(resolve(ROOT, '.runtime', 'downloads'), { recursive: true });
  const manifestUrl = 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt';
  console.log(`Configuring local Node.js ${NODE_MAJOR_MIN}+ for ${platform} under .runtime/node...`);
  const manifest = await readUrlText(manifestUrl);
  const escapedPlatform = platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = manifest.match(new RegExp(`node-v24\\.[^\\s]+-${escapedPlatform}\\.tar\\.gz`));
  if (!match) {
    console.error(`Could not find a Node.js package for ${platform} in ${manifestUrl}`);
    process.exit(1);
  }

  const file = match[0];
  const archive = resolve(ROOT, '.runtime', 'downloads', file);
  const tmpDir = resolve(ROOT, '.runtime', 'node.tmp');
  const runtimeDir = resolve(ROOT, '.runtime', 'node');
  const url = `https://nodejs.org/dist/latest-v24.x/${file}`;

  await downloadFile(url, archive);
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const extracted = spawnSync('tar', ['-xzf', archive, '-C', tmpDir, '--strip-components=1'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (extracted.status !== 0) {
    process.exit(extracted.status || 1);
  }
  renameSync(tmpDir, runtimeDir);
}

function installLocalNodeWindows() {
  const script = resolve(ROOT, 'scripts', 'bootstrap-node.ps1');
  if (!existsSync(script)) {
    console.error('Node.js 24+ is required and scripts/bootstrap-node.ps1 is missing.');
    process.exit(1);
  }
  const shell = commandExists('powershell') ? 'powershell' : (commandExists('powershell.exe') ? 'powershell.exe' : '');
  if (!shell) {
    console.error('Node.js 24+ is required, and PowerShell is not available to configure a local Node.js runtime.');
    console.error('Install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }
  const result = spawnSync(shell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Root',
    ROOT
  ], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function detectNodePackagePlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  return '';
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(probe, args, {
    shell: process.platform !== 'win32',
    stdio: 'ignore'
  });
  return result.status === 0;
}

async function readUrlText(url) {
  if (typeof fetch === 'function') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to read ${url}: ${response.status}`);
    return response.text();
  }
  const result = spawnSync('curl', ['-fsSL', url], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result.stdout;
}

async function downloadFile(url, destination) {
  if (commandExists('curl')) {
    const result = spawnSync('curl', ['-fL', url, '-o', destination], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
    return;
  }
  if (typeof fetch !== 'function') {
    console.error('Node.js 24+ is required and curl is not available to download it.');
    console.error('Install curl, or install Node.js 24+ from https://nodejs.org/ and run quick start again.');
    process.exit(1);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function respawnWithNode(nodeExe) {
  const env = {
    ...process.env,
    [NODE_BOOTSTRAP_ENV]: '1',
    PATH: `${runtimeBinDirectory()}${delimiter}${process.env.PATH || ''}`
  };
  const result = spawnSync(nodeExe, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: ROOT,
    env,
    stdio: 'inherit'
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 0);
}

function dependenciesMissing({ sourceMode = !hasCompiledServer() } = {}) {
  if (!sourceMode) {
    return !existsSync(resolve(ROOT, 'node_modules', 'ajv', 'package.json'));
  }
  return !existsSync(resolve(ROOT, 'node_modules', 'ajv', 'package.json'))
    || !existsSync(resolve(ROOT, 'node_modules', 'tsx', 'package.json'))
    || sourceNativeDependencyMismatch();
}

function sourceNativeDependencyMismatch() {
  if (!existsSync(resolve(ROOT, 'node_modules', 'esbuild', 'package.json'))) return false;
  const esbuildPackage = esbuildOptionalPackageName();
  if (!esbuildPackage) return false;
  return !existsSync(resolve(ROOT, 'node_modules', '@esbuild', esbuildPackage, 'package.json'));
}

function esbuildOptionalPackageName() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'win32' && process.arch === 'arm64') return 'win32-arm64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
  return '';
}

function hasCompiledServer() {
  return existsSync(resolve(ROOT, 'build', 'src', 'server.js'))
    || existsSync(resolve(ROOT, 'dist', 'src', 'server.js'));
}

function resolveServerCommand({ source = false } = {}) {
  const sourceServer = resolve(ROOT, 'src', 'server.ts');
  if (source && existsSync(sourceServer)) {
    return {
      mode: 'tsx',
      args: ['--import', 'tsx', sourceServer]
    };
  }
  const packageBuiltServer = resolve(ROOT, 'build', 'src', 'server.js');
  if (existsSync(packageBuiltServer)) {
    return {
      mode: 'compiled-package',
      args: [packageBuiltServer]
    };
  }
  const builtServer = resolve(ROOT, 'dist', 'src', 'server.js');
  if (existsSync(builtServer)) {
    return {
      mode: 'compiled',
      args: [builtServer]
    };
  }
  if (existsSync(sourceServer)) {
    return {
      mode: 'tsx',
      args: ['--import', 'tsx', sourceServer]
    };
  }
  console.error('Could not find build/src/server.js, dist/src/server.js, or src/server.ts.');
  process.exit(1);
}

function runNpmInstall() {
  const npm = resolve(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmCommand = existsSync(npm) ? npm : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmCache = resolve(ROOT, '.npm-cache');
  const npmTemp = resolve(ROOT, '.npm-tmp');
  mkdirSync(npmCache, { recursive: true });
  mkdirSync(npmTemp, { recursive: true });

  console.log('Installing local dependencies in this project directory only...');
  const result = spawnSync(npmCommand, [
    'install',
    '--prefix',
    ROOT,
    '--cache',
    npmCache,
    '--no-audit',
    '--no-fund',
    '--no-progress'
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      npm_config_global: 'false',
      npm_config_update_notifier: 'false',
      TMPDIR: npmTemp,
      TMP: npmTemp,
      TEMP: npmTemp
    },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function resolvePort(host, desiredPort, explicit) {
  if (await isPortFree(host, desiredPort)) return desiredPort;
  if (explicit) {
    console.error(`Port ${desiredPort} is already in use.`);
    process.exit(1);
  }
  for (let port = desiredPort + 1; port <= desiredPort + 20; port += 1) {
    if (await isPortFree(host, port)) return port;
  }
  console.error(`No free port found from ${desiredPort} to ${desiredPort + 20}.`);
  process.exit(1);
}

function isPortFree(host, port) {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once('error', () => resolveFree(false));
    probe.once('listening', () => {
      probe.close(() => resolveFree(true));
    });
    probe.listen(port, host);
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Server is still starting.
    }
    await delay(300);
  }
  console.warn(`Server did not respond within ${timeoutMs}ms. If startup continues, open ${url} manually.`);
  return false;
}

function openUrl(url) {
  const command = openCommand(url);
  if (!command) return;
  try {
    const child = spawn(command.cmd, command.args, {
      stdio: 'ignore',
      detached: true
    });
    child.on('error', () => {
      console.warn(`Could not open browser automatically. Open ${url} manually.`);
    });
    child.unref();
  } catch {
    console.warn(`Could not open browser automatically. Open ${url} manually.`);
  }
}

function openCommand(url) {
  if (process.platform === 'darwin') return { cmd: 'open', args: [url] };
  if (process.platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  return { cmd: 'xdg-open', args: [url] };
}

function printHelp() {
  console.log(`AI DND quick start

Usage:
  npm run quickstart -- [options]
  ./quick-start.sh [options]
  quick-start.cmd [options]

Options:
  --host <host>          Bind host. Default: ${DEFAULT_HOST}
  --public, --lan,
  --tailscale            Bind 0.0.0.0 for phone/LAN/Tailscale access
  --port <port>          Bind port. Default: ${DEFAULT_PORT}
  --open <target>        Open chat, manager, or none. Default: manager
  --no-open              Do not open a browser
  --skip-install         Do not run local npm install when node_modules is missing
  --source               Run src/server.ts through tsx instead of prebuilt JS
  -h, --help             Show this help
`);
}
