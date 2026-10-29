// Preserve user-facing Unicode titles without allowing a filename to introduce
// header lines, path components, or extra Content-Disposition parameters.
export function downloadDisposition(value: string): string {
  const name = (value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "media").toWellFormed();
  const fallback = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
