// eslint-disable-next-line import/no-named-as-default
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectBrowserLanguage } from './lib/userProfile';

// English
import common from './locales/en/common.json';
import splash from './locales/en/splash.json';
import topnav from './locales/en/topnav.json';
import update from './locales/en/update.json';
import exportNs from './locales/en/export.json';
import ffmpeg from './locales/en/ffmpeg.json';
import recordings from './locales/en/recordings.json';
import shortcuts from './locales/en/shortcuts.json';
import zoom from './locales/en/zoom.json';
import video from './locales/en/video.json';
import cursor from './locales/en/cursor.json';
import keyboard from './locales/en/keyboard.json';
import frame from './locales/en/frame.json';
import camera from './locales/en/camera.json';
import captions from './locales/en/captions.json';
import text from './locales/en/text.json';
import music from './locales/en/music.json';
import feedback from './locales/en/feedback.json';
import toolbar from './locales/en/toolbar.json';
import timeline from './locales/en/timeline.json';
import widgets from './locales/en/widgets.json';
import settings from './locales/en/settings.json';
import mask from './locales/en/mask.json';
import motion from './locales/en/motion.json';
import onboarding from './locales/en/onboarding.json';

// Spanish
import commonEs from './locales/es/common.json';
import splashEs from './locales/es/splash.json';
import topnavEs from './locales/es/topnav.json';
import updateEs from './locales/es/update.json';
import exportEs from './locales/es/export.json';
import ffmpegEs from './locales/es/ffmpeg.json';
import recordingsEs from './locales/es/recordings.json';
import shortcutsEs from './locales/es/shortcuts.json';
import zoomEs from './locales/es/zoom.json';
import videoEs from './locales/es/video.json';
import cursorEs from './locales/es/cursor.json';
import keyboardEs from './locales/es/keyboard.json';
import frameEs from './locales/es/frame.json';
import cameraEs from './locales/es/camera.json';
import captionsEs from './locales/es/captions.json';
import textEs from './locales/es/text.json';
import musicEs from './locales/es/music.json';
import feedbackEs from './locales/es/feedback.json';
import toolbarEs from './locales/es/toolbar.json';
import timelineEs from './locales/es/timeline.json';
import widgetsEs from './locales/es/widgets.json';
import settingsEs from './locales/es/settings.json';
import maskEs from './locales/es/mask.json';
import onboardingEs from './locales/es/onboarding.json';

// French
import commonFr from './locales/fr/common.json';
import splashFr from './locales/fr/splash.json';
import topnavFr from './locales/fr/topnav.json';
import updateFr from './locales/fr/update.json';
import exportFr from './locales/fr/export.json';
import ffmpegFr from './locales/fr/ffmpeg.json';
import recordingsFr from './locales/fr/recordings.json';
import shortcutsFr from './locales/fr/shortcuts.json';
import zoomFr from './locales/fr/zoom.json';
import videoFr from './locales/fr/video.json';
import cursorFr from './locales/fr/cursor.json';
import keyboardFr from './locales/fr/keyboard.json';
import frameFr from './locales/fr/frame.json';
import cameraFr from './locales/fr/camera.json';
import captionsFr from './locales/fr/captions.json';
import textFr from './locales/fr/text.json';
import musicFr from './locales/fr/music.json';
import feedbackFr from './locales/fr/feedback.json';
import toolbarFr from './locales/fr/toolbar.json';
import timelineFr from './locales/fr/timeline.json';
import widgetsFr from './locales/fr/widgets.json';
import settingsFr from './locales/fr/settings.json';
import maskFr from './locales/fr/mask.json';
import onboardingFr from './locales/fr/onboarding.json';

// German
import commonDe from './locales/de/common.json';
import splashDe from './locales/de/splash.json';
import topnavDe from './locales/de/topnav.json';
import updateDe from './locales/de/update.json';
import exportDe from './locales/de/export.json';
import ffmpegDe from './locales/de/ffmpeg.json';
import recordingsDe from './locales/de/recordings.json';
import shortcutsDe from './locales/de/shortcuts.json';
import zoomDe from './locales/de/zoom.json';
import videoDe from './locales/de/video.json';
import cursorDe from './locales/de/cursor.json';
import keyboardDe from './locales/de/keyboard.json';
import frameDe from './locales/de/frame.json';
import cameraDe from './locales/de/camera.json';
import captionsDe from './locales/de/captions.json';
import textDe from './locales/de/text.json';
import musicDe from './locales/de/music.json';
import feedbackDe from './locales/de/feedback.json';
import toolbarDe from './locales/de/toolbar.json';
import timelineDe from './locales/de/timeline.json';
import widgetsDe from './locales/de/widgets.json';
import settingsDe from './locales/de/settings.json';
import maskDe from './locales/de/mask.json';
import onboardingDe from './locales/de/onboarding.json';

