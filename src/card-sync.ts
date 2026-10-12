import { outbox, type NostrEvent } from '@napplet/sdk';
import type { FormatId } from './formats.js';

/**
 * Relay-backed card sync. Saved cards are published as NIP-78
 * application-specific-data events (kind 30078) so they follow the account
 * across devices without polluting the kind-1 note feed.
 *
 * One event per card, addressed by a `type-zoo:<id>` d-tag. Re-saving the same
 * card republishes the same d-tag, so relays keep only the latest version.
 * Content is plaintext JSON: the metadata is private-in-practice (it never
 * surfaces as a public post), not encrypted.
 */

export type CardRecord = {
  id: string;
  title: string;
  body: string;
  date: string;
  formatId: FormatId;
  createdAt: number;
  updatedAt: number;
};

const CARD_SYNC_KIND = 30078;
const CARD_D_PREFIX = 'type-zoo:';
const CARD_TAG = 'type-zoo';

function cardDValue(id: string): string {
  return `${CARD_D_PREFIX}${id}`;
}

function idFromDValue(value: string): string | null {
  return value.startsWith(CARD_D_PREFIX) ? value.slice(CARD_D_PREFIX.length) : null;
}

function serialize(card: CardRecord): string {
  return JSON.stringify({ v: 1, type: 'card', ...card });
}

function parseCard(content: string): CardRecord | null {
  try {
    const value = JSON.parse(content) as Partial<CardRecord> & { v?: number; type?: string };
    if (value?.v !== 1 || value.type !== 'card') return null;
    if (
      typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.body !== 'string'
      || typeof value.date !== 'string' || typeof value.formatId !== 'string'
      || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number'
    ) return null;
    return value as CardRecord;
  } catch {
    return null;
  }
}

/** Publish one card as a NIP-78 event; a repeat save replaces the prior version. */
export async function publishCardRecord(card: CardRecord): Promise<boolean> {
  const result = await outbox.publish({
    kind: CARD_SYNC_KIND,
    content: serialize(card),
    tags: [['d', cardDValue(card.id)], ['t', CARD_TAG]],
    created_at: Math.floor(Date.now() / 1000),
  });
  return result.ok;
}

function parseCardEvent(event: NostrEvent): CardRecord | null {
  const d = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!d) return null;
  const card = parseCard(event.content);
  return card && card.id === idFromDValue(d) ? card : null;
}

/** Fetch the account's saved cards from its relays. */
export async function queryCardRecords(selfPubkey: string): Promise<CardRecord[]> {
  const result = await outbox.query({ kinds: [CARD_SYNC_KIND], authors: [selfPubkey] });
  if (result.error || !Array.isArray(result.events)) return [];
  const byId = new Map<string, CardRecord>();
  for (const { event } of result.events) {
    const card = parseCardEvent(event);
    if (!card) continue;
    const existing = byId.get(card.id);
    if (!existing || card.updatedAt > existing.updatedAt) byId.set(card.id, card);
  }
  return [...byId.values()];
}

/** Publish a NIP-09 deletion request for a card's addressable event. */
export async function deleteCardRecord(id: string, selfPubkey: string): Promise<boolean> {
  const address = `${CARD_SYNC_KIND}:${selfPubkey}:${cardDValue(id)}`;
  const result = await outbox.publish({
    kind: 5,
    content: '',
    tags: [['a', address], ['k', String(CARD_SYNC_KIND)]],
    created_at: Math.floor(Date.now() / 1000),
  });
  return result.ok;
}

/** Public Blossom servers we feel safe suggesting when the user has none. */
export const RECOMMENDED_BLOSSOM_SERVERS = ['https://blossom.band'] as const;

/**
 * Publish the user's Blossom server list (BUD-03, kind 10063). Shells that do
 * BUD-03 discovery read this event to find where to upload, so a user who signs
 * one never has to configure an image host by hand again.
 */
export async function publishBlossomServerList(servers: readonly string[]): Promise<boolean> {
  const result = await outbox.publish({
    kind: 10063,
    content: '{}',
    tags: servers.map((url) => ['server', url]),
    created_at: Math.floor(Date.now() / 1000),
  });
  return result.ok;
}
