import type common from './locales/en/common.json';
import type splash from './locales/en/splash.json';
import type topnav from './locales/en/topnav.json';
import type update from './locales/en/update.json';
import type exportNs from './locales/en/export.json';
import type ffmpeg from './locales/en/ffmpeg.json';
import type recordings from './locales/en/recordings.json';
import type shortcuts from './locales/en/shortcuts.json';
import type zoom from './locales/en/zoom.json';
import type cursor from './locales/en/cursor.json';
import type keyboard from './locales/en/keyboard.json';
import type frame from './locales/en/frame.json';
import type camera from './locales/en/camera.json';
import type captions from './locales/en/captions.json';
import type text from './locales/en/text.json';
import type music from './locales/en/music.json';
import type feedback from './locales/en/feedback.json';
import type toolbar from './locales/en/toolbar.json';
import type timeline from './locales/en/timeline.json';
import type widgets from './locales/en/widgets.json';
import type settings from './locales/en/settings.json';
import type mask from './locales/en/mask.json';
import type motion from './locales/en/motion.json';
import type screenshot from './locales/en/screenshot.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      splash: typeof splash;
      topnav: typeof topnav;
      update: typeof update;
      export: typeof exportNs;
      ffmpeg: typeof ffmpeg;
      recordings: typeof recordings;
      shortcuts: typeof shortcuts;
      zoom: typeof zoom;
      cursor: typeof cursor;
      keyboard: typeof keyboard;
      frame: typeof frame;
      camera: typeof camera;
      captions: typeof captions;
      text: typeof text;
      music: typeof music;
      feedback: typeof feedback;
      toolbar: typeof toolbar;
      timeline: typeof timeline;
      widgets: typeof widgets;
      settings: typeof settings;
      mask: typeof mask;
      motion: typeof motion;
      screenshot: typeof screenshot;
    };
  }
}
