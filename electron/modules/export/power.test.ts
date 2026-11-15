// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PRERENDER_MIN_BATTERY_LEVEL,
  parsePmsetLevel,
  parseWindowsLevel,
  powerAllowsPrerender,
  readLinuxLevel,
} from './power';

describe('powerAllowsPrerender', () => {
  it('always allows mains power', () => {
    expect(powerAllowsPrerender({ onBattery: false, level: 0.05 })).toBe(true);
  });

  it('allows battery only at 30% or more', () => {
    expect(PRERENDER_MIN_BATTERY_LEVEL).toBe(0.3);
    expect(powerAllowsPrerender({ onBattery: true, level: 0.3 })).toBe(true);
    expect(powerAllowsPrerender({ onBattery: true, level: 0.29 })).toBe(false);
  });

  it('allows battery when the level cannot be read', () => {
    expect(powerAllowsPrerender({ onBattery: true, level: null })).toBe(true);
  });
});

describe('parsePmsetLevel (macOS)', () => {
  it('reads the percentage', () => {
    expect(
      parsePmsetLevel(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t27%; discharging; 2:41 remaining present: true\n",
      ),
    ).toBe(0.27);
    expect(parsePmsetLevel("Now drawing from 'AC Power'\n")).toBeNull();
  });
});

describe('parseWindowsLevel', () => {
  it('averages the batteries and keeps a real 0%', () => {
    expect(parseWindowsLevel('85\r\n')).toBe(0.85);
    expect(parseWindowsLevel('80\r\n60\r\n')).toBe(0.7);
    expect(parseWindowsLevel('0\r\n')).toBe(0);
    expect(parseWindowsLevel('')).toBeNull();
    expect(parseWindowsLevel('Get-CimInstance : error')).toBeNull();
  });
});

describe('readLinuxLevel', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-supply-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function supply(name: string, type: string, capacity?: string) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'type'), `${type}\n`);
    if (capacity !== undefined) {
      await fs.writeFile(path.join(root, name, 'capacity'), `${capacity}\n`);
    }
  }

  it('averages battery capacities and ignores other supplies', async () => {
    await supply('AC', 'Mains');
    await supply('BAT0', 'Battery', '40');
    await supply('BAT1', 'Battery', '20');
    expect(await readLinuxLevel(root)).toBeCloseTo(0.3);
  });

  it('is unknown on a machine without a battery', async () => {
    await supply('AC', 'Mains');
    expect(await readLinuxLevel(root)).toBeNull();
    expect(await readLinuxLevel(path.join(root, 'missing'))).toBeNull();
  });
});
