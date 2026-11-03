export const createScreenforgeFileUrl = (filePath: string): string =>
  `screenforge://local/${encodeURIComponent(filePath)}`;
