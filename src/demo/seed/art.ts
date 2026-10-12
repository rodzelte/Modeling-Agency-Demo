// Generated placeholder artwork for the demo: studio-style silhouettes instead
// of photographs, so the sample roster shows no real person. Deterministic: the
// same seed text always produces the same picture.
import sharp from "sharp";

type Palette = { top: string; bottom: string; figure: string; hair: string; light: string };

const PALETTES: Palette[] = [
  { top: "#ece3d7", bottom: "#c9b6a0", figure: "#3b302a", hair: "#1f1814", light: "#fff8ee" },
  { top: "#dde2e7", bottom: "#a7b2be", figure: "#2a323b", hair: "#161b21", light: "#f6f9fc" },
  { top: "#f2dfd9", bottom: "#d7b0a4", figure: "#4a2f2a", hair: "#26130f", light: "#fff4f0" },
  { top: "#e2e5d5", bottom: "#b1b792", figure: "#30361f", hair: "#181c0e", light: "#f8faee" },
  { top: "#34363d", bottom: "#141519", figure: "#cdbba6", hair: "#8d7c69", light: "#5a5d68" },
  { top: "#6a1d26", bottom: "#2a090e", figure: "#ead3c5", hair: "#b89a88", light: "#93323d" },
  { top: "#dfeaf2", bottom: "#a6c1d5", figure: "#23384a", hair: "#12202c", light: "#f5fafd" },
  { top: "#efeeea", bottom: "#c7c4ba", figure: "#2e2d2a", hair: "#151412", light: "#ffffff" },
];

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

// Small deterministic generator (mulberry32).
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A standing figure drawn in its own 400 x 1200 space, then placed by the crop.
function figure(palette: Palette, next: () => number): string {
  const hairStyle = Math.floor(next() * 4);
  const lean = (next() - 0.5) * 10;
  const shoulder = 96 + next() * 26;
  const hair = [
    `<ellipse cx="200" cy="96" rx="70" ry="80"/>`,
    `<path d="M128 100 C120 10 280 10 272 100 L286 330 C262 356 240 300 236 230 L164 230 C160 300 138 356 114 330 Z"/>`,
    `<ellipse cx="200" cy="92" rx="68" ry="76"/><circle cx="200" cy="12" r="30"/>`,
    `<path d="M132 118 C116 20 284 20 268 118 C262 78 236 52 200 52 C164 52 138 78 132 118 Z"/>`,
  ][hairStyle];
  return `<g transform="rotate(${lean.toFixed(2)} 200 600)">
    <g fill="${palette.hair}">${hair}</g>
    <g fill="${palette.figure}">
      <ellipse cx="200" cy="118" rx="60" ry="76"/>
      <path d="M170 172 L230 172 L242 244 L158 244 Z"/>
      <path d="M${200 - shoulder} 262 C${200 - shoulder + 18} 232 170 226 200 226 C230 226 ${200 + shoulder - 18} 232 ${200 + shoulder} 262
        L${200 + shoulder + 16} 520 L${200 + shoulder - 12} 524 L262 330 L256 540 C270 600 280 640 276 700 L252 1160 L214 1160 L204 740 L196 740 L186 1160 L148 1160 L124 700
        C120 640 130 600 144 540 L138 330 L${200 - shoulder + 12} 524 L${200 - shoulder - 16} 520 Z"/>
    </g>
  </g>`;
}

function backdrop(width: number, height: number, palette: Palette, next: () => number, id: string): string {
  const lightX = 20 + next() * 60;
  const lightY = 10 + next() * 35;
  return `<defs>
      <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.top}"/><stop offset="1" stop-color="${palette.bottom}"/></linearGradient>
      <radialGradient id="light${id}" cx="${lightX.toFixed(1)}%" cy="${lightY.toFixed(1)}%" r="75%"><stop offset="0" stop-color="${palette.light}" stop-opacity=".75"/><stop offset="1" stop-color="${palette.light}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg${id})"/>
    <rect width="${width}" height="${height}" fill="url(#light${id})"/>`;
}

export type Art = { bytes: Uint8Array; width: number; height: number; contentType: "image/jpeg" };

async function render(svg: string, width: number, height: number): Promise<Art> {
  const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { bytes: new Uint8Array(bytes), width, height, contentType: "image/jpeg" };
}

// Portrait-format sample photo. `subject` keeps one person's pictures in a
// family of colours; `index` varies the crop and the backdrop.
export function portrait(subject: string, index: number): Promise<Art> {
  const width = 960;
  const height = 1200;
  const base = hash(subject);
  const next = random(hash(`${subject}#${index}`));
  const palette = PALETTES[(base + index * 3) % PALETTES.length];
  // Head-and-shoulders, three-quarter and full-length crops.
  const crops = [
    { scale: 2.5, x: -20, y: 150 },
    { scale: 1.55, x: 170, y: 190 },
    { scale: 0.86, x: 308, y: 110 },
  ];
  const crop = crops[index % crops.length];
  const shiftX = (next() - 0.5) * 120;
  const floor = crop.scale < 1
    ? `<rect y="${height * 0.82}" width="${width}" height="${height * 0.18}" fill="#000" opacity=".1"/><ellipse cx="${width / 2 + shiftX}" cy="${height * 0.955}" rx="190" ry="20" fill="#000" opacity=".2"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${backdrop(width, height, palette, next, "p")}${floor}
    <g transform="translate(${(crop.x + shiftX).toFixed(1)} ${crop.y}) scale(${crop.scale})">${figure(palette, random(base))}</g>
  </svg>`;
  return render(svg, width, height);
}

// Landscape editorial image for website pages (hero banners, content blocks).
export function landscape(subject: string): Promise<Art> {
  const width = 1800;
  const height = 1100;
  const base = hash(subject);
  const next = random(base);
  const palette = PALETTES[base % PALETTES.length];
  const figures = [0, 1, 2].map((slot) => {
    const scale = 0.7 + next() * 0.25;
    const x = 380 + slot * 420 + (next() - 0.5) * 80;
    return `<g transform="translate(${x.toFixed(1)} ${(height - 1180 * scale).toFixed(1)}) scale(${scale.toFixed(3)})" opacity="${slot === 1 ? 1 : 0.82}">${figure(palette, random(base + slot * 97))}</g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${backdrop(width, height, palette, next, "l")}
    <rect y="${height * 0.86}" width="${width}" height="${height * 0.14}" fill="#000" opacity=".12"/>${figures}
  </svg>`;
  return render(svg, width, height);
}

// A one-page PDF with a title and a line of text (built-in Helvetica, no font files).
export function samplePdf(title: string, line: string): Uint8Array {
  const escape = (text: string) => text.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const content = `BT /F1 20 Tf 72 720 Td (${escape(title)}) Tj ET\nBT /F1 11 Tf 72 690 Td (${escape(line)}) Tj ET\nBT /F1 9 Tf 72 664 Td (Sample file generated for the demo. It contains no real information.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
