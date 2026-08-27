"use client";

/** Telechargement d'une image générée, sans dependance externe. */

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "png";
}

/** Nom de fichier lisible, dérivé de la demande et de l'horodatage. */
export function buildAssetFilename(request: string, extension: string): string {
  const slug = request
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${slug || "asset"}-${stamp}.${extension}`;
}
