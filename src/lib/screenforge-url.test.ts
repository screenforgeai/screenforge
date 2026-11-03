import { describe, expect, it } from 'vitest';
import { createScreenforgeFileUrl } from './screenforge-url';

describe('createScreenforgeFileUrl', () => {
  it('encodes POSIX absolute paths as protocol-safe payloads', () => {
    expect(createScreenforgeFileUrl('/Users/mo/Temp/video file.mp4')).toBe(
      'screenforge://local/%2FUsers%2Fmo%2FTemp%2Fvideo%20file.mp4',
    );
  });

  it('encodes Windows drive paths without letting the drive become the host', () => {
    expect(createScreenforgeFileUrl('C:\\Users\\MOIZAR~1\\AppData\\Local\\Temp\\video.mp4')).toBe(
      'screenforge://local/C%3A%5CUsers%5CMOIZAR~1%5CAppData%5CLocal%5CTemp%5Cvideo.mp4',
    );
  });
});
