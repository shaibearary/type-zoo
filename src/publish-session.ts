export type PublicationTracker = {
  has: (fingerprint: string) => boolean;
  record: (fingerprint: string) => void;
};

/** Tracks successful posts for the lifetime of the current napplet runtime. */
export function createPublicationTracker(): PublicationTracker {
  const publishedFingerprints = new Set<string>();

  return {
    has: (fingerprint) => publishedFingerprints.has(fingerprint),
    record: (fingerprint) => { publishedFingerprints.add(fingerprint); },
  };
}
