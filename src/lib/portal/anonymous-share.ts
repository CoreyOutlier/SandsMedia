// Public anonymous shares use an explicit allowlist, never a spread of a
// patient, session, media, or approval object. New internal fields stay private.
export type AnonymousPhoto = { id: string; title: string; thumbnail: string; stream: string; download: string };
export type AnonymousShareData = { mode: "anonymous"; expiresAt: string; download: string; photos: AnonymousPhoto[] };

export function anonymousPhotoName(position: number) {
  return `photo-${String(position + 1).padStart(2, "0")}.jpg`;
}

export function anonymousShareData(link: { id: string; expiresAt: Date }, photos: { mediaId: string; position: number }[], ticket: string): AnonymousShareData {
  const query = new URLSearchParams({ ticket }).toString();
  return {
    mode: "anonymous",
    expiresAt: link.expiresAt.toISOString(),
    download: `/api/download/share/${link.id}?${query}`,
    photos: photos.map(photo => ({
      id: photo.mediaId,
      title: `Photo ${String(photo.position + 1).padStart(2, "0")}`,
      thumbnail: `/api/media/${photo.mediaId}/thumbnail?${query}`,
      stream: `/api/media/${photo.mediaId}/stream?${query}`,
      download: `/api/media/${photo.mediaId}/download?${query}`,
    })),
  };
}

// Require an intentional fixed selection. Duplicate or malformed IDs are not
// silently dropped: that could share a different set than the user reviewed.
export function validAnonymousSelection(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) &&
    new Set(value).size === value.length;
}
