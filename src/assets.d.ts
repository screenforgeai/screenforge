declare module '*.webp' {
  const url: string;
  export default url;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.jpeg' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.mp3' {
  const url: string;
  export default url;
}

// `?inline` makes Vite embed the file as a base64 data URL.
declare module '*.wav?inline' {
  const dataUrl: string;
  export default dataUrl;
}

// Vite inlines the file's text at build time (used for the bundled CHANGELOG.md).
declare module '*.md?raw' {
  const content: string;
  export default content;
}
