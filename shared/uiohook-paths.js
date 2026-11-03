const fs = require('node:fs');
const path = require('node:path');

function getSourceUiohookDir(rootDir) {
  return path.resolve(rootDir, 'node_modules', 'uiohook-napi');
}

function getSourceNodeGypBuildDir(rootDir) {
  return path.resolve(rootDir, 'node_modules', 'node-gyp-build');
}

function getStagedUiohookBaseName(platform = process.platform, arch = process.arch) {
  return `uiohook-napi-${platform}-${arch}`;
}

function getStagedUiohookDir(rootDir, platform = process.platform, arch = process.arch) {
  return path.resolve(rootDir, '.packaging-cache', getStagedUiohookBaseName(platform, arch));
}

function getPackagedUiohookDir(resourcesPath, platform = process.platform, arch = process.arch) {
  return path.resolve(resourcesPath, getStagedUiohookBaseName(platform, arch));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  copyFile(sourcePath, targetPath);
}

function stageUiohookBundle(rootDir) {
  const platform = process.platform;

  // darwin, win32 and linux all ship uiohook prebuilds. On Linux the hook is
  // X11-only (uiohook cannot see global input on Wayland), but the module must
  // still be bundled so X11 sessions get cursor tracking in packaged builds.
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    return null;
  }

  const sourceUiohookDir = getSourceUiohookDir(rootDir);
  const sourceNodeGypBuildDir = getSourceNodeGypBuildDir(rootDir);

  const prebuildName = `${platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;

  const stagedDir = getStagedUiohookDir(rootDir, platform, process.arch);

  if (!fs.existsSync(sourceUiohookDir) || !fs.existsSync(sourceNodeGypBuildDir)) {
    return null;
  }

  // Check if the prebuild actually exists for this platform
  const prebuildPath = path.join(sourceUiohookDir, 'prebuilds', prebuildName, 'node.napi.node');
  if (!fs.existsSync(prebuildPath)) {
    return null;
  }

  fs.rmSync(stagedDir, { recursive: true, force: true });

  copyFile(path.join(sourceUiohookDir, 'package.json'), path.join(stagedDir, 'package.json'));
  copyIfExists(path.join(sourceUiohookDir, 'LICENSE'), path.join(stagedDir, 'LICENSE'));
  copyFile(path.join(sourceUiohookDir, 'dist', 'index.js'), path.join(stagedDir, 'dist', 'index.js'));
  copyFile(prebuildPath, path.join(stagedDir, 'prebuilds', prebuildName, 'node.napi.node'));

  const stagedNodeGypBuildDir = path.join(stagedDir, 'node_modules', 'node-gyp-build');
  copyFile(
    path.join(sourceNodeGypBuildDir, 'package.json'),
    path.join(stagedNodeGypBuildDir, 'package.json'),
  );
  copyFile(path.join(sourceNodeGypBuildDir, 'index.js'), path.join(stagedNodeGypBuildDir, 'index.js'));
  copyFile(
    path.join(sourceNodeGypBuildDir, 'node-gyp-build.js'),
    path.join(stagedNodeGypBuildDir, 'node-gyp-build.js'),
  );
  copyIfExists(
    path.join(sourceNodeGypBuildDir, 'LICENSE'),
    path.join(stagedNodeGypBuildDir, 'LICENSE'),
  );

  return stagedDir;
}

module.exports = {
  getPackagedUiohookDir,
  getSourceUiohookDir,
  getStagedUiohookDir,
  getStagedUiohookBaseName,
  stageUiohookBundle,
  stageMacOSUiohookBundle: stageUiohookBundle, // backward compat alias
};
