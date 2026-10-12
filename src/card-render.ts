import pipCallerBackground from './assets/layouts/pip-caller-clean.webp';
import { getCardFormat, type FormatId } from './formats.js';

/** The card fields the renderer needs; a `Draft` satisfies it. */
export type CardSnapshot = { title: string; body: string; date: string; formatId: FormatId };

export type RenderedCard = { blob: Blob; width: number; height: number; mimeType: string };

/**
 * The renderer redraws `.card-canvas` on a canvas so the background art and the
 * typed words leave as one image. Every number below is the CSS px value the
 * card uses at its full `width:min(100%,520px)` layout width, so changes to
 * `src/styles.css` have a one-to-one landing spot here.
 */
const DESIGN_WIDTH = 520;
const EXPORT_SCALE = 2;
const PAPER_HEIGHT = Math.round((DESIGN_WIDTH * 5) / 4); // `aspect-ratio:4/5`
const PHONE_HEIGHT = Math.round((DESIGN_WIDTH * 1494) / 1040); // `aspect-ratio:1040/1494`
/** `padding:9%` and friends resolve against the containing block, not the card. */
const PERCENT_BASIS = DESIGN_WIDTH;

type Box = { x: number; y: number; width: number; height: number };
type BlockStyle = { size: number; minSize: number; lineHeight: number; weight: number };

type PaperStyle = {
  paper: string;
  ink: string;
  family: string;
  radius: number;
  border?: { width: number; color: string };
  innerBorder?: { width: number; color: string };
  rules?: { spacing: number; color: string };
  bodyPanel?: { background: string; marginTop: number; padding: number };
};

/** Mirrors the `.format-*` rules in `src/styles.css`. */
const PAPER_STYLES: Record<Exclude<FormatId, 'pip-caller'>, PaperStyle> = {
  'mallow-note': {
    paper: '#fff6df',
    ink: '#624148',
    family: '"Chalkboard SE","Comic Sans MS",cursive',
    radius: 20,
    rules: { spacing: 35, color: 'rgba(98,65,72,.08)' },
  },
  'pip-pocket': {
    paper: '#b6ee6d',
    ink: '#24372b',
    family: '"American Typewriter","Courier New",monospace',
    radius: 46,
    border: { width: 13, color: '#d8d7d2' },
    innerBorder: { width: 5, color: '#333' },
  },
  'moss-spring': {
    paper: '#6fc779',
    ink: '#174d2a',
    family: 'Georgia,serif',
    radius: 16,
    border: { width: 18, color: '#62b96f' },
    innerBorder: { width: 2, color: '#27683b' },
    bodyPanel: { background: '#f8f6ef', marginTop: 0.04, padding: 0.08 },
  },
};

/** Mirrors the `.card-canvas.format-pip-caller` overrides. */
const PHONE_STYLE = {
  paper: '#d4d4d1',
  ink: '#1c351b',
  family: '"American Typewriter","Courier New",monospace',
  radius: 34,
  left: 0.115,
  width: 0.77,
  title: { top: 0.235, style: { size: 29, minSize: 15, lineHeight: 1.2, weight: 700 } },
  body: { top: 0.29, height: 0.14, style: { size: 22, minSize: 11, lineHeight: 1.35, weight: 400 } },
  date: { top: 0.462, style: { size: 15, minSize: 9, lineHeight: 1.45, weight: 400 } },
} as const;

const PAPER_BLOCKS = {
  decoration: { size: 24, minSize: 12, lineHeight: 1.2, weight: 400 },
  date: { size: 11, minSize: 8, lineHeight: 1.45, weight: 400 },
  title: { size: 45, minSize: 18, lineHeight: 1.2, weight: 700 },
  body: { size: 21, minSize: 10, lineHeight: 1.7, weight: 400 },
  footer: { size: 8, minSize: 8, lineHeight: 1.45, weight: 800 },
} as const satisfies Record<string, BlockStyle>;

/** Characters that may start a new line without a preceding space. */
const BREAKS_ANYWHERE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

let backgroundImage: Promise<HTMLImageElement> | null = null;

/**
 * Hand the bundled phone art to the stylesheet. Keeping the URL in one module
 * means the single-file build inlines those bytes once, for both the live card
 * and the exported image.
 */
export function installCardArtwork(): void {
  document.documentElement.style.setProperty('--pip-caller-art', `url("${pipCallerBackground}")`);
}

/**
 * Load the bundled phone photo. Vite resolves the import to a same-origin URL in
 * dev and to an inline data URL in the single-file build, so the canvas stays
 * untainted and nothing reaches for network authority the napplet does not have.
 */
