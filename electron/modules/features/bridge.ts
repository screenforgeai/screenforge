import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { FeatureFlags } from '../../../src/types/index';

export const featuresBridge = {
  getFeatureFlags: createInvokeBridge<[], FeatureFlags>(CH.features.GET),
  onFeatureFlagsChanged: createSubscription<FeatureFlags>(CH.features.CHANGED),
};