// Japanese
import commonJa from './locales/ja/common.json';
import splashJa from './locales/ja/splash.json';
import topnavJa from './locales/ja/topnav.json';
import updateJa from './locales/ja/update.json';
import exportJa from './locales/ja/export.json';
import ffmpegJa from './locales/ja/ffmpeg.json';
import recordingsJa from './locales/ja/recordings.json';
import shortcutsJa from './locales/ja/shortcuts.json';
import zoomJa from './locales/ja/zoom.json';
import videoJa from './locales/ja/video.json';
import cursorJa from './locales/ja/cursor.json';
import keyboardJa from './locales/ja/keyboard.json';
import frameJa from './locales/ja/frame.json';
import cameraJa from './locales/ja/camera.json';
import captionsJa from './locales/ja/captions.json';
import textJa from './locales/ja/text.json';
import musicJa from './locales/ja/music.json';
import feedbackJa from './locales/ja/feedback.json';
import toolbarJa from './locales/ja/toolbar.json';
import timelineJa from './locales/ja/timeline.json';
import widgetsJa from './locales/ja/widgets.json';
import settingsJa from './locales/ja/settings.json';
import maskJa from './locales/ja/mask.json';
import onboardingJa from './locales/ja/onboarding.json';

// Portuguese
import commonPt from './locales/pt/common.json';
import splashPt from './locales/pt/splash.json';
import topnavPt from './locales/pt/topnav.json';
import updatePt from './locales/pt/update.json';
import exportPt from './locales/pt/export.json';
import ffmpegPt from './locales/pt/ffmpeg.json';
import recordingsPt from './locales/pt/recordings.json';
import shortcutsPt from './locales/pt/shortcuts.json';
import zoomPt from './locales/pt/zoom.json';
import videoPt from './locales/pt/video.json';
import cursorPt from './locales/pt/cursor.json';
import keyboardPt from './locales/pt/keyboard.json';
import framePt from './locales/pt/frame.json';
import cameraPt from './locales/pt/camera.json';
import captionsPt from './locales/pt/captions.json';
import textPt from './locales/pt/text.json';
import musicPt from './locales/pt/music.json';
import feedbackPt from './locales/pt/feedback.json';
import toolbarPt from './locales/pt/toolbar.json';
import timelinePt from './locales/pt/timeline.json';
import widgetsPt from './locales/pt/widgets.json';
import settingsPt from './locales/pt/settings.json';
import maskPt from './locales/pt/mask.json';
import onboardingPt from './locales/pt/onboarding.json';

// Korean
import commonKo from './locales/ko/common.json';
import splashKo from './locales/ko/splash.json';
import topnavKo from './locales/ko/topnav.json';
import updateKo from './locales/ko/update.json';
import exportKo from './locales/ko/export.json';
import ffmpegKo from './locales/ko/ffmpeg.json';
import recordingsKo from './locales/ko/recordings.json';
import shortcutsKo from './locales/ko/shortcuts.json';
import zoomKo from './locales/ko/zoom.json';
import videoKo from './locales/ko/video.json';
import cursorKo from './locales/ko/cursor.json';
import keyboardKo from './locales/ko/keyboard.json';
import frameKo from './locales/ko/frame.json';
import cameraKo from './locales/ko/camera.json';
import captionsKo from './locales/ko/captions.json';
import textKo from './locales/ko/text.json';
import musicKo from './locales/ko/music.json';
import feedbackKo from './locales/ko/feedback.json';
import toolbarKo from './locales/ko/toolbar.json';
import timelineKo from './locales/ko/timeline.json';
import widgetsKo from './locales/ko/widgets.json';
import settingsKo from './locales/ko/settings.json';
import maskKo from './locales/ko/mask.json';
import onboardingKo from './locales/ko/onboarding.json';

// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  lng: detectBrowserLanguage(),
  fallbackLng: 'en',
  ns: [
    'common',
    'splash',
    'topnav',
    'update',
    'export',
    'ffmpeg',
    'recordings',
    'shortcuts',
    'zoom',
    'video',
    'cursor',
    'keyboard',
    'frame',
    'camera',
    'captions',
    'text',
    'music',
    'feedback',
    'toolbar',
    'timeline',
    'widgets',
    'settings',
    'mask',
    'motion',
    'onboarding',
  ],
  defaultNS: 'common',
  resources: {
    en: {
      common,
      splash,
      topnav,
      update,
      export: exportNs,
      ffmpeg,
      recordings,
      shortcuts,
      zoom,
      video,
      cursor,
      keyboard,
      frame,
      camera,
      captions,
      text,
      music,
      feedback,
      toolbar,
      timeline,
      widgets,
      settings,
      mask,
      motion,
      onboarding,
    },
    es: {
      common: commonEs,
      splash: splashEs,
      topnav: topnavEs,
      update: updateEs,
      export: exportEs,
      ffmpeg: ffmpegEs,
      recordings: recordingsEs,
      shortcuts: shortcutsEs,
      zoom: zoomEs,
      video: videoEs,
      cursor: cursorEs,
      keyboard: keyboardEs,
      frame: frameEs,
      camera: cameraEs,
      captions: captionsEs,
      text: textEs,
      music: musicEs,
      feedback: feedbackEs,
      toolbar: toolbarEs,
      timeline: timelineEs,
      widgets: widgetsEs,
      settings: settingsEs,
      mask: maskEs,
      onboarding: onboardingEs,
    },
    fr: {
      common: commonFr,
      splash: splashFr,
      topnav: topnavFr,
      update: updateFr,
      export: exportFr,
      ffmpeg: ffmpegFr,
      recordings: recordingsFr,
      shortcuts: shortcutsFr,
      zoom: zoomFr,
      video: videoFr,
      cursor: cursorFr,
      keyboard: keyboardFr,
      frame: frameFr,
      camera: cameraFr,
      captions: captionsFr,
      text: textFr,
      music: musicFr,
      feedback: feedbackFr,
      toolbar: toolbarFr,
      timeline: timelineFr,
      widgets: widgetsFr,
      settings: settingsFr,
      mask: maskFr,
      onboarding: onboardingFr,
    },
    de: {
      common: commonDe,
      splash: splashDe,
      topnav: topnavDe,
      update: updateDe,
      export: exportDe,
      ffmpeg: ffmpegDe,
      recordings: recordingsDe,
      shortcuts: shortcutsDe,
      zoom: zoomDe,
      video: videoDe,
      cursor: cursorDe,
      keyboard: keyboardDe,
      frame: frameDe,
      camera: cameraDe,
      captions: captionsDe,
      text: textDe,
      music: musicDe,
      feedback: feedbackDe,
      toolbar: toolbarDe,
      timeline: timelineDe,
      widgets: widgetsDe,
      settings: settingsDe,
      mask: maskDe,
      onboarding: onboardingDe,
    },
    ja: {
      common: commonJa,
      splash: splashJa,
      topnav: topnavJa,
      update: updateJa,
      export: exportJa,
      ffmpeg: ffmpegJa,
      recordings: recordingsJa,
      shortcuts: shortcutsJa,
      zoom: zoomJa,
      video: videoJa,
      cursor: cursorJa,
      keyboard: keyboardJa,
      frame: frameJa,
      camera: cameraJa,
      captions: captionsJa,
      text: textJa,
      music: musicJa,
      feedback: feedbackJa,
      toolbar: toolbarJa,
      timeline: timelineJa,
      widgets: widgetsJa,
      settings: settingsJa,
      mask: maskJa,
      onboarding: onboardingJa,
    },
    pt: {
      common: commonPt,
      splash: splashPt,
      topnav: topnavPt,
      update: updatePt,
      export: exportPt,
      ffmpeg: ffmpegPt,
      recordings: recordingsPt,
      shortcuts: shortcutsPt,
      zoom: zoomPt,
      video: videoPt,
      cursor: cursorPt,
      keyboard: keyboardPt,
      frame: framePt,
      camera: cameraPt,
      captions: captionsPt,
      text: textPt,
      music: musicPt,
      feedback: feedbackPt,
      toolbar: toolbarPt,
      timeline: timelinePt,
      widgets: widgetsPt,
      settings: settingsPt,
      mask: maskPt,
      onboarding: onboardingPt,
    },
    ko: {
      common: commonKo,
      splash: splashKo,
      topnav: topnavKo,
      update: updateKo,
      export: exportKo,
      ffmpeg: ffmpegKo,
      recordings: recordingsKo,
      shortcuts: shortcutsKo,
      zoom: zoomKo,
      video: videoKo,
      cursor: cursorKo,
      keyboard: keyboardKo,
      frame: frameKo,
      camera: cameraKo,
      captions: captionsKo,
      text: textKo,
      music: musicKo,
      feedback: feedbackKo,
      toolbar: toolbarKo,
      timeline: timelineKo,
      widgets: widgetsKo,
      settings: settingsKo,
      mask: maskKo,
      onboarding: onboardingKo,
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
