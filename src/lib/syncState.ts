// Shared write-lock: prevents doFullSync from overwriting in-flight push operations
let _writeCount = 0;
let _lastWriteAt = 0;

export function markWriteStart() {
  _writeCount++;
  _lastWriteAt = Date.now();
}

export function markWriteEnd() {
  _writeCount = Math.max(0, _writeCount - 1);
  _lastWriteAt = Date.now();
}

export function isWriteInProgress() {
  return _writeCount > 0;
}

export function getLastWriteAt() {
  return _lastWriteAt;
}

