/** "Chrome on Windows" from a browser's user-agent text; the raw text is no use to a person. */
export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser';
  // Order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\/|Opera/.test(userAgent) ? 'Opera'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : 'A browser';
  const system = /Windows/.test(userAgent) ? 'Windows'
    : /iPhone|iPad/.test(userAgent) ? 'iPhone or iPad'
    : /Android/.test(userAgent) ? 'Android'
    : /Mac OS X/.test(userAgent) ? 'Mac'
    : /Linux/.test(userAgent) ? 'Linux'
    : null;
  return system ? `${browser} on ${system}` : browser;
}
