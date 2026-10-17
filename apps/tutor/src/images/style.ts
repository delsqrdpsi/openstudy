/** Every picture gets the same style suffix so a board looks like one hand drew it. */
export const SKETCH_STYLE =
  "Hand-drawn pencil sketch with a light watercolor wash, clean white background, simple clear shapes, small handwritten labels, no photorealism, no heavy shading, wide landscape composition.";

export const stylePrompt = (prompt: string) => `${prompt.trim().replace(/\.?$/, ".")} ${SKETCH_STYLE}`;
