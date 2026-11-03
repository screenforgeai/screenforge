import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerAppImage } from '@reforged/maker-appimage';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPaths = require('./shared/ffmpeg-paths.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const uiohookPaths = require('./shared/uiohook-paths.js');

function loadLocalEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalizedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const inlineCommentIndex = value.indexOf(' #');
      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trimEnd();
      }
    }

    process.env[key] = value.replace(/\\n/g, '\n');
  }
}

// Forge reads config before Electron runs, so load the repo's .env here.
loadLocalEnvFile(path.resolve(__dirname, '.env'));

const enableSigning = process.env.SCREENFORGE_ENABLE_SIGNING === 'true';
const enableNotarization = enableSigning && process.env.SCREENFORGE_ENABLE_NOTARIZATION !== 'false';
const APP_BUNDLE_ID = 'ai.screenforge.app';
const APP_DISPLAY_NAME = 'Screenforge';
const extraResources = [
  './src/assets/tray-icon-dark.png',
  './src/assets/tray-icon-light.png',
  // LGPL compliance (FFmpeg, libuiohook): third-party attribution must ship
  // with every distributed build, not just live in the repo.
  './THIRD_PARTY_NOTICES.md',
];
if (process.platform === 'win32') {
  extraResources.unshift('./native/bin/win32-x64/ScreenforgeCapture.exe');
} else if (process.platform === 'darwin') {
  extraResources.unshift('./native/bin/ScreenforgeCapture');
}
// Linux has no native capture helper: X11 capture uses bundled FFmpeg,
// Wayland capture happens in the renderer via the PipeWire portal.
const macAppIconPath = path.resolve(__dirname, 'build', 'icons', 'screenforge.icns');
const winAppIconPath = path.resolve(__dirname, 'build', 'icons', 'screenforge.ico');
const linuxAppIconPath = path.resolve(__dirname, 'build', 'icons', 'screenforge.png');
const appIconPath =
  process.platform === 'win32'
    ? winAppIconPath
    : process.platform === 'linux'
      ? linuxAppIconPath
      : macAppIconPath;
const ffmpegBundleDir = ffmpegPaths.getDevBundledFFmpegDir(__dirname);
const stagedUiohookDir = uiohookPaths.stageUiohookBundle(__dirname);

function resolveConfiguredPath(configuredPath: string): string {
  let resolvedPath = configuredPath.trim();

  if (resolvedPath === '~') {
    resolvedPath = os.homedir();
  } else if (resolvedPath.startsWith('~/')) {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(2));
  }

  resolvedPath = resolvedPath.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, simpleName: string | undefined, bracedName: string | undefined) =>
      process.env[simpleName ?? bracedName ?? ''] ?? '',
  );

  return path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(__dirname, resolvedPath);
}

