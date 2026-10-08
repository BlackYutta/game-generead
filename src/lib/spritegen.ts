import { geminiApiKey } from "./openai";
import { decodePng, encodePng, pixelize, upscale } from "./pixelize";
import type { FileMap } from "./types";

/**
 * Generates a sprite with an image model, then converts it into the toolkit's
 * authored pixel-grid format.
 *
 * The conversion is the point. Shipping raw generated PNGs would give every game
 * a different rendering style, break the palette, and bloat the files. Reducing
 * to a small grid keeps generated art in exactly the same representation as
 * hand-authored art — palette-limited, editable, tiny, and drawn with bake().
 */

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";

/** Wraps the request in the constraints that survive being reduced to ~24px. */
function imagePrompt(description: string, view: string): string {
  return [
    `A single 2D video game sprite: ${description}.`,
    view === "top-down" ? "Viewed from directly above, top-down." : "Side view, facing right.",
    "Bold simple readable silhouette, thick dark outline, flat cel-shaded colours,",
    "a small number of distinct colour areas, strong contrast between parts.",
    "No gradients, no soft shading, no blur, no drop shadow, no text, no watermark,",
    "no background scenery, no ground, no frame or border.",
    "The subject is centred, whole body visible, on a perfectly flat pure green (#00FF00) background.",
  ].join(" ");
}

/** Gemini image models return an opaque canvas, so clear edge-connected chroma green. */
function removeGreenBackground(png: Buffer): Buffer {
  const bitmap = decodePng(png);
  const { width, height, data } = bitmap;
  if (data[3] < 255) return png;

  const key = [data[0], data[1], data[2]];
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    seen[index] = 1;
    const offset = index * 4;
    const distance = (data[offset] - key[0]) ** 2 + (data[offset + 1] - key[1]) ** 2 + (data[offset + 2] - key[2]) ** 2;
    if (distance > 18_000) return;
    data[offset + 3] = 0;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    add(x - 1, y);
    add(x + 1, y);
    add(x, y - 1);
    add(x, y + 1);
  }

  return encodePng(bitmap);
}

export interface GeneratedSprite {
  code: string;
  previewPng: Buffer;
  width: number;
  height: number;
  colours: number;
}

/** Pulls the game's existing palette out of config.js so generated art can match it. */
export function paletteFrom(files: FileMap): string[] {
  const config = files["config.js"] ?? "";
  return [...config.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
}

export async function generateSprite(
  description: string,
  {
    width = 24,
    height = 28,
    colours = 5,
    view = "side",
    name = "SPRITE",
    matchPalette = [] as string[],
  } = {}
): Promise<GeneratedSprite> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGE_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey(),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt(description, view) }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
        },
      }),
    }
  );

  const result = await response.json() as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(result.error?.message || `Gemini image request failed (${response.status}).`);
  }
  const b64 = result.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("The Gemini image model returned no image.");

  const image = removeGreenBackground(Buffer.from(b64, "base64"));
  const { sprite, preview } = pixelize(image, {
    width,
    height,
    colours,
    snapTo: matchPalette,
  });

  const paletteLines = Object.entries(sprite.palette)
    .map(([k, v]) => `  ${k}: "${v}",`)
    .join("\n");

  const code =
    `const ${name}_PAL = {\n  ".": null,\n${paletteLines}\n};\n\n` +
    `const ${name} = [\n${sprite.rows.map((r) => `  "${r}",`).join("\n")}\n];`;

  return {
    code,
    previewPng: encodePng(upscale(preview, 8)),
    width,
    height,
    colours: sprite.colours,
  };
}