function loadPhoneBackground(): Promise<HTMLImageElement> {
  backgroundImage ??= new Promise((resolve, reject) => {
    const image = new Image();
    // In dev the artwork is served from Vite's origin, which is cross-origin from
    // the sandboxed iframe's `Origin: null`. Without CORS the canvas it is drawn
    // on becomes tainted and `toBlob` refuses to export. The single-file build
    // inlines it as a same-origin data URL, where this is a harmless no-op.
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Card background failed to load')), { once: true });
    image.src = pipCallerBackground;
  });
  return backgroundImage;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    let breakAt = 0;
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > maxWidth) {
        const cut = BREAKS_ANYWHERE.test(character) ? line.length : breakAt;
        if (cut > 0) {
          lines.push(line.slice(0, cut).trimEnd());
          line = line.slice(cut) + character;
        } else {
          lines.push(line);
          line = character === ' ' ? '' : character;
        }
        breakAt = 0;
      } else {
        line += character;
      }
      if (character === ' ' || BREAKS_ANYWHERE.test(character)) breakAt = line.length;
    }
    lines.push(line);
  }
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string {
  const characters = Array.from(line);
  while (characters.length > 0 && ctx.measureText(`${characters.join('')}…`).width > maxWidth) characters.pop();
  return `${characters.join('')}…`;
}

/**
 * Shrink the type until the wrapped text fits its box, the way the live card
 * clamps its font sizes. Past the floor the last line is ellipsized, matching
 * what the editor's `overflow:hidden` card already shows.
 */
function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Box,
  style: BlockStyle,
  toFont: (size: number) => string,
): { lines: string[]; size: number } {
  for (let size = style.size; size > style.minSize; size -= 1) {
    ctx.font = toFont(size);
    const lines = wrapText(ctx, text, box.width);
    if (lines.length * size * style.lineHeight <= box.height) return { lines, size };
  }
  ctx.font = toFont(style.minSize);
  const lines = wrapText(ctx, text, box.width);
  const limit = Math.max(1, Math.floor(box.height / (style.minSize * style.lineHeight)));
  if (lines.length > limit) {
    lines.length = limit;
    lines[limit - 1] = ellipsize(ctx, lines[limit - 1] ?? '', box.width);
  }
  return { lines, size: style.minSize };
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Box,
  style: BlockStyle,
  family: string,
  align: CanvasTextAlign = 'left',
): number {
  if (!text) return 0;
  const toFont = (size: number) => `${style.weight} ${size}px ${family}`;
  const { lines, size } = fitLines(ctx, text, box, style, toFont);
  ctx.font = toFont(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const anchor = align === 'right' ? box.x + box.width : box.x;
  const halfLeading = ((style.lineHeight - 1) * size) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, anchor, box.y + index * size * style.lineHeight + halfLeading);
  });
  return lines.length * size * style.lineHeight;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  box: Box,
  radius: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

async function drawPhoneCard(ctx: CanvasRenderingContext2D, card: CardSnapshot): Promise<void> {
  const phone = PHONE_STYLE;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, DESIGN_WIDTH, PHONE_HEIGHT, phone.radius);
  ctx.clip();
  ctx.fillStyle = phone.paper;
  ctx.fillRect(0, 0, DESIGN_WIDTH, PHONE_HEIGHT);
  // `background-size:cover` on a box whose aspect ratio already matches the art.
  ctx.drawImage(await loadPhoneBackground(), 0, 0, DESIGN_WIDTH, PHONE_HEIGHT);

  ctx.fillStyle = phone.ink;
  const x = phone.left * DESIGN_WIDTH;
  const width = phone.width * DESIGN_WIDTH;
  const titleTop = phone.title.top * PHONE_HEIGHT;
  const bodyTop = phone.body.top * PHONE_HEIGHT;
  const dateTop = phone.date.top * PHONE_HEIGHT;

  drawBlock(ctx, card.title, { x, y: titleTop, width, height: bodyTop - titleTop }, phone.title.style, phone.family);
  drawBlock(
    ctx,
    card.body,
    { x, y: bodyTop, width, height: phone.body.height * PHONE_HEIGHT },
    phone.body.style,
    phone.family,
  );
  drawBlock(ctx, card.date, { x, y: dateTop, width, height: PHONE_HEIGHT - dateTop }, phone.date.style, phone.family);
  ctx.restore();
}

