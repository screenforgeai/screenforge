import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logoSrc from '../assets/logo.png';
import { version as pkgVersion } from '../../package.json';
import { getPreloadPercent } from '../lib/startupPermissions';
import type { PreloadProgress } from '../types';

const DEFAULT_PRELOAD_PROGRESS: PreloadProgress = {
  task: 'Preparing recorder',
  completed: 0,
  total: 3,
};

const SplashScreen = () => {
  const { t } = useTranslation('splash');
  const version = `v${pkgVersion}`;
  const [preloadProgress, setPreloadProgress] = useState<PreloadProgress>(DEFAULT_PRELOAD_PROGRESS);

  const percent = useMemo(() => getPreloadPercent(preloadProgress), [preloadProgress]);

  useEffect(() => {
    const unsub = window.screenforge.onPreloadProgress((progress) => {
      setPreloadProgress(progress);
    });
    return unsub;
  }, []);

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-[#050507] antialiased">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 bg-background/96" />
      <div className="pointer-events-none absolute inset-0 bg-accent-glow opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-[0.08]" />

      {/* Loading content */}
      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-12 px-8">
        {/* Logo */}
        <img src={logoSrc} alt="Screenforge" className="h-24 w-auto object-contain" />

        {/* Text + progress */}
        <div className="w-full space-y-6">
          <div className="text-center">
            <h1 className="text-balance text-lg font-semibold text-sf-primary">{t('title')}</h1>
            <p className="text-pretty text-sm text-sf-secondary">{t('subtitle')}</p>
          </div>

          <div className="space-y-1">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-sf-secondary">{t('startingUp')}</span>
              <span className="tabular-nums text-sm text-sf-secondary">{percent}%</span>
            </div>
          </div>
        </div>

        {/* Version */}
        <span className="tabular-nums text-xs text-sf-muted">{version}</span>
      </div>
    </div>
  );
};

export default SplashScreen;