function readOptionalConfiguredTextFile(configuredPath?: string): string | undefined {
  if (!configuredPath?.trim()) {
    return undefined;
  }

  const resolvedPath = resolveConfiguredPath(configuredPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configured file does not exist: ${resolvedPath}`);
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8').trim();
  return contents || undefined;
}

if (fs.existsSync(ffmpegBundleDir)) {
  extraResources.push(path.resolve(ffmpegBundleDir));
}

// native/bin/ffmpeg/ can hold several platforms' binaries (macOS is
// committed; Linux/Windows are downloaded), but a build only needs its own.
// Drop the rest right after extraResources are copied — before macOS
// signing seals the bundle.
function pruneForeignFFmpegBuilds(
  buildPath: string,
  _electronVersion: string,
  platform: string,
  arch: string,
  callback: (error?: Error | null) => void,
): void {
  try {
    const appBundle =
      platform === 'darwin'
        ? fs.readdirSync(buildPath).find((entry) => entry.endsWith('.app'))
        : undefined;
    const resourcesDir = appBundle
      ? path.join(buildPath, appBundle, 'Contents', 'Resources')
      : path.join(buildPath, 'resources');
    const bundledFFmpegDir = path.join(resourcesDir, 'ffmpeg');
    const targetFolder = ffmpegPaths.getFFmpegTargetFolder(platform, arch);

    if (fs.existsSync(bundledFFmpegDir)) {
      for (const entry of fs.readdirSync(bundledFFmpegDir)) {
        if (entry !== targetFolder) {
          fs.rmSync(path.join(bundledFFmpegDir, entry), { recursive: true, force: true });
        }
      }
    }
    callback();
  } catch (error) {
    callback(error as Error);
  }
}

if (stagedUiohookDir && fs.existsSync(stagedUiohookDir)) {
  extraResources.push(stagedUiohookDir);
}

const macUpdateManifestBaseUrl = process.env.SCREENFORGE_MAC_UPDATE_BASE_URL?.trim() ?? '';
const macUpdateReleaseNotes = readOptionalConfiguredTextFile(
  process.env.SCREENFORGE_MAC_UPDATE_RELEASE_NOTES_PATH,
);

const packagerConfig: ForgeConfig['packagerConfig'] = {
  asar: {
    // AutoUnpackNativesPlugin adds *.node to this; we add onnxruntime-node/bin/**
    // so that libonnxruntime.dylib (companion to onnxruntime_binding.node) is also
    // unpacked. dlopen() for the dylib runs outside Electron's ASAR vfs and must
    // find the dylib in the real filesystem beside the .node file.
    unpack: '**/node_modules/onnxruntime-node/bin/**',
  },
  appBundleId: APP_BUNDLE_ID,
  icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
  extraResource: extraResources,
  afterCopyExtraResources: [pruneForeignFFmpegBuilds],
  extendInfo: {
    CFBundleDisplayName: APP_DISPLAY_NAME,
    CFBundleName: APP_DISPLAY_NAME,
    NSScreenRecordingUsageDescription:
      'Screenforge needs Screen Recording permission to capture your display.',
    NSMicrophoneUsageDescription:
      'Screenforge needs Microphone access to record your voice and narration.',
    NSCameraUsageDescription:
      'Screenforge needs Camera access to include your camera track in recordings.',
    NSDesktopFolderUsageDescription:
      'Screenforge needs access to your Desktop folder because screen recordings may capture files visible on your Desktop.',
    NSDocumentsFolderUsageDescription:
      'Screenforge needs access to your Documents folder because screen recordings may capture files visible on your screen.',
    NSDownloadsFolderUsageDescription:
      'Screenforge needs access to your Downloads folder because screen recordings may capture files visible on your screen.',
  },
};

if (enableSigning) {
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const teamId = process.env.APPLE_TEAM_ID;
  const appleApiKeyPath = process.env.APPLE_API_KEY_PATH;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER_ID;

  if (!identity || !teamId || !appleApiKeyPath || !appleApiKeyId || !appleApiIssuer) {
    throw new Error(
      'Signing is enabled but APPLE_SIGNING_IDENTITY, APPLE_TEAM_ID, APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER_ID must all be set.',
    );
  }

  const appleApiKey = resolveConfiguredPath(appleApiKeyPath);

  if (enableNotarization && !fs.existsSync(appleApiKey)) {
    throw new Error(
      `APPLE_API_KEY_PATH resolved to "${appleApiKey}", but that file does not exist.`,
    );
  }

  const mainEntitlements = path.resolve(__dirname, 'build', 'entitlements.mac.plist');
  const inheritEntitlements = path.resolve(__dirname, 'build', 'entitlements.mac.inherit.plist');

  packagerConfig.osxSign = {
    identity,
    hardenedRuntime: true,
    continueOnError: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (filePath: string) => {
      // Helper processes (Renderer, GPU, Plugin) get minimal entitlements
      if (/Helper(?: \(Renderer\)| \(GPU\)| \(Plugin\))?\.app/.test(filePath)) {
        return { entitlements: inheritEntitlements };
      }
      // Main app bundle gets full entitlements
      return { entitlements: mainEntitlements };
    },
  } as unknown as NonNullable<ForgeConfig['packagerConfig']>['osxSign'];

  if (enableNotarization) {
    console.info(
      '[forge] macOS notarization is enabled. "Finalizing package" will wait for Apple and may take several minutes.',
    );

    packagerConfig.osxNotarize = {
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer,
    } as unknown as NonNullable<ForgeConfig['packagerConfig']>['osxNotarize'];
  }
} else if (process.platform === 'darwin') {
  // On macOS 15 + Electron 40, both FusesPlugin's built-in re-sign and
  // @electron/osx-sign use `codesign --preserve-metadata=runtime` when
  // re-signing Apple's pre-signed Electron Framework. This triggers an
  // "internal error in Code Signing subsystem" on macOS 15, leaving the
  // framework with an invalid signature and causing SIGKILL at launch.
  //
  // Setting osxSign here makes FusesPlugin see hasOSXSignConfig=true and
  // skip its re-sign. We then perform a proper inside-out ad-hoc re-sign
  // in the postPackage hook using plain `codesign --force --sign -` (no
  // --preserve-metadata, no --deep) which works correctly on macOS 15.
  packagerConfig.osxSign = {
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
  } as unknown as NonNullable<ForgeConfig['packagerConfig']>['osxSign'];
}

// ── Ad-hoc signing helpers (dev/unsigned path only) ──────────────────────────

/**
 * Returns true if the file at `filePath` is a Mach-O binary (executable,
 * dylib, .node native module, or fat/universal binary).
 */
function isMachO(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Magic numbers read as little-endian uint32:
    //   0xFEEDFACE – 32-bit LE Mach-O
    //   0xFEEDFACF – 64-bit LE Mach-O (arm64)
    //   0xCEFAEDFE – 32-bit BE Mach-O
    //   0xCFFAEDFE – 64-bit BE Mach-O
    //   0xBEBAFECA – fat/universal binary (CAFEBABE read as LE)
    const magic = buf.readUInt32LE(0);
    return (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xbebafeca
    );
  } catch {
    return false;
  }
}

/**
 * Recursively signs all signable content inside `bundleDir` (inside-out),
 * but does NOT sign `bundleDir` itself — the caller is responsible for that.
 *
 * Order: dylibs/binaries first, then nested bundles (.framework, .app, .xpc,
 * .bundle) from deepest to shallowest, so every inner component is validly
 * signed before the outer bundle seals it in its CodeResources catalog.
 */
function signBundleContents(bundleDir: string): void {
  for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue; // symlinks resolve to already-signed targets — skip
    }

    const entryPath = path.join(bundleDir, entry.name);

    if (entry.isDirectory()) {
      if (/\.(app|framework|xpc|bundle)$/.test(entry.name)) {
        // Recurse first (inside-out), then sign the nested bundle
        signBundleContents(entryPath);
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', entryPath], {
          stdio: 'inherit',
        });
      } else {
        signBundleContents(entryPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ext === '.dylib' || ext === '.node' || ext === '.so' || ext === '') {
        if (isMachO(entryPath)) {
          execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', entryPath], {
            stdio: 'inherit',
          });
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const config: ForgeConfig = {
  packagerConfig,
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      // Bytecode compilation removed — minification (vite.main.config.ts + vite.preload.config.ts)
      // already obscures the main/preload bundles. V8 bytecode provides no meaningful additional
      // protection (it's version-locked, easily decompiled, and doesn't cover the renderer bundle).

      // The transcribe-worker bundle requires onnxruntime-node and onnxruntime-common at
      // runtime (they are kept external so the native binding is not bundled). Inject them
      // into node_modules/ inside the package directory so standard CJS resolution finds
      // them inside the ASAR. The asar.unpack pattern above extracts the native .node +
      // .dylib to app.asar.unpacked/ where dlopen() can reach them.
      const srcBase = path.join(__dirname, 'node_modules');
      const destBase = path.join(buildPath, 'node_modules');

      // onnxruntime-node: JS files + current-arch native binaries only
      const onnxNodeSrc = path.join(srcBase, 'onnxruntime-node');
      const onnxNodeDest = path.join(destBase, 'onnxruntime-node');

      if (!fs.existsSync(onnxNodeSrc)) {
        return;
      }

      fs.mkdirSync(onnxNodeDest, { recursive: true });
      fs.copyFileSync(
        path.join(onnxNodeSrc, 'package.json'),
        path.join(onnxNodeDest, 'package.json'),
      );
      fs.cpSync(path.join(onnxNodeSrc, 'dist'), path.join(onnxNodeDest, 'dist'), {
        recursive: true,
      });
      const nativeSrc = path.join(onnxNodeSrc, 'bin', 'napi-v6', process.platform, process.arch);
      const nativeDest = path.join(onnxNodeDest, 'bin', 'napi-v6', process.platform, process.arch);
      if (fs.existsSync(nativeSrc)) {
        fs.cpSync(nativeSrc, nativeDest, { recursive: true });
      }

      // onnxruntime-common: required by onnxruntime-node at runtime
      const onnxCommonSrc = path.join(srcBase, 'onnxruntime-common');
      const onnxCommonDest = path.join(destBase, 'onnxruntime-common');

      if (!fs.existsSync(onnxCommonSrc)) {
        return;
      }

      fs.mkdirSync(onnxCommonDest, { recursive: true });
      fs.copyFileSync(
        path.join(onnxCommonSrc, 'package.json'),
        path.join(onnxCommonDest, 'package.json'),
      );
      fs.cpSync(path.join(onnxCommonSrc, 'dist', 'cjs'), path.join(onnxCommonDest, 'dist', 'cjs'), {
        recursive: true,
      });
    },

    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin' || enableSigning) {
        return;
      }

      for (const outputPath of outputPaths) {
        const appPath = outputPath.endsWith('.app')
          ? outputPath
          : fs
              .readdirSync(outputPath)
              .map((entry) => path.join(outputPath, entry))
              .find((entry) => entry.endsWith('.app'));

        if (!appPath) {
          throw new Error(`Could not locate a packaged .app bundle inside ${outputPath}`);
        }

        // Sign all inner components (dylibs, native modules, frameworks, helpers)
        // inside-out before sealing the outer bundle. This avoids the macOS 15
        // "invalid page" SIGKILL caused by @electron/osx-sign's use of
        // --preserve-metadata on Apple's pre-signed Electron Framework.
        signBundleContents(appPath);

        // Seal the outer bundle with the explicit bundle identifier
        execFileSync(
          '/usr/bin/codesign',
          ['--force', '--sign', '-', '--identifier', APP_BUNDLE_ID, appPath],
          { stdio: 'inherit' },
        );
      }
    },
  },
  makers: [
    new MakerSquirrel(
      {
        name: 'Screenforge',
        setupExe: 'ScreenforgeSetup.exe',
        setupIcon: fs.existsSync(winAppIconPath) ? winAppIconPath : undefined,
        noMsi: true,
      },
      ['win32'],
    ),
    new MakerDMG(
      {
        icon: fs.existsSync(macAppIconPath) ? macAppIconPath : undefined,
      },
      ['darwin'],
    ),
    new MakerZIP(
      {
        ...(macUpdateManifestBaseUrl
          ? {
              macUpdateManifestBaseUrl,
            }
          : {}),
        ...(macUpdateReleaseNotes
          ? {
              macUpdateReleaseNotes,
            }
          : {}),
      },
      ['darwin'],
    ),
    new MakerZIP({}, ['win32', 'linux']),
    new MakerRpm({
      options: {
        name: 'screenforge',
        productName: APP_DISPLAY_NAME,
        genericName: 'Screen Recorder',
        categories: ['AudioVideo', 'Video'],
        icon: fs.existsSync(linuxAppIconPath) ? linuxAppIconPath : undefined,
        homepage: 'https://github.com/mohibarshi/screenforge',
      },
    }),
    new MakerDeb({
      options: {
        name: 'screenforge',
        productName: APP_DISPLAY_NAME,
        genericName: 'Screen Recorder',
        section: 'video',
        categories: ['AudioVideo', 'Video'],
        icon: fs.existsSync(linuxAppIconPath) ? linuxAppIconPath : undefined,
        homepage: 'https://github.com/mohibarshi/screenforge',
        // Wayland capture requires the PipeWire portal stack at runtime;
        // X11-only systems work without it, so recommend rather than depend.
        recommends: ['pipewire', 'xdg-desktop-portal'],
      },
    }),
    // Universal portable build for distros without deb/rpm (Arch, openSUSE, …).
    new MakerAppImage({
      options: {
        name: 'screenforge',
        // The packaged binary is named after productName, not options.name.
        bin: APP_DISPLAY_NAME,
        productName: APP_DISPLAY_NAME,
        genericName: 'Screen Recorder',
        categories: ['AudioVideo', 'Video'],
        icon: fs.existsSync(linuxAppIconPath) ? linuxAppIconPath : undefined,
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'electron/modules/captions/transcribe-worker.ts',
          config: 'vite.worker.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'electron.vite.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
