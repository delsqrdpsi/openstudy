/**
 * Time each configured image backend on the same prompts so the default is a
 * measured choice. Run: pnpm --filter @openstudy/tutor bench:images
 */
import { imageStore } from "./index";
import { GeminiImages } from "./gemini";
import { OpenAIImages } from "./openai";
import { FalImages } from "./fal";
import type { ImageBackend } from "./types";

const PROMPTS = [
  "A small robot in a maze reaching for a glowing coin, with a loop of arrows labelled action, state, reward",
  "A clear portrait photo dissolving into static noise in four panels, with an arrow underneath going back from noise to photo",
  "A child on a bicycle wobbling, a trail of cookies behind, labelled 'reward'",
];

const backends: ImageBackend[] = [];
for (const make of [
  () => new GeminiImages(imageStore),
  () => new OpenAIImages(imageStore),
  () => new FalImages(imageStore),
]) {
  try {
    backends.push(make());
  } catch {
    /* key not set */
  }
}
if (!backends.length) {
  console.log("No image keys set. Set GEMINI_API_KEY, OPENAI_API_KEY or FAL_KEY.");
  process.exit(1);
}

for (const b of backends) {
  const times: number[] = [];
  for (const [i, prompt] of PROMPTS.entries()) {
    const t0 = performance.now();
    try {
      const r = await b.generate({ id: `bench_${b.name}_${i}`, prompt });
      times.push(performance.now() - t0);
      console.log(b.name, `${(times.at(-1)! / 1000).toFixed(1)}s`, r.url);
    } catch (e) {
      console.log(b.name, "failed:", (e as Error).message);
    }
  }
  if (times.length) console.log(`== ${b.name}: median ${(median(times) / 1000).toFixed(1)}s over ${times.length}`);
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
