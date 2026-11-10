import type { UpdaterDisabledReason, UpdaterState } from '../../../src/types/index';

export type UpdaterAdapterUpdate = {
  version?: string;
  releaseNotes?: string;
};

export type UpdaterAdapterListeners = {
  onChecking: () => void;
  onUpdateAvailable: (update?: UpdaterAdapterUpdate) => void;
  // A newer version exists but the adapter can't download it; the user
  // installs it themselves.
  onManualUpdateAvailable: (update: UpdaterAdapterUpdate) => void;
  onUpdateNotAvailable: () => void;
  onUpdateDownloaded: (update?: UpdaterAdapterUpdate) => void;
  onError: (error: Error) => void;
};

export type ActiveUpdaterAdapter = {
  kind: 'active';
  start: (listeners: UpdaterAdapterListeners) => void;
  checkForUpdates: () => Promise<void> | void;
  quitAndInstall: () => void;
};

export type DisabledUpdaterAdapter = {
  kind: 'disabled';
  reason: UpdaterDisabledReason;
};

export type UpdaterAdapter = ActiveUpdaterAdapter | DisabledUpdaterAdapter;

type UpdaterControllerOptions = {
  currentVersion: string;
  adapter: UpdaterAdapter;
  isAppBusy: () => boolean;
  checkIntervalMs: number;
};

function statesEqual(left: UpdaterState, right: UpdaterState): boolean {
  return (
    left.currentVersion === right.currentVersion &&
    left.status === right.status &&
    left.availableVersion === right.availableVersion &&
    left.releaseNotes === right.releaseNotes &&
    left.reason === right.reason &&
    left.errorMessage === right.errorMessage
  );
}

export class UpdaterController {
  private readonly currentVersion: string;

  private readonly adapter: UpdaterAdapter;

  private readonly checkIntervalMs: number;

  private isAppBusy: () => boolean;

  private readonly listeners = new Set<(state: UpdaterState) => void>();

  private checkTimer: ReturnType<typeof setInterval> | null = null;

  private checkInFlight = false;

  private started = false;

  private pendingReadyState: UpdaterState | null = null;

  private state: UpdaterState;

  constructor(options: UpdaterControllerOptions) {
    this.currentVersion = options.currentVersion;
    this.adapter = options.adapter;
    this.isAppBusy = options.isAppBusy;
    this.checkIntervalMs = options.checkIntervalMs;
    this.state =
      this.adapter.kind === 'disabled'
        ? {
            currentVersion: this.currentVersion,
            status: 'disabled',
            reason: this.adapter.reason,
          }
        : {
            currentVersion: this.currentVersion,
            status: 'idle',
          };
  }

  getState(): UpdaterState {
    return { ...this.state };
  }

  setIsAppBusy(isAppBusy: () => boolean): void {
    this.isAppBusy = isAppBusy;
  }

  subscribe(listener: (state: UpdaterState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started || this.adapter.kind === 'disabled') {
      return;
    }

    this.started = true;
    this.adapter.start({
      onChecking: () => {
        // Keep a known newer version on screen while re-checking.
        if (this.pendingReadyState || this.state.status === 'available') {
          return;
        }

        this.setState({
          currentVersion: this.currentVersion,
          status: 'checking',
          availableVersion: this.state.availableVersion,
          releaseNotes: this.state.releaseNotes,
        });
      },
      onUpdateAvailable: (update) => {
        this.setState({
          currentVersion: this.currentVersion,
          status: 'downloading',
          availableVersion: update?.version ?? this.state.availableVersion,
          releaseNotes: update?.releaseNotes ?? this.state.releaseNotes,
        });
      },
      onManualUpdateAvailable: (update) => {
        this.setState({
          currentVersion: this.currentVersion,
          status: 'available',
          availableVersion: update.version,
          releaseNotes: update.releaseNotes,
        });
      },
      onUpdateNotAvailable: () => {
        if (this.pendingReadyState) {
          return;
        }

        this.setState({
          currentVersion: this.currentVersion,
          status: 'idle',
        });
      },
      onUpdateDownloaded: (update) => {
        const readyState: UpdaterState = {
          currentVersion: this.currentVersion,
          status: 'ready',
          availableVersion: update?.version ?? this.state.availableVersion,
          releaseNotes: update?.releaseNotes ?? this.state.releaseNotes,
        };

        if (this.isAppBusy()) {
          this.pendingReadyState = readyState;
          this.setState({
            ...readyState,
            status: 'downloaded',
          });
          return;
        }

        this.pendingReadyState = null;
        this.setState(readyState);
      },
      onError: (error) => {
        this.setState({
          currentVersion: this.currentVersion,
          status: 'error',
          availableVersion: this.state.availableVersion,
          releaseNotes: this.state.releaseNotes,
          errorMessage: error.message,
        });
      },
    });

    void this.runCheck();
    this.checkTimer = setInterval(() => {
      void this.runCheck();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  notifyActivityChanged(): void {
    if (!this.pendingReadyState || this.isAppBusy()) {
      return;
    }

    const readyState = this.pendingReadyState;
    this.pendingReadyState = null;
    this.setState(readyState);
  }

  async restartToApplyUpdate(): Promise<void> {
    if (this.adapter.kind !== 'active') {
      throw new Error('Auto-update is disabled.');
    }

    if (this.state.status !== 'ready') {
      throw new Error('Update is not ready to install.');
    }

    this.adapter.quitAndInstall();
  }

  async checkForUpdatesNow(): Promise<UpdaterState> {
    if (
      this.adapter.kind !== 'active' ||
      (this.state.status !== 'idle' &&
        this.state.status !== 'available' &&
        this.state.status !== 'error')
    ) {
      return this.getState();
    }

    await this.runCheck();
    return this.getState();
  }

  private async runCheck(): Promise<void> {
    if (
      this.adapter.kind !== 'active' ||
      this.checkInFlight ||
      this.pendingReadyState ||
      this.state.status === 'ready' ||
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded'
    ) {
      return;
    }

    this.checkInFlight = true;

    try {
      await this.adapter.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({
        currentVersion: this.currentVersion,
        status: 'error',
        availableVersion: this.state.availableVersion,
        releaseNotes: this.state.releaseNotes,
        errorMessage: message,
      });
    } finally {
      this.checkInFlight = false;
    }
  }

  private setState(nextState: UpdaterState): void {
    if (statesEqual(this.state, nextState)) {
      return;
    }

    this.state = nextState;
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
