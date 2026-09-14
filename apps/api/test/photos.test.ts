import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Photo, Report } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";
import { encodeDemoPng } from "../src/db/demo-assets";

const { app } = await setup();

function pngFile(name = "photo.png"): File {
  const png = encodeDemoPng({ width: 64, height: 40, skyTop: [180, 200, 220], skyBottom: [230, 230, 220], ridgeFar: [100, 120, 100], ridgeNear: [60, 80, 60], band: [200, 120, 40], seed: 2 });
  return new File([new Uint8Array(png)], name, { type: "image/png" });
}

describe("Photos", () => {
  it("accepte une image PNG, la stocke sous /uploads et l'associe au signalement", async () => {
    const user = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", { token: user.token, body: { subtype: "fallen_tree", lat: 42.23, lng: 9.05 } });
    const id = created.body.report.id;
    const form = new FormData();
    form.append("photo", pngFile());
    const res = await call<{ photo: Photo; report: Report }>(app, "POST", `/reports/${id}/photos`, { token: user.token, form });
    expect(res.status).toBe(201);
    expect(res.body.photo.url).toMatch(new RegExp(`^/uploads/${id}/[A-Za-z0-9_-]+\\.png$`));
    expect(res.body.photo.width).toBe(64);
    expect(res.body.photo.height).toBe(40);
    expect(res.body.report.photoUrl).toBe(res.body.photo.url);
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR as string, id, path.basename(res.body.photo.url)))).toBe(true);

    const served = await app.request(res.body.photo.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");

    const detail = await call<{ report: Report }>(app, "GET", `/reports/${id}`);
    expect(detail.body.report.photos).toHaveLength(1);
  });

  it("refuse les fichiers qui ne sont pas des images et les formulaires sans photo", async () => {
    const user = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", { token: user.token, body: { subtype: "obstacle", lat: 42.23, lng: 9.05 } });
    const id = created.body.report.id;

    const fake = new FormData();
    fake.append("photo", new File([new TextEncoder().encode("<script>alert(1)</script>")], "image.png", { type: "image/png" }));
    const rejected = await call<{ error: { code: string } }>(app, "POST", `/reports/${id}/photos`, { token: user.token, form: fake });
    expect(rejected.status).toBe(415);
    expect(rejected.body.error.code).toBe("unsupported_media_type");

    const empty = new FormData();
    empty.append("autre", "valeur");
    const missing = await call<{ error: { code: string } }>(app, "POST", `/reports/${id}/photos`, { token: user.token, form: empty });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("validation_error");

    const anon = new FormData();
    anon.append("photo", pngFile());
    expect((await call(app, "POST", `/reports/${id}/photos`, { form: anon })).status).toBe(401);
  });

  it("bloque la traversée de répertoire sur /uploads", async () => {
    const res = await app.request("/uploads/../package.json");
    expect(res.status).toBe(404);
  });
});
