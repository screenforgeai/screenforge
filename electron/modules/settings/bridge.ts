import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { AppSettings } from './service';

export const settingsBridge = {
  getSettings: createInvokeBridge<[], AppSettings>(CH.settings.GET),
  saveSettings: createInvokeBridge<[Partial<AppSettings>], AppSettings>(CH.settings.SAVE),
};
