const path = require('node:path');

function getFFmpegExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getFFprobeExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function getFFmpegTargetFolder(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function getBundledFFmpegRelativePath(platform = process.platform, arch = process.arch) {
  return path.join('ffmpeg', getFFmpegTargetFolder(platform, arch), getFFmpegExecutableName(platform));
}

function getBundledFFprobeRelativePath(platform = process.platform, arch = process.arch) {
  return path.join(
    'ffmpeg',
    getFFmpegTargetFolder(platform, arch),
    getFFprobeExecutableName(platform),
  );
}

function getDevBundledFFmpegPath(rootDir, platform = process.platform, arch = process.arch) {
  return path.join(rootDir, 'native', 'bin', getBundledFFmpegRelativePath(platform, arch));
}

function getDevBundledFFprobePath(rootDir, platform = process.platform, arch = process.arch) {
  return path.join(rootDir, 'native', 'bin', getBundledFFprobeRelativePath(platform, arch));
}

function getDevBundledFFmpegDir(rootDir) {
  return path.join(rootDir, 'native', 'bin', 'ffmpeg');
}

function getPackagedFFmpegPath(resourcesPath, platform = process.platform, arch = process.arch) {
  return path.join(resourcesPath, getBundledFFmpegRelativePath(platform, arch));
}

function getPackagedFFprobePath(resourcesPath, platform = process.platform, arch = process.arch) {
  return path.join(resourcesPath, getBundledFFprobeRelativePath(platform, arch));
}

function getDefaultSystemFFmpegCandidates(platform = process.platform) {
  if (platform === 'win32') {
    return [];
  }

  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
}

function getDefaultSystemFFprobeCandidates(platform = process.platform) {
  if (platform === 'win32') {
    return [];
  }

  return ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
}

function getBuildManifestPath(outputDir) {
  return path.join(outputDir, 'build-manifest.json');
}

module.exports = {
  getBuildManifestPath,
  getBundledFFmpegRelativePath,
  getBundledFFprobeRelativePath,
  getDefaultSystemFFmpegCandidates,
  getDefaultSystemFFprobeCandidates,
  getDevBundledFFmpegDir,
  getDevBundledFFmpegPath,
  getDevBundledFFprobePath,
  getFFmpegExecutableName,
  getFFprobeExecutableName,
  getFFmpegTargetFolder,
  getPackagedFFmpegPath,
  getPackagedFFprobePath,
};
