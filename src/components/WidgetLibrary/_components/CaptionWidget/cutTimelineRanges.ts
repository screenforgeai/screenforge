import { useStore } from 'src/store';
import {
  applyTimelineCuts,
  collapseTimeOverRanges,
  type TimeRange,
} from 'src/lib/helpers/segments';

/**
 * Cuts timeline ranges out of the video as one undoable edit, closing up the
 * timeline, and keeps the playhead on the same moment of content. Returns the
 * ranges that were removed, or null when nothing on the timeline was cut.
 */
export const cutTimelineRanges = (
  label: string,
  ranges: readonly TimeRange[],
): TimeRange[] | null => {
  const { commitEdit, currentTime, requestSeekTo } = useStore.getState();
  let cutRanges: TimeRange[] | null = null;

  commitEdit(label, (state) => {
    const result = applyTimelineCuts(state, ranges);
    if (!result) {
      return;
    }
    cutRanges = result.cutRanges;
    return {
      mediaSegments: result.mediaSegments,
      cameraMediaSegments: result.cameraMediaSegments,
      zoomClips: result.zoomClips,
      cameraClips: result.cameraClips,
      maskClips: result.maskClips,
      motionClips: result.motionClips,
      selectedClip: null,
    };
  });

  if (cutRanges) {
    requestSeekTo(collapseTimeOverRanges(currentTime, cutRanges));
  }
  return cutRanges;
};
