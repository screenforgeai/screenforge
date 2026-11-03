import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getSettings, saveSettings } from './service';
import type { AppSettings } from './service';

export function registerSettingsChannels(): void {
  handleChannel(CH.settings.GET, () => getSettings());
  handleChannel<[Partial<AppSettings>], AppSettings>(CH.settings.SAVE, (patch) =>
    saveSettings(patch),
  );
}
