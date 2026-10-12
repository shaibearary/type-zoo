import { upload, type UploadResult } from '@napplet/sdk';
import type { CardSnapshot, RenderedCard } from './card-render.js';

const UPLOAD_POLL_MS = 600;
const UPLOAD_TIMEOUT_MS = 90_000;

function isSettled(result: UploadResult): boolean {
  return result.status !== 'pending' && result.status !== 'uploading';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

/**
 * Hand the rendered card to the shell's upload rail. The shell picks the server,
 * signs the rail authorization (NIP-98 or Blossom), and returns a stable URL, so
 * the napplet never holds credentials or network authority of its own.
 */
export async function uploadCardImage(card: RenderedCard, snapshot: CardSnapshot, alt: string): Promise<UploadResult> {
  const result = await upload.upload({
    data: card.blob,
    mimeType: card.mimeType,
    filename: `type-zoo-${snapshot.formatId}-${snapshot.date}.png`,
    caption: alt,
    // The card is already laid out at its final size; a server re-encode would
    // only soften the art.
    noTransform: true,
  });
  if (isSettled(result)) return result;
  return waitForUpload(result.uploadId);
}

/**
 * Poll until the shell reports a terminal state. `upload.onStatus` carries the
 * same transitions and is the hook to use if this ever grows a progress bar.
 */
async function waitForUpload(uploadId: string): Promise<UploadResult> {
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(UPLOAD_POLL_MS);
    const status = await upload.status(uploadId);
    if (isSettled(status)) return status;
  }
  throw new Error('Upload timed out');
}

/**
 * Fold the upload's NIP-94 metadata into the single NIP-92 `imeta` tag a kind 1
 * note carries, preferring whatever the shell measured over our own guesses.
 */
export function buildImetaTag(result: UploadResult, card: RenderedCard, alt: string): string[] {
  const fields = new Map<string, string>();
  for (const [name, value] of result.nip94 ?? []) {
    if (name && value) fields.set(name, value);
  }
  if (result.url) fields.set('url', result.url);
  fields.set('m', result.mimeType ?? card.mimeType);
  if (result.sha256) fields.set('x', result.sha256);
  if (result.originalSha256) fields.set('ox', result.originalSha256);
  if (result.size !== undefined) fields.set('size', String(result.size));
  const dimensions = result.dimensions ?? { width: card.width, height: card.height };
  fields.set('dim', `${dimensions.width}x${dimensions.height}`);
  if (result.blurhash) fields.set('blurhash', result.blurhash);
  fields.set('alt', alt);

  const tag = ['imeta', ...[...fields].map(([name, value]) => `${name} ${value}`)];
  for (const fallback of result.fallbackUrls ?? []) tag.push(`fallback ${fallback}`);
  return tag;
}
