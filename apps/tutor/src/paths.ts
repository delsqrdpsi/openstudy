import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, whatever directory the server was started from. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Where lessons, pictures and the brain's working directory live. DATA_DIR
 * from .env is taken relative to the repository root (where .env sits), so
 * `DATA_DIR=./data` means <repo>/data no matter how the server is launched.
 */
export function dataDir(): string {
  const d = process.env.DATA_DIR?.trim();
  if (!d) return resolve(REPO_ROOT, "data");
  return isAbsolute(d) ? d : resolve(REPO_ROOT, d);
}
