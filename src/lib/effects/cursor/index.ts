import type { Effect } from '../types';
import { getMoveEvents, getClickEvents, getPressEvents, getActivityEvents } from './analyze';
import { createCursorLayer } from './render';

export type { CursorData } from './analyze';

export const cursorEffect: Effect<import('./analyze').CursorData> = {
  id: 'cursor',

  analyze(recording) {
    if (!recording.recordingArea || !recording.startTime) {
      return {
        moveEvents: [],
        clickEvents: [],
        pressEvents: [],
        activityEvents: [],
      };
    }
    return {
      moveEvents: getMoveEvents(
        recording.mouseData,
        recording.startTime,
        recording.recordingArea,
        recording.captureBoundsTimeline,
        recording.syntheticCursor,
      ),
      clickEvents: getClickEvents(
        recording.mouseData,
        recording.startTime,
        recording.recordingArea,
        recording.captureBoundsTimeline,
      ),
      pressEvents: getPressEvents(recording.mouseData, recording.startTime),
      activityEvents: getActivityEvents(recording.mouseData, recording.startTime),
    };
  },

  createLayer(data) {
    return createCursorLayer(
      data.moveEvents,
      data.clickEvents,
      data.pressEvents,
      data.activityEvents,
    );
  },
};
