import DOMPurify from "dompurify";
import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";

/**
 * Turn a clean model-authored SVG into a hand-drawn one: every shape is
 * re-drawn with rough.js, geometry gets a shared pencil-noise filter, and text
 * is kept crisp in its own group.
 */
export interface SketchOptions {
  roughness?: number;
  bowing?: number;
  seed?: number;
  noise?: boolean;
}

const GEOMETRY = new Set(["line", "rect", "circle", "ellipse", "polyline", "polygon", "path"]);
// Event handlers (onclick, onload, ...) and links never survive into the page.
const DANGEROUS_ATTR = /^(on.*|xlink:href|href)$/i;

export function sketchSvg(svgText: string, opts: SketchOptions = {}): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const src = doc.documentElement;
  if (src.nodeName !== "svg") return "";

  const out = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const viewBox = src.getAttribute("viewBox") ?? `0 0 ${src.getAttribute("width") ?? 300} ${src.getAttribute("height") ?? 200}`;
  out.setAttribute("viewBox", viewBox);
  out.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  out.style.overflow = "visible";

  const rc: RoughSVG = rough.svg(out, {
    options: { roughness: opts.roughness ?? 0.9, bowing: opts.bowing ?? 1, seed: opts.seed ?? 7, strokeWidth: 1.6 },
  });

  const noiseId = "wb-pencil-noise";
  const geom = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const text = document.createElementNS("http://www.w3.org/2000/svg", "g");
  if (opts.noise !== false) {
    out.appendChild(noiseFilter(noiseId));
    geom.setAttribute("filter", `url(#${noiseId})`);
  }
  geom.setAttribute("data-wb", "geometry");
  text.setAttribute("data-wb", "text");
  text.setAttribute("data-fade", "");

  walk(src, geom, text, rc);
  out.appendChild(geom);
  out.appendChild(text);
  // Belt and braces: the result is set as innerHTML, so it goes through the
  // same sanitizer as text blocks, with the SVG and filter profiles.
  return DOMPurify.sanitize(new XMLSerializer().serializeToString(out), { USE_PROFILES: { svg: true, svgFilters: true } });
}

function walk(node: Element, geom: SVGGElement, text: SVGGElement, rc: RoughSVG) {
  for (const child of Array.from(node.children)) {
    const name = child.nodeName.toLowerCase();
    if (name === "script" || name === "foreignobject" || name === "image" || name === "a") continue;
    if (name === "text") {
      text.appendChild(cleanText(child));
      continue;
    }
    if (name === "g" || name === "svg") {
      const gg = document.createElementNS("http://www.w3.org/2000/svg", "g");
      copyTransform(child, gg);
      const tg = document.createElementNS("http://www.w3.org/2000/svg", "g");
      copyTransform(child, tg);
      walk(child, gg, tg, rc);
      if (gg.childNodes.length) geom.appendChild(gg);
      if (tg.childNodes.length) text.appendChild(tg);
      continue;
    }
    if (!GEOMETRY.has(name)) continue;
    const drawn = drawShape(child, rc);
    if (drawn) {
      copyTransform(child, drawn);
      geom.appendChild(drawn);
    }
  }
}

