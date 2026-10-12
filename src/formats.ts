export type FormatId = 'mallow-note' | 'pip-pocket' | 'moss-spring' | 'pip-caller';

export type CardFormat = {
  id: FormatId;
  name: string;
  icon: string;
  character: string;
  className: string;
};

/**
 * Every entry is a complete visual package. Add or replace one object and its
 * matching CSS class to change the format shelf without touching editor logic.
 */
export const CARD_FORMATS: readonly CardFormat[] = [
  { id: 'mallow-note', name: 'Mallow Note', icon: 'ʕ·ᴥ·ʔ', character: 'Mallow', className: 'format-mallow-note' },
  { id: 'pip-pocket', name: 'Pip Pocket', icon: '◖•ᴗ•◗', character: 'Pip', className: 'format-pip-pocket' },
  { id: 'moss-spring', name: 'Moss Spring', icon: '（ᵔ◡ᵔ）', character: 'Moss', className: 'format-moss-spring' },
  { id: 'pip-caller', name: 'Pip Caller', icon: '☎', character: 'Pip', className: 'format-pip-caller' },
];

export function getCardFormat(id: FormatId): CardFormat {
  return CARD_FORMATS.find((format) => format.id === id) ?? CARD_FORMATS[0];
}