function drawPaperCard(ctx: CanvasRenderingContext2D, card: CardSnapshot): void {
  const format = getCardFormat(card.formatId);
  const style = PAPER_STYLES[card.formatId as Exclude<FormatId, 'pip-caller'>];
  const border = style.border?.width ?? 0;
  const padding = 0.09 * PERCENT_BASIS;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, DESIGN_WIDTH, PAPER_HEIGHT, style.radius);
  ctx.clip();
  ctx.fillStyle = style.border?.color ?? style.paper;
  ctx.fillRect(0, 0, DESIGN_WIDTH, PAPER_HEIGHT);
  if (border > 0) {
    const inner = { x: border, y: border, width: DESIGN_WIDTH - border * 2, height: PAPER_HEIGHT - border * 2 };
    fillRoundedRect(ctx, inner, Math.max(0, style.radius - border), style.paper);
    if (style.innerBorder) {
      ctx.lineWidth = style.innerBorder.width;
      ctx.strokeStyle = style.innerBorder.color;
      ctx.beginPath();
      const offset = style.innerBorder.width / 2;
      ctx.roundRect(
        inner.x + offset,
        inner.y + offset,
        inner.width - style.innerBorder.width,
        inner.height - style.innerBorder.width,
        Math.max(0, style.radius - border),
      );
      ctx.stroke();
    }
  }
  if (style.rules) {
    ctx.fillStyle = style.rules.color;
    for (let y = style.rules.spacing; y < PAPER_HEIGHT; y += style.rules.spacing) ctx.fillRect(0, y, DESIGN_WIDTH, 1);
  }

  const x = border + padding;
  const width = DESIGN_WIDTH - (border + padding) * 2;
  const footerHeight = 12 + 1 + PAPER_BLOCKS.footer.size * PAPER_BLOCKS.footer.lineHeight;
  const contentBottom = PAPER_HEIGHT - border - padding;
  let y = border + padding;

  ctx.fillStyle = style.ink;
  y += drawBlock(ctx, format.icon, { x, y, width, height: 40 }, PAPER_BLOCKS.decoration, style.family);
  y += drawBlock(ctx, card.date, { x, y, width, height: 24 }, PAPER_BLOCKS.date, style.family, 'right');
  y += 0.08 * PERCENT_BASIS; // `.card-title { margin-top:8% }`
  y += drawBlock(ctx, card.title, { x, y, width, height: 140 }, PAPER_BLOCKS.title, style.family);
  y += 0.05 * PERCENT_BASIS; // `.card-body { padding-top:5% }`

  const panel = style.bodyPanel;
  let bodyBox: Box = { x, y, width, height: contentBottom - footerHeight - y };
  if (panel) {
    const top = y + panel.marginTop * PERCENT_BASIS;
    const inset = panel.padding * PERCENT_BASIS;
    ctx.fillStyle = panel.background;
    ctx.fillRect(x, top, width, contentBottom - footerHeight - top);
    ctx.fillStyle = style.ink;
    bodyBox = {
      x: x + inset,
      y: top + inset,
      width: width - inset * 2,
      height: contentBottom - footerHeight - top - inset * 2,
    };
  }
  drawBlock(ctx, card.body, bodyBox, PAPER_BLOCKS.body, style.family);

  const footerTop = contentBottom - footerHeight;
  ctx.fillStyle = style.ink;
  ctx.fillRect(x, footerTop, width, 1);
  const footerBox = { x, y: footerTop + 12, width, height: footerHeight };
  const footerFamily = 'system-ui,sans-serif';
  drawBlock(ctx, format.name.toUpperCase(), footerBox, PAPER_BLOCKS.footer, footerFamily);
  drawBlock(ctx, String(card.body.length), footerBox, PAPER_BLOCKS.footer, footerFamily, 'right');
  ctx.restore();
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Card image encoding failed'))),
      'image/png',
    );
  });
}

/** Draw the card — background art plus the typed words — as a PNG blob. */
export async function renderCardImage(card: CardSnapshot): Promise<RenderedCard> {
  const isPhone = card.formatId === 'pip-caller';
  const canvas = document.createElement('canvas');
  canvas.width = DESIGN_WIDTH * EXPORT_SCALE;
  canvas.height = (isPhone ? PHONE_HEIGHT : PAPER_HEIGHT) * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable');
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  if (isPhone) await drawPhoneCard(ctx, card);
  else drawPaperCard(ctx, card);
  return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height, mimeType: 'image/png' };
}

/** Alt text that keeps the card's words readable even where the art is not. */
export function cardAltText(card: CardSnapshot): string {
  const format = getCardFormat(card.formatId);
  const words = [card.title.trim(), card.body.trim()].filter(Boolean).join('\n\n');
  return words ? `${format.name} card — ${words}` : `${format.name} card`;
}
