import { describe, expect, it } from "vitest";
import { detectImageType } from "./images.ts";

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

describe("detectImageType", () => {
  it.each([
    ["jpg", [0xff, 0xd8, 0xff, 0xe0]],
    ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d]],
    ["gif", ascii("GIF89a")],
    ["webp", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]],
  ])("recognizes %s", (extension, bytes) => {
    expect(detectImageType(new Uint8Array(bytes))?.extension).toBe(extension);
  });

  it.each([
    ["SVG, which can contain scripts", ascii("<svg xmlns=")],
    ["HTML", ascii("<!doctype html>")],
    ["an empty file", []],
  ])("rejects %s", (_name, bytes) => {
    expect(detectImageType(new Uint8Array(bytes))).toBeNull();
  });
});
