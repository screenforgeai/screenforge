import { protocol } from 'electron';
import fs from 'node:fs';
import { Readable } from 'node:stream';

type ParsedByteRange =
  | {
      ok: true;
      start: number;
      end: number;
    }
  | {
      ok: false;
    };

const parseByteRange = (rangeHeader: string, fileSize: number): ParsedByteRange => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return { ok: false };
  }

  const [, startStr, endStr] = match;
  if (!startStr && !endStr) {
    return { ok: false };
  }

  if (fileSize <= 0) {
    return { ok: false };
  }

  const parseSafeInteger = (value: string): number | null => {
    if (!/^\d+$/.test(value)) {
      return null;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  if (!startStr) {
    const suffixLength = parseSafeInteger(endStr);
    if (suffixLength === null || suffixLength <= 0) {
      return { ok: false };
    }

    return {
      ok: true,
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    };
  }

  const start = parseSafeInteger(startStr);
  if (start === null || start >= fileSize) {
    return { ok: false };
  }

  if (!endStr) {
    return {
      ok: true,
      start,
      end: fileSize - 1,
    };
  }

  const requestedEnd = parseSafeInteger(endStr);
  if (requestedEnd === null || requestedEnd < start) {
    return { ok: false };
  }

  return {
    ok: true,
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
};

const decodeScreenforgeFilePath = (urlString: string): string | null => {
  const { hostname, pathname } = new URL(urlString);
  const encodedPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const host = hostname.toLowerCase();
  const legacyWindowsHost = /^local([a-z])$/.exec(host);

  // Legacy Windows form: the drive letter was parsed into the hostname,
  // e.g. screenforge://localc/Users/... → C:\Users\...
  if (legacyWindowsHost) {
    const driveLetter = legacyWindowsHost[1].toUpperCase();
    const windowsPath = decodeURIComponent(pathname).replace(/\//g, '\\');
    return `${driveLetter}:${windowsPath.startsWith('\\') ? windowsPath : `\\${windowsPath}`}`;
  }

  if (host !== 'local') {
    return null;
  }

  const decodedPayload = decodeURIComponent(encodedPath);
  if (decodedPayload.startsWith('/') || /^[a-z]:[\\/]/i.test(decodedPayload)) {
    return decodedPayload;
  }

  const decodedPathname = decodeURIComponent(pathname);
  if (/^\/[a-z]:[\\/]/i.test(decodedPathname)) {
    return decodedPathname.slice(1);
  }

  return decodedPathname;
};

export const __testing = {
  decodeScreenforgeFilePath,
  parseByteRange,
};

export const registerProtocols = (): void => {
  // Serve local files via screenforge://local/<encoded absolute-path>
  // Range requests are handled so Chromium can seek video.
  protocol.handle('screenforge', (req) => {
    const filePath = decodeScreenforgeFilePath(req.url);
    if (!filePath) {
      return new Response('Bad request', { status: 400 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const fileSize = stat.size;
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const contentType =
      ext === 'mp4'
        ? 'video/mp4'
        : ext === 'webm'
          ? 'video/webm'
          : ext === 'mov'
            ? 'video/quicktime'
            : 'video/mp4';

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, fileSize);
      if (!range.ok) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${fileSize}`,
            'Content-Type': contentType,
          },
        });
      }

      const { start, end } = range;
      const webStream = Readable.toWeb(
        fs.createReadStream(filePath, { start, end }),
      ) as ReadableStream;
      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': contentType,
        },
      });
    }

    const webStream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(fileSize),
        'Content-Type': contentType,
      },
    });
  });
};
