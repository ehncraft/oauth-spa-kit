import { describe, expect, it } from "vitest";
import { sealJson, unsealJson } from "../src/crypto";

const PASSWORD = "a".repeat(32);

describe("sealJson / unsealJson", () => {
  it("round-trips arbitrary JSON", async () => {
    const payload = { foo: "bar", n: 42, nested: { a: [1, 2, 3] } };
    const sealed = await sealJson(payload, PASSWORD);
    const result = await unsealJson<typeof payload>(sealed, PASSWORD);
    expect(result).toEqual(payload);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const a = await sealJson({ x: 1 }, PASSWORD);
    const b = await sealJson({ x: 1 }, PASSWORD);
    expect(a).not.toBe(b);
  });

  it("returns null (not a throw) for a tampered value", async () => {
    const sealed = await sealJson({ x: 1 }, PASSWORD);
    const tampered = sealed.slice(0, -4) + (sealed.at(-4) === "A" ? "B" : "A") + sealed.slice(-3);
    await expect(unsealJson(tampered, PASSWORD)).resolves.toBeNull();
  });

  it("returns null for the wrong password", async () => {
    const sealed = await sealJson({ x: 1 }, PASSWORD);
    await expect(unsealJson(sealed, "b".repeat(32))).resolves.toBeNull();
  });

  it("returns null for garbage input rather than throwing", async () => {
    await expect(unsealJson("not-a-real-sealed-value", PASSWORD)).resolves.toBeNull();
  });

  it("rejects a password shorter than 32 characters", async () => {
    await expect(sealJson({ x: 1 }, "short")).rejects.toThrow(/32 characters/);
  });
});
