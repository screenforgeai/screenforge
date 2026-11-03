const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function listDescendantPids(rootPid) {
  const { stdout } = await execFileAsync('ps', ['-Ao', 'pid=,ppid=']);
  const childrenByParent = new Map();

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [pidValue, parentValue] = trimmed.split(/\s+/);
    const pid = Number(pidValue);
    const parentPid = Number(parentValue);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) {
      continue;
    }

    const siblings = childrenByParent.get(parentPid) ?? [];
    siblings.push(pid);
    childrenByParent.set(parentPid, siblings);
  }

  const descendants = [];
  const queue = [...(childrenByParent.get(rootPid) ?? [])];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid || descendants.includes(pid)) {
      continue;
    }

    descendants.push(pid);
    queue.push(...(childrenByParent.get(pid) ?? []));
  }

  return descendants;
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateProcessTree(rootPid, options = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return;
  }

  const graceMs = options.graceMs ?? 5_000;
  const forceMs = options.forceMs ?? 1_500;
  const descendants = await listDescendantPids(rootPid).catch(() => []);
  const orderedPids = [...descendants.reverse(), rootPid];

  for (const pid of orderedPids) {
    signalPid(pid, 'SIGTERM');
  }

  const graceDeadline = Date.now() + graceMs;
  while (Date.now() < graceDeadline) {
    const alive = orderedPids.filter(pidExists);
    if (alive.length === 0) {
      return;
    }
    await delay(100);
  }

  const stubbornPids = orderedPids.filter(pidExists);
  for (const pid of stubbornPids) {
    signalPid(pid, 'SIGKILL');
  }

  const forceDeadline = Date.now() + forceMs;
  while (Date.now() < forceDeadline) {
    if (stubbornPids.every((pid) => !pidExists(pid))) {
      return;
    }
    await delay(100);
  }
}

module.exports = {
  terminateProcessTree,
};
