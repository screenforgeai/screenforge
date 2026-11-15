/**
 * Whether the machine's power allows a background export pre-render: always
 * when plugged in, and on battery only while it has at least 30% left.
 *
 * Electron only says whether the machine runs on battery, not how full it is,
 * and Chromium's Battery Status API is not available in Electron, so the level
 * is read from the operating system. When the level cannot be read, the
 * pre-render is allowed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PRERENDER_MIN_BATTERY_LEVEL = 0.3;

export interface PowerState {
  onBattery: boolean;
  /** 0–1, or null when unknown. */
  level: number | null;
}

export function powerAllowsPrerender(state: PowerState): boolean {
  return !state.onBattery || state.level === null || state.level >= PRERENDER_MIN_BATTERY_LEVEL;
}

/** `pmset -g batt` on macOS, e.g. "-InternalBattery-0 (id=…)\t85%; discharging; …". */
export function parsePmsetLevel(output: string): number | null {
  const match = output.match(/(\d{1,3})%;/);
  return match ? Math.min(100, Number(match[1])) / 100 : null;
}

/** EstimatedChargeRemaining values from PowerShell, one per battery. */
export function parseWindowsLevel(output: string): number | null {
  const values = output
    .split(/\s+/)
    .filter((token) => /^\d{1,3}$/.test(token))
    .map((token) => Number(token))
    .filter((v) => v <= 100);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length / 100;
}

/** Average capacity of the batteries under /sys/class/power_supply on Linux. */
export async function readLinuxLevel(root = '/sys/class/power_supply'): Promise<number | null> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return null;
  }
  const levels: number[] = [];
  for (const name of names) {
    try {
      const type = (await fs.readFile(path.join(root, name, 'type'), 'utf8')).trim();
      if (type !== 'Battery') {
        continue;
      }
      const capacity = Number(
        (await fs.readFile(path.join(root, name, 'capacity'), 'utf8')).trim(),
      );
      if (Number.isFinite(capacity)) {
        levels.push(Math.min(100, Math.max(0, capacity)) / 100);
      }
    } catch {
      // Not every supply has these files.
    }
  }
  return levels.length > 0 ? levels.reduce((sum, v) => sum + v, 0) / levels.length : null;
}

export async function readBatteryLevel(platform = process.platform): Promise<number | null> {
  try {
    if (platform === 'linux') {
      return await readLinuxLevel();
    }
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 5000 });
      return parsePmsetLevel(stdout);
    }
    if (platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance -ClassName Win32_Battery).EstimatedChargeRemaining',
        ],
        { timeout: 8000, windowsHide: true },
      );
      return parseWindowsLevel(stdout);
    }
  } catch {
    // Unknown level: allowed.
  }
  return null;
}