function num(el: Element, attr: string, fallback = 0): number {
  const v = parseFloat(el.getAttribute(attr) ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function style(el: Element) {
  const stroke = el.getAttribute("stroke") ?? "#222";
  const fillAttr = el.getAttribute("fill");
  const fill = fillAttr && fillAttr !== "none" ? fillAttr : undefined;
  const strokeWidth = num(el, "stroke-width", 1.6);
  return {
    stroke: stroke === "none" ? "none" : stroke,
    strokeWidth,
    fill,
    fillStyle: "hachure" as const,
    hachureGap: 5,
    fillWeight: 0.8,
  };
}

function drawShape(el: Element, rc: RoughSVG): SVGGElement | null {
  const name = el.nodeName.toLowerCase();
  const s = style(el);
  switch (name) {
    case "line":
      return rc.line(num(el, "x1"), num(el, "y1"), num(el, "x2"), num(el, "y2"), s);
    case "rect":
      return rc.rectangle(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), s);
    case "circle":
      return rc.circle(num(el, "cx"), num(el, "cy"), num(el, "r") * 2, s);
    case "ellipse":
      return rc.ellipse(num(el, "cx"), num(el, "cy"), num(el, "rx") * 2, num(el, "ry") * 2, s);
    case "polyline":
    case "polygon": {
      const pts = parsePoints(el.getAttribute("points") ?? "");
      if (pts.length < 2) return null;
      return name === "polygon" ? rc.polygon(pts, s) : rc.linearPath(pts, s);
    }
    case "path": {
      const d = el.getAttribute("d");
      return d ? rc.path(d, s) : null;
    }
  }
  return null;
}

function parsePoints(points: string): [number, number][] {
  const nums = points.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

function copyTransform(from: Element, to: Element) {
  const t = from.getAttribute("transform");
  if (t) to.setAttribute("transform", t);
}

function cleanText(el: Element): Element {
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  for (const a of Array.from(el.attributes)) {
    if (DANGEROUS_ATTR.test(a.name)) continue;
    if (a.name === "font-family") continue;
    t.setAttribute(a.name, a.value);
  }
  t.setAttribute("font-family", "var(--wb-font-head)");
  t.textContent = el.textContent;
  return t;
}

function noiseFilter(id: string): SVGDefsElement {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="noise"/>
      <feColorMatrix in="noise" type="luminanceToAlpha" result="alpha"/>
      <feComponentTransfer in="alpha" result="grain"><feFuncA type="table" tableValues="0 0 0 0.35 0.7 1"/></feComponentTransfer>
      <feComposite in="grain" in2="SourceGraphic" operator="in" result="grainOnShape"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.45" result="white"/>
      <feComposite in="white" in2="grainOnShape" operator="in" result="speckle"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="speckle"/></feMerge>
    </filter>`;
  return defs;
}

/**
 * Animated SVG written by the tutor (@motion): shown as drawn, with SMIL
 * animation kept and anything executable or external stripped.
 */
const MOTION_ALLOWED = new Set([
  "svg", "g", "defs", "line", "rect", "circle", "ellipse", "polyline", "polygon", "path", "text", "tspan", "title",
  "animate", "animatetransform", "animatemotion", "mpath", "set", "lineargradient", "radialgradient", "stop", "clippath", "mask", "use", "style",
]);
const MOTION_BAD_ATTR = /^(on.*|xlink:href|href|xmlns:xlink)$/i;
// An animation may not retarget a link or an event handler.
const MOTION_BAD_TARGET = /^(on.*|xlink:href|href)$/i;

export function motionSvg(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") return "";
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const name = child.nodeName.toLowerCase();
      if (!MOTION_ALLOWED.has(name)) {
        child.remove();
        continue;
      }
      for (const a of Array.from(child.attributes)) {
        const localRef = name === "use" && (a.name === "href" || a.name === "xlink:href") && a.value.trim().startsWith("#");
        if (localRef) continue;
        if (MOTION_BAD_ATTR.test(a.name)) child.removeAttribute(a.name);
        else if (a.name.toLowerCase() === "attributename" && MOTION_BAD_TARGET.test(a.value.trim())) child.remove();
        else if (a.name === "font-family") child.setAttribute("font-family", "var(--wb-font-head)");
      }
      if (!child.parentNode) continue;
      if (name === "style" && /url\(|@import|expression/i.test(child.textContent ?? "")) child.remove();
      else walk(child);
    }
  };
  for (const a of Array.from(root.attributes)) if (MOTION_BAD_ATTR.test(a.name)) root.removeAttribute(a.name);
  walk(root);
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 300 200");
  root.removeAttribute("width");
  root.removeAttribute("height");
  return new XMLSerializer().serializeToString(root);
}
