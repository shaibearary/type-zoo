import { UPLOAD_DOMAIN, upload, type UploadResult } from '@napplet/sdk';
import { runtimeHasDomain } from './domain-availability.js';
import type { CardSnapshot, RenderedCard } from './card-render.js';

const UPLOAD_POLL_MS = 600;
const UPLOAD_TIMEOUT_MS = 90_000;

/** Where the shell stands for image upload, from the napplet's point of view. */
export type UploadCapability = 'unavailable' | 'unconfigured' | 'denied' | 'ready';

function isSettled(result: UploadResult): boolean {
  return result.status !== 'pending' && result.status !== 'uploading';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

/**
 * Ask the shell what upload rails it exposes, logging the answer to the console
 * and reducing it to the three states the UI cares about:
 * - `unavailable`: the shell does not even advertise the upload domain.
 * - `unconfigured`: the domain is there but no rail/server is enabled.
 * - `ready`: at least one rail is enabled.
 */
export async function checkUploadCapability(): Promise<UploadCapability> {
  if (!runtimeHasDomain(UPLOAD_DOMAIN)) {
    console.warn('[type-zoo] NAP-UPLOAD: shell does not advertise the "upload" domain; image publishing is unavailable.');
    return 'unavailable';
  }
  try {
    const info = await upload.info();
    const rails = info?.rails ?? [];
    console.info(`[type-zoo] NAP-UPLOAD rails: ${rails.length ? rails.map((rail) => `${rail.rail}${rail.enabled ? '' : ' (disabled)'}`).join(', ') : '(none disclosed)'}`);
    if (info.maxBytes !== undefined) console.info(`[type-zoo] NAP-UPLOAD maxBytes: ${info.maxBytes}`);
    if (info.mimeTypes?.length) console.info(`[type-zoo] NAP-UPLOAD mimeTypes: ${info.mimeTypes.join(', ')}`);
    if (!rails.some((rail) => rail.enabled)) {
      console.warn('[type-zoo] NAP-UPLOAD: no enabled rail — the shell has no image host configured.');
      return 'unconfigured';
    }
    return 'ready';
  } catch (error) {
    console.warn('[type-zoo] NAP-UPLOAD: upload.info() rejected:', error);
    // "policy denied" means the shell has the upload domain but this napplet
    // was not granted it — a permission question, not a missing image host.
    if (String(error).toLowerCase().includes('policy denied')) {
      return 'denied';
    }
    return 'unconfigured';
  }
}

/**
 * Hand the rendered card to the shell's upload rail. The shell picks the server,
 * signs the rail authorization (NIP-98 or Blossom), and returns a stable URL, so
 * the napplet never holds credentials or network authority of its own.
 */
export async function uploadCardImage(card: RenderedCard, snapshot: CardSnapshot, alt: string): Promise<UploadResult> {
  await checkUploadCapability();
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
