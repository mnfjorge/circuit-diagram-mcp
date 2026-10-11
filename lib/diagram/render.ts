import { Resvg } from "@resvg/resvg-js";
import path from "node:path";
import sharp from "sharp";
import { layoutDiagram, type DiagramLayout, type LayoutEdge, type LayoutNode, type LayoutRegion } from "./layout";
import type { Diagram } from "./types";
import { edgeColor, GROUND_COLOR, POWER_COLOR, SIGNAL_COLORS } from "./wire-colors";

export { edgeColor, GROUND_COLOR, POWER_COLOR, SIGNAL_COLORS };

const MARGIN = 40;
const FONT_FAMILY = "Geist";
const INK = "#1f2933";
const MUTED = "#52606d";

// Serverless runtimes (Vercel included) generally ship no system fonts, so
// asking a raster engine to render SVG <text> via fontconfig - which is what
// sharp/librsvg do - silently draws empty "tofu" boxes instead of glyphs
// (this can go unnoticed locally if your machine happens to have fonts
// installed). resvg sidesteps that: given loadSystemFonts: false and our own
// font files, rendering is identical everywhere. It only emits PNG, so sharp
// still does the final PNG -> JPEG conversion (pure raster, no fonts involved).
const FONT_DIR = path.join(process.cwd(), "assets/fonts");
const FONT_FILES = ["Geist-Regular.ttf", "Geist-SemiBold.ttf", "Geist-Bold.ttf"].map((file) =>
  path.join(FONT_DIR, file),
);

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderRegion(region: LayoutRegion): string {
  const virtual = region.kind === "virtual";
  const stroke = virtual ? "#7c5cbf" : "#3e6fa8";
  const fill = virtual ? "#f6f2fd" : "#eef4fb";
  return [
    `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"${virtual ? ' stroke-dasharray="8 5"' : ""} />`,
    `<text x="${region.x + 16}" y="${region.y + 26}" font-family="${FONT_FAMILY}" font-size="14" font-weight="700" fill="${stroke}">${escapeXml(region.label)}</text>`,
  ].join("\n");
}

function renderNode(node: LayoutNode): string {
  const parts: string[] = [
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="#ffffff" stroke="${INK}" stroke-width="2" />`,
    `<text x="${node.x + node.width / 2}" y="${node.y + 20}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="14" font-weight="600" fill="${INK}">${escapeXml(node.label)}</text>`,
    `<text x="${node.x + node.width / 2}" y="${node.y + 36}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="11" fill="${MUTED}">${escapeXml(node.type)}</text>`,
  ];

  for (const pin of node.pins) {
    // pin.x/y is the connecting dot, already offset away from the box by the
    // layout (see PIN_STUB in layout.ts) - the stub just draws the box edge
    // in between, it isn't what creates the spacing.
    const boxEdgeX = pin.side === "WEST" ? node.x : node.x + node.width;
    const textX = pin.side === "WEST" ? pin.x - 6 : pin.x + 6;
    const anchor = pin.side === "WEST" ? "end" : "start";
    parts.push(
      `<line x1="${boxEdgeX}" y1="${pin.y}" x2="${pin.x}" y2="${pin.y}" stroke="${INK}" stroke-width="2" />`,
      `<circle cx="${pin.x}" cy="${pin.y}" r="3" fill="${INK}" />`,
      // Raised above the pin's line (rather than vertically centered on it) so the
      // connecting wire - which continues straight through at the same y - doesn't
      // cross through the label text.
      `<text x="${textX}" y="${pin.y - 6}" text-anchor="${anchor}" font-family="${FONT_FAMILY}" font-size="10" fill="${INK}">${escapeXml(pin.name)}</text>`,
    );
  }

  return parts.join("\n");
}

function renderEdge(edge: LayoutEdge): string {
  if (edge.points.length === 0) return "";
  const path = edge.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return `<path d="${path}" fill="none" stroke="${edgeColor(edge)}" stroke-width="2" />`;
}

export function diagramToSvg(diagram: Diagram, layout: DiagramLayout): string {
  const titleHeight = diagram.title ? 28 : 0;
  const width = Math.ceil(layout.width + MARGIN * 2);
  const height = Math.ceil(layout.height + MARGIN * 2 + titleHeight);

  const body: string[] = [`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`];

  if (diagram.title) {
    body.push(
      `<text x="${width / 2}" y="24" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="${INK}">${escapeXml(diagram.title)}</text>`,
    );
  }

  body.push(`<g transform="translate(${MARGIN}, ${MARGIN + titleHeight})">`);
  for (const region of layout.regions) {
    body.push(renderRegion(region));
  }
  for (const edge of layout.edges) {
    body.push(renderEdge(edge));
  }
  for (const node of layout.nodes) {
    body.push(renderNode(node));
  }
  body.push("</g>");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body.join("\n")}\n</svg>`;
}

export async function renderDiagramToJpeg(diagram: Diagram): Promise<Buffer> {
  const layout = await layoutDiagram(diagram);
  const svg = diagramToSvg(diagram, layout);

  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: FONT_FAMILY,
      sansSerifFamily: FONT_FAMILY,
    },
    background: "#ffffff",
  });
  const png = resvg.render().asPng();

  return sharp(png).jpeg({ quality: 90 }).toBuffer();
}
