import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "key123", CLOUDINARY_API_SECRET: "secretXYZ" },
}));

import { renditionFor, signCloudinaryParams, signedDeliveryUrl, signedUploadParams } from "@/server/media/cloudinary";
import { formatMoney, minorToInput, parseMoneyInput } from "@/lib/money";
import { incomingTransformation } from "@/lib/domain/media";

describe("cloudinary signing", () => {
  it("upload params are server-chosen and signed over exactly those params", () => {
    const p = signedUploadParams({ publicId: "photoxo/a/b/c", resourceType: "video", now: new Date(1_700_000_000_000) });
    expect(p.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo/video/upload");
    expect(p.fields).toMatchObject({ public_id: "photoxo/a/b/c", timestamp: 1_700_000_000, type: "authenticated", overwrite: "false", api_key: "key123" });
    expect(p.fields.signature).toBe(
      signCloudinaryParams({ public_id: "photoxo/a/b/c", timestamp: 1_700_000_000, type: "authenticated", overwrite: "false" }, "secretXYZ"),
    );
  });

  it("compression on arrival is part of the signed request (can't be stripped by the browser)", () => {
    const t = incomingTransformation("VERSION_MEDIA", "video/quicktime");
    expect(t).toEqual({ transformation: "c_limit,w_1920,h_1920,q_auto:good,vc_h264,ac_aac", format: "mp4" });
    const p = signedUploadParams({ publicId: "photoxo/a/v", resourceType: "video", now: new Date(1_700_000_000_000), ...t });
    expect(p.fields).toMatchObject({ transformation: t.transformation, format: "mp4" });
    expect(p.fields.signature).toBe(
      signCloudinaryParams({ public_id: "photoxo/a/v", timestamp: 1_700_000_000, type: "authenticated", overwrite: "false", ...t }, "secretXYZ"),
    );
    expect(incomingTransformation("VERSION_MEDIA", "image/jpeg").transformation).toBe("c_limit,w_2560,h_2560,q_auto:good");
    expect(incomingTransformation("BRAND_LOGO", "image/png").transformation).toBe("c_limit,w_512,h_512,q_auto:good");
    expect(incomingTransformation("RECEIPT", "application/pdf")).toEqual({});
  });

  it("delivery URLs are signed over transformation + public id + format", () => {
    const url = signedDeliveryUrl({ publicId: "photoxo/a/x", resourceType: "video", format: "mp4", transformation: "c_limit,h_720,q_auto,vc_auto" });
    const toSign = "c_limit,h_720,q_auto,vc_auto/photoxo/a/x.mp4";
    const sig = createHash("sha1").update(toSign + "secretXYZ").digest("base64").replace(/\+/g, "-").replace(/\//g, "_").slice(0, 8);
    expect(url).toBe(`https://res.cloudinary.com/demo/video/authenticated/s--${sig}--/${toSign}`);
    expect(renditionFor("video")).toEqual({ transformation: "c_limit,h_720,q_auto,vc_auto", format: "mp4" });
    expect(renditionFor("raw")).toEqual({});
  });
});

describe("money (integer minor units)", () => {
  it("parses and formats without floating point", () => {
    expect(parseMoneyInput("1250.5")).toBe(125050);
    expect(parseMoneyInput("0.07")).toBe(7);
    expect(parseMoneyInput("1,23,456.78")).toBe(12345678);
    for (const bad of ["", "abc", "1.234", "-1", "1e5", "12 34"]) expect(parseMoneyInput(bad)).toBeNull();
    expect(minorToInput(125005)).toBe("1250.05");
    expect(formatMoney(12345678, "INR")).toBe("₹1,23,456.78");
    expect(formatMoney(7, "INR")).toBe("₹0.07");
  });
});
