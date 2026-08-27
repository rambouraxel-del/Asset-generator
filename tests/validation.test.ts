import { describe, expect, it } from "vitest";

import { LIMITS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { parseGenerationInput } from "@/lib/validation/generationInput";
import {
  sniffImageMimeType,
  validateReferenceBytes,
  validateReferenceSet,
} from "@/lib/validation/imageFile";

const VALID_INPUT = {
  context: "Pixel art 2D.",
  request: "Un tonneau en bois.",
  size: "1024x1024",
  quality: "high",
  background: "transparent",
  outputFormat: "png",
};

function png(byteLength = 32): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

describe("parseGenerationInput", () => {
  it("accepte une entree valide", () => {
    expect(parseGenerationInput(VALID_INPUT).request).toBe("Un tonneau en bois.");
  });

  it("rejette une demande vide avec le code EMPTY_REQUEST", () => {
    expect(() => parseGenerationInput({ ...VALID_INPUT, request: "   " })).toThrow(
      expect.objectContaining({ code: "EMPTY_REQUEST" }),
    );
  });

  it("rejette un contexte trop long", () => {
    expect(() =>
      parseGenerationInput({ ...VALID_INPUT, context: "x".repeat(LIMITS.CONTEXT_MAX_CHARS + 1) }),
    ).toThrow(expect.objectContaining({ code: "TEXT_TOO_LONG" }));
  });

  it("rejette un reglage inconnu", () => {
    expect(() => parseGenerationInput({ ...VALID_INPUT, size: "9999x9999" })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});

describe("sniffImageMimeType", () => {
  it("reconnait PNG, JPEG et WebP a partir des octets d'en-tete", () => {
    expect(sniffImageMimeType(png())).toBe("image/png");
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");

    const webp = new Uint8Array(16);
    webp.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    expect(sniffImageMimeType(webp)).toBe("image/webp");
  });

  it("renvoie null pour un contenu non image", () => {
    expect(sniffImageMimeType(new Uint8Array(Buffer.from("<?php echo 1; ?>")))).toBeNull();
  });
});

describe("validateReferenceBytes", () => {
  it("accepte un PNG valide", () => {
    expect(validateReferenceBytes("tree.png", "image/png", png()).mimeType).toBe("image/png");
  });

  it("refuse un fichier dont le contenu n'est pas une image, meme bien declare", () => {
    const disguised = new Uint8Array(Buffer.from("not an image at all"));
    expect(() => validateReferenceBytes("fake.png", "image/png", disguised)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_IMAGE_FORMAT" }),
    );
  });

  it("refuse un type declare non supporte", () => {
    expect(() => validateReferenceBytes("doc.gif", "image/gif", png())).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_IMAGE_FORMAT" }),
    );
  });

  it("refuse un fichier trop volumineux", () => {
    expect(() =>
      validateReferenceBytes("big.png", "image/png", png(LIMITS.MAX_FILE_BYTES + 1)),
    ).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });
});

describe("validateReferenceSet", () => {
  const reference = { name: "a.png", mimeType: "image/png" as const, bytes: png() };

  it("refuse plus de references que la limite OpenAI", () => {
    const many = Array.from({ length: LIMITS.MAX_REFERENCES + 1 }, () => reference);
    expect(() => validateReferenceSet(many)).toThrow(
      expect.objectContaining({ code: "TOO_MANY_REFERENCES" }),
    );
  });

  it("refuse un poids cumule excessif", () => {
    const heavy = {
      name: "a.png",
      mimeType: "image/png" as const,
      bytes: png(LIMITS.MAX_FILE_BYTES),
    };
    expect(() => validateReferenceSet([heavy, heavy])).toThrow(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE" }),
    );
  });
});

describe("AppError", () => {
  it("expose un message utilisateur sans detail technique", () => {
    const error = new AppError("OPENAI_AUTH", { detail: "sk-secret leaked here" });
    expect(error.toResponseBody().error.message).not.toContain("sk-secret");
    expect(error.toResponseBody()).not.toHaveProperty("detail");
    expect(error.status).toBe(502);
  });
});
