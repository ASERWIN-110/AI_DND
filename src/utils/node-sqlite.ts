// @ts-nocheck
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqliteModule;

export function getDatabaseSync() {
  sqliteModule ||= loadNodeSqlite();
  return sqliteModule.DatabaseSync;
}

function loadNodeSqlite() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarningExceptNodeSqlite(warning, ...args) {
    if (isNodeSqliteExperimentalWarning(warning, args[0])) {
      return;
    }
    return originalEmitWarning.call(process, warning, ...args);
  };

  try {
    return require('node:sqlite');
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function isNodeSqliteExperimentalWarning(warning, warningTypeOrOptions) {
  const message = typeof warning === 'string'
    ? warning
    : String(warning?.message || '');
  const type = typeof warningTypeOrOptions === 'string'
    ? warningTypeOrOptions
    : warningTypeOrOptions?.type || warning?.name;

  return type === 'ExperimentalWarning'
    && message.includes('SQLite is an experimental feature');
}
