/**
 * Vérifie ce que le code transmet RÉELLEMENT au SDK OpenAI.
 *
 * L'appel réseau n'est pas joué : le client SDK est remplacé par un double qui
 * enregistre ses paramètres. Cela contrôle la forme exacte de la requête
 * (endpoint choisi, paramètres, absence de champ interdit) sans clé API.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const editCalls: unknown[] = [];
const generateCalls: unknown[] = [];

const fakeClient = {
  images: {
    edit: vi.fn(async (params: unknown) => {
      editCalls.push(params);
      return {
        data: [{ b64_json: "AAAA" }],
        usage: {
          input_tokens: 120,
          output_tokens: 1500,
          total_tokens: 1620,
          input_tokens_details: { text_tokens: 20, image_tokens: 100 },
        },
      };
    }),
    generate: vi.fn(async (params: unknown) => {
      generateCalls.push(params);
      return { data: [{ b64_json: "BBBB" }] };
    }),
  },
};

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => fakeClient,
  getImageModel: () => "gpt-image-2",
  isMockMode: () => false,
  isApiKeyConfigured: () => true,
  getTimeoutMs: () => 1000,
}));

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

beforeEach(() => {
  editCalls.length = 0;
  generateCalls.length = 0;
  vi.clearAllMocks();
});

describe("Paramètres transmis au SDK OpenAI", () => {
  it("utilise images.edit avec les références et les bons paramètres", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    await generateAssetImage({
      prompt: "PROMPT DE TEST",
      references: [
        { name: "a.png", mimeType: "image/png", bytes: pngBytes() },
        { name: "b.png", mimeType: "image/png", bytes: pngBytes() },
      ],
      size: "1536x864",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
    });

    expect(editCalls).toHaveLength(1);
    expect(generateCalls).toHaveLength(0);

    const params = editCalls[0] as Record<string, unknown>;
    expect(params.model).toBe("gpt-image-2");
    expect(params.prompt).toBe("PROMPT DE TEST");
    expect(params.size).toBe("1536x864");
    expect(params.quality).toBe("high");
    expect(params.background).toBe("transparent");
    expect(params.output_format).toBe("png");
    expect(params.n).toBe(1);
    expect(Array.isArray(params.image)).toBe(true);
    expect((params.image as unknown[]).length).toBe(2);
  });

  it("ne transmet jamais input_fidelity, rejeté par gpt-image-2", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    await generateAssetImage({
      prompt: "p",
      references: [{ name: "a.png", mimeType: "image/png", bytes: pngBytes() }],
      size: "auto",
      quality: "auto",
      background: "auto",
      outputFormat: "png",
    });

    const params = editCalls[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("input_fidelity");
  });

  it("ne transmet aucun champ de conversation ou d'historique", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    await generateAssetImage({
      prompt: "p",
      references: [{ name: "a.png", mimeType: "image/png", bytes: pngBytes() }],
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
    });

    const params = editCalls[0] as Record<string, unknown>;
    const forbidden = [
      "conversation",
      "previous_response_id",
      "messages",
      "history",
      "metadata",
      "store",
    ];
    for (const key of forbidden) {
      expect(params, `champ interdit transmis : ${key}`).not.toHaveProperty(key);
    }

    // Liste blanche stricte des paramètres envoyés.
    expect(Object.keys(params).sort()).toEqual(
      ["background", "image", "model", "n", "output_format", "prompt", "quality", "size"].sort(),
    );
  });

  it("bascule sur images.generate quand aucune référence n'est activée", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    await generateAssetImage({
      prompt: "p",
      references: [],
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
    });

    expect(editCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).not.toHaveProperty("image");
  });
});

describe("Lecture de la consommation renvoyée par l'API", () => {
  it("répartit les jetons entre texte, image entrée et image sortie", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    const result = await generateAssetImage({
      prompt: "p",
      references: [{ name: "a.png", mimeType: "image/png", bytes: pngBytes() }],
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
    });

    expect(result.usage).toEqual({
      textInputTokens: 20,
      imageInputTokens: 100,
      imageOutputTokens: 1500,
      totalTokens: 1620,
    });
  });

  it("renvoie null quand l'API ne fournit aucune consommation", async () => {
    const { generateAssetImage } = await import("@/lib/openai/imageGeneration");

    // `images.generate` du double ne renvoie pas de bloc `usage`.
    const result = await generateAssetImage({
      prompt: "p",
      references: [],
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
    });

    expect(result.usage).toBeNull();
  });
});
