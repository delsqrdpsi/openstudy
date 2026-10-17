import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Generated images live on disk and are served by the tutor's http server. */
export class ImageStore {
  readonly dir: string;
  constructor(dir = process.env.DATA_DIR ?? resolve(process.cwd(), "../../data")) {
    this.dir = join(dir, "images");
    mkdirSync(this.dir, { recursive: true });
  }
  save(id: string, bytes: Buffer, ext: "png" | "jpg" | "webp"): string {
    const name = `${Date.now()}-${id}.${ext}`;
    writeFileSync(join(this.dir, name), bytes);
    return `${process.env.TUTOR_PUBLIC_URL ?? `http://localhost:${process.env.TUTOR_PORT ?? 8787}`}/images/${name}`;
  }
  read(name: string): { bytes: Buffer; type: string } | null {
    if (!/^[\w.-]+$/.test(name)) return null;
    const p = join(this.dir, name);
    if (!existsSync(p)) return null;
    const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return { bytes: readFileSync(p), type };
  }
}
