import { compareVersions, isValidVersion } from './changelog';

export type WhatsNewDecisionInput = {
  /** Version recorded the last time the dialog was considered; null if never. */
  lastSeenVersion: string | null;
  currentVersion: string;
  /** Whether the app had run on this machine before this launch. */
  isExistingInstall: boolean;
};

export type WhatsNewDecision = {
  /** Open the dialog automatically on this launch. */
  show: boolean;
  /** Show releases newer than this; null means "only the current version". */
  sinceVersion: string | null;
  /** Record `currentVersion` as seen, so the same notes never open twice. */
  markSeen: boolean;
};

export const decideWhatsNew = ({
  lastSeenVersion,
  currentVersion,
  isExistingInstall,
}: WhatsNewDecisionInput): WhatsNewDecision => {
  const lastSeen = isValidVersion(lastSeenVersion) ? lastSeenVersion : null;

  if (lastSeen === null) {
    // No record: either a fresh install (first-run has its own flow) or an
    // update from a build that predates this dialog, whose version we can't know.
    return { show: isExistingInstall, sinceVersion: null, markSeen: true };
  }

  const order = compareVersions(currentVersion, lastSeen);
  if (order === 0) {
    return { show: false, sinceVersion: lastSeen, markSeen: false };
  }
  // order < 0 is a downgrade: nothing new to read, but track what's running.
  return { show: order > 0, sinceVersion: lastSeen, markSeen: true };
};
