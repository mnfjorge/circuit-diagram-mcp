import ELK, { type ElkExtendedEdge, type ElkNode, type ElkPort } from "elkjs/lib/elk.bundled.js";
import type { ComponentPin } from "../components/registry";
import { collectEphemeralDefinitions, resolveDefinition } from "./definitions";
import type { Diagram, DiagramConnection, PinRef, RegionKind } from "./types";

const PIN_SPACING = 24;
const NODE_PADDING = 16;
const MIN_NODE_WIDTH = 160;
const MIN_NODE_HEIGHT = 60;
const CHARS_TO_PX = 7;
// How far a pin's connecting dot sits from the component box. Ports are
// placed out here (not on the box edge) so a wire's routing - and its first
// bend - starts with real clearance from the component instead of hugging it.
const PIN_STUB = 28;
// Approx glyph width for the 10px monospace font pin labels render in
// (see PIN_LABEL_GAP in render.ts / component-node.tsx, which this mirrors).
const PIN_LABEL_CHAR_PX = 6;
const PIN_LABEL_GAP = 6;
// Extra room past a label's own text before another component's wire may
// route through - without this, ELK (which only knows about the component's
// box, not the label sitting past its pin stubs) can legally draw another
// wire's bend straight across the label.
const PIN_LABEL_CLEARANCE = 6;

// Minimum distance a routed wire must run straight out from a pin - along the
// same axis as the pin's own stub - before its first turn. Without this, ELK
// sometimes bends a wire immediately at the port (since every pin on a side
// shares that side's x-coordinate, a vertical trunk line fits neatly right
// through the ports themselves), which reads as the wire ignoring the pin it
// came from rather than extending away from it.
const WIRE_EXIT_CLEARANCE = 16;
// Extra horizontal offset between two pins' clearance jogs on the same side
// of the same component. Without this, every pin on a side shares one x for
// its jog (see WIRE_EXIT_CLEARANCE), so their wires still visually bundle
// into a single overlapping line just past the pins instead of running in
// their own lane - only the sliver right at the port moved.
const WIRE_LANE_GAP = 4;

// Room a region's box reserves around its components. The top is larger to
// fit the region's title.
const REGION_PADDING_TOP = 44;
const REGION_PADDING_SIDE = 28;
const REGION_PADDING_BOTTOM = 28;
const REGION_ID_PREFIX = "region:";
// Minimum gap between two gates on the same region side.
const GATE_SPACING = 20;

export type PinSide = "WEST" | "EAST";

export interface LayoutPin {
  name: string;
  label?: string;
  side: PinSide;
  x: number;
  y: number;
}

export interface LayoutNode {
  componentId: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pins: LayoutPin[];
}

export interface LayoutEdge {
  id: string;
  points: { x: number; y: number }[];
  from: PinRef;
  to: PinRef;
}

/** A point on a region's border where the wires of one pin cross in or out of the region. */
export interface LayoutGate {
  side: PinSide;
  x: number;
  y: number;
}

export interface LayoutRegion {
  id: string;
  label: string;
  kind: RegionKind;
  gates: LayoutGate[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  regions: LayoutRegion[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

function pinId(componentId: string, pinName: string): string {
  return `${componentId}::${pinName}`;
}

function connectionId(connection: DiagramConnection, index: number): string {
  return connection.id ?? `edge-${index}`;
}

function estimateNodeWidth(label: string, pinLabels: string[]): number {
  const longestPin = pinLabels.reduce((max, text) => Math.max(max, text.length), 0);
  // Room for a pin label on each side plus the box's own interior.
  const contentWidth = Math.max(label.length * CHARS_TO_PX, longestPin * CHARS_TO_PX * 2 + 60);
  return Math.max(MIN_NODE_WIDTH, contentWidth);
}

function nodeHeight(westCount: number, eastCount: number): number {
  return Math.max(MIN_NODE_HEIGHT, Math.max(westCount, eastCount) * PIN_SPACING + NODE_PADDING * 2);
}

/**
 * How far a side's pin labels reach out past PIN_STUB - the width ELK needs
 * to treat as part of this node's footprint so its own edgeNode spacing
 * keeps *other* components' wires from routing across the label text. 0 when
 * the side has no pins, which keeps that side's margin at plain PIN_STUB.
 */
function pinLabelReach(pins: ComponentPin[]): number {
  const widest = pins.reduce((max, pin) => Math.max(max, pin.name.length * PIN_LABEL_CHAR_PX), 0);
  return widest === 0 ? 0 : PIN_LABEL_GAP + widest + PIN_LABEL_CLEARANCE;
}

/**
 * Nests component nodes inside one ELK compound node per region (components
 * without a region, or pointing at an unknown one, stay at the top level).
 * Empty regions are dropped. Shared by both layout passes so region
 * membership affects where components land in each.
 */
function groupByRegion(diagram: Diagram, componentNodes: ElkNode[], gatePorts: Map<string, ElkPort[]> = new Map()): ElkNode[] {
  const regions = diagram.regions ?? [];
  if (regions.length === 0) return componentNodes;

  const regionById = new Map(regions.map((region) => [region.id, region]));
  const componentRegion = new Map(diagram.components.map((component) => [component.id, component.region]));
  const members = new Map<string, ElkNode[]>();
  const result: ElkNode[] = [];

  for (const node of componentNodes) {
    const regionId = componentRegion.get(node.id);
    if (regionId !== undefined && regionById.has(regionId)) {
      members.set(regionId, [...(members.get(regionId) ?? []), node]);
    } else {
      result.push(node);
    }
  }

  for (const region of regions) {
    const children = members.get(region.id);
    if (!children) continue;
    result.push({
      id: `${REGION_ID_PREFIX}${region.id}`,
      children,
      ports: gatePorts.get(region.id) ?? [],
      layoutOptions: {
        "elk.portConstraints": "FIXED_SIDE",
        // Keeps neighbouring gates (one per crossing wire) visibly apart.
        "elk.spacing.portPort": String(GATE_SPACING),
        "elk.spacing.portsSurrounding": `[top=${GATE_SPACING},left=0,bottom=${GATE_SPACING},right=0]`,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.padding": `[top=${REGION_PADDING_TOP},left=${REGION_PADDING_SIDE},bottom=${REGION_PADDING_BOTTOM},right=${REGION_PADDING_SIDE}]`,
      },
    });
  }
  return result;
}

/**
 * Walks ELK's nested result, returning every component node with its
 * coordinates made absolute (ELK reports children relative to their parent)
 * plus the absolute box of each region.
 */
function flattenResult(
  children: ElkNode[] | undefined,
  offsetX = 0,
  offsetY = 0,
  out: { components: ElkNode[]; regions: Map<string, { x: number; y: number; width: number; height: number; ports: ElkPort[] }> } = {
    components: [],
    regions: new Map(),
  },
) {
  for (const node of children ?? []) {
    const x = (node.x ?? 0) + offsetX;
    const y = (node.y ?? 0) + offsetY;
    if (node.id.startsWith(REGION_ID_PREFIX)) {
      out.regions.set(node.id.slice(REGION_ID_PREFIX.length), {
        x,
        y,
        width: node.width ?? 0,
        height: node.height ?? 0,
        ports: node.ports ?? [],
      });
      flattenResult(node.children, x, y, out);
    } else {
      out.components.push({ ...node, x, y });
    }
  }
  return out;
}

/**
 * Cheap first pass with no ports: edges connect node-to-node directly, so
 * elk only needs to decide each component's column, not route anything. We
 * use the resulting x-centers to decide, per pin, whether the component it
 * connects to sits to the left or right - that's what determines which side
 * of the box the pin (and its wire) should exit from.
 */
async function estimateComponentCenters(
  diagram: Diagram,
): Promise<{ centers: Map<string, number>; regionCenters: Map<string, number> }> {
  const elk = new ELK();
  const ephemeral = collectEphemeralDefinitions(diagram).definitions;

  const nodes: ElkNode[] = diagram.components.map((component) => {
    const definition = resolveDefinition(component.type, ephemeral);
    if (!definition) {
      throw new Error(`Unknown component type "${component.type}" for component "${component.id}"`);
    }
    const half = Math.ceil(definition.pins.length / 2);
    return {
      id: component.id,
      width: estimateNodeWidth(
        component.label ?? definition.label,
        definition.pins.map((pin) => pin.label ?? pin.name),
      ),
      height: nodeHeight(half, definition.pins.length - half),
    };
  });

  const edges: ElkExtendedEdge[] = diagram.connections.map((connection, index) => ({
    id: connectionId(connection, index),
    sources: [connection.from.component],
    targets: [connection.to.component],
  }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT" },
    children: groupByRegion(diagram, nodes),
    edges,
  };
  graph.layoutOptions = { ...graph.layoutOptions, "elk.hierarchyHandling": "INCLUDE_CHILDREN" };

  const result = await elk.layout(graph);
  const flat = flattenResult(result.children);
  const centers = new Map<string, number>();
  for (const node of flat.components) {
    centers.set(node.id, (node.x ?? 0) + (node.width ?? 0) / 2);
  }
  const regionCenters = new Map<string, number>();
  for (const [id, box] of flat.regions) regionCenters.set(id, box.x + box.width / 2);
  return { centers, regionCenters };
}

/** What the preliminary pass learned about where components and regions sit horizontally. */
interface PlacementContext {
  centers: Map<string, number>;
  regionCenters: Map<string, number>;
  /** Region each component sits in (only regions that actually exist). */
  regionOf: Map<string, string | undefined>;
}

/**
 * x positions to compare when deciding which way a wire between two
 * components heads. A wire crossing a region's border really leaves from the
 * region's gate, so for a component inside a region the comparison uses the
 * region's center rather than the component's own - that keeps a pin's side
 * consistent with the side of the gate its wire exits through.
 */
function anchorsFor(
  ctx: PlacementContext,
  componentId: string,
  otherId: string,
): { own: number; other: number } | undefined {
  const ownRegion = ctx.regionOf.get(componentId);
  const otherRegion = ctx.regionOf.get(otherId);
  const crossing = ownRegion !== otherRegion;
  const anchor = (id: string, region: string | undefined) =>
    crossing && region !== undefined ? ctx.regionCenters.get(region) : ctx.centers.get(id);
  const own = anchor(componentId, ownRegion);
  const other = anchor(otherId, otherRegion);
  return own === undefined || other === undefined ? undefined : { own, other };
}

/**
 * Decides which side of the box a pin's connecting dot belongs on, based on
 * whether the component(s) it's wired to sit to the left or right of this
 * one (per the preliminary layout). A pin with connections on both sides, or
 * none at all, falls back to alternating so pins still spread across both
 * sides for box sizing/legibility.
 */
function choosePinSide(
  componentId: string,
  pinName: string,
  diagram: Diagram,
  ctx: PlacementContext,
  fallbackIndex: number,
): PinSide {
  let westVotes = 0;
  let eastVotes = 0;

  for (const connection of diagram.connections) {
    let otherComponent: string | undefined;
    if (connection.from.component === componentId && connection.from.pin === pinName) {
      otherComponent = connection.to.component;
    } else if (connection.to.component === componentId && connection.to.pin === pinName) {
      otherComponent = connection.from.component;
    }
    if (!otherComponent || otherComponent === componentId) continue;

    const anchors = anchorsFor(ctx, componentId, otherComponent);
    if (!anchors) continue;
    if (anchors.other < anchors.own) westVotes++;
    else if (anchors.other > anchors.own) eastVotes++;
  }

  if (westVotes > eastVotes) return "WEST";
  if (eastVotes > westVotes) return "EAST";
  return fallbackIndex % 2 === 0 ? "WEST" : "EAST";
}

/** Which way a wire should run when leaving/arriving at a pin on this side. */
function pinExitDirection(side: PinSide): 1 | -1 {
  return side === "WEST" ? -1 : 1;
}

/**
 * If the segment touching `pin` (the array's first point when end is
 * "start", its last when "end") runs straight vertical, insert a small
 * detour so it instead runs horizontally - in the pin's own exit direction,
 * out to WIRE_EXIT_CLEARANCE plus this pin's own lane offset (see
 * WIRE_LANE_GAP) - before turning, then returns to the pin's exact column
 * to rejoin the original path. Every inserted point shares an x or y with
 * its neighbor, so the result stays strictly orthogonal.
 */
function enforcePinExit(
  points: { x: number; y: number }[],
  dir: 1 | -1,
  lane: number,
  end: "start" | "end",
): { x: number; y: number }[] {
  const pin = end === "start" ? points[0] : points[points.length - 1];
  const neighbor = end === "start" ? points[1] : points[points.length - 2];
  if (neighbor.x !== pin.x) return points;

  const jogX = pin.x + dir * (WIRE_EXIT_CLEARANCE + lane * WIRE_LANE_GAP);
  const out = { x: jogX, y: pin.y };
  const turn = { x: jogX, y: neighbor.y };
  return end === "start" ? [pin, out, turn, ...points.slice(1)] : [...points.slice(0, -1), turn, out, pin];
}

/** Applies enforcePinExit at both ends of a routed wire. */
function enforceHorizontalPinExits(
  points: { x: number; y: number }[],
  fromSide: PinSide,
  fromLane: number,
  toSide: PinSide,
  toLane: number,
): { x: number; y: number }[] {
  if (points.length < 2) return points;
  const withStartExit = enforcePinExit(points, pinExitDirection(fromSide), fromLane, "start");
  return enforcePinExit(withStartExit, pinExitDirection(toSide), toLane, "end");
}

/**
 * Computes node placement and orthogonal wire routing for a diagram using elkjs.
 * Each pin is assigned to the west or east side of its component's box (like
 * a simple IC symbol) based on which side its connected component(s) land
 * on, so wires exit toward where they're actually headed instead of
 * potentially looping around the box.
 */
export async function layoutDiagram(diagram: Diagram): Promise<DiagramLayout> {
  const { centers, regionCenters } = await estimateComponentCenters(diagram);
  const knownRegions = new Set((diagram.regions ?? []).map((region) => region.id));
  const regionOf = new Map(
    diagram.components.map((component) => [
      component.id,
      component.region !== undefined && knownRegions.has(component.region) ? component.region : undefined,
    ]),
  );
  const ctx: PlacementContext = { centers, regionCenters, regionOf };
  const elk = new ELK();
  const ephemeral = collectEphemeralDefinitions(diagram).definitions;

  // Populated per-node below, then used once layout comes back to (a) know
  // which side each pin resolved to without re-deriving it from geometry,
  // and (b) recover the visible box's x/width from the wider footprint ELK
  // was actually given (see pinLabelReach above).
  const pinSides = new Map<string, PinSide>();
  // Each pin's index within its own side's pin list (top-to-bottom) - see
  // WIRE_LANE_GAP, which uses this to keep same-side wires from all sharing
  // one exit column.
  const pinLanes = new Map<string, number>();
  const nodeBoxes = new Map<string, { coreWidth: number; westMargin: number }>();

  const elkNodes: ElkNode[] = diagram.components.map((component) => {
    const definition = resolveDefinition(component.type, ephemeral);
    if (!definition) {
      throw new Error(`Unknown component type "${component.type}" for component "${component.id}"`);
    }

    const sides = new Map<string, PinSide>();
    definition.pins.forEach((pin, index) => {
      sides.set(pin.name, choosePinSide(component.id, pin.name, diagram, ctx, index));
    });

    definition.pins.forEach((pin) => {
      pinSides.set(pinId(component.id, pin.name), sides.get(pin.name) ?? "EAST");
    });

    const west = definition.pins.filter((pin) => sides.get(pin.name) === "WEST");
    const east = definition.pins.filter((pin) => sides.get(pin.name) === "EAST");
    west.forEach((pin, index) => pinLanes.set(pinId(component.id, pin.name), index));
    east.forEach((pin, index) => pinLanes.set(pinId(component.id, pin.name), index));
    const label = component.label ?? definition.label;

    const height = nodeHeight(west.length, east.length);
    const coreWidth = estimateNodeWidth(
      label,
      definition.pins.map((pin) => pin.label ?? pin.name),
    );

    // Each side's margin is PIN_STUB plus room for that side's own pin
    // labels - folding the label footprint into the node's declared width so
    // ELK's edgeNode spacing keeps other components' wires clear of it too.
    const westMargin = PIN_STUB + pinLabelReach(west);
    const eastMargin = PIN_STUB + pinLabelReach(east);
    const width = westMargin + coreWidth + eastMargin;
    nodeBoxes.set(component.id, { coreWidth, westMargin });

    const sidePins = (pins: ComponentPin[], side: PinSide) =>
      pins.map((pin, index) => ({
        id: pinId(component.id, pin.name),
        width: 1,
        height: 1,
        // FIXED_POS below means these coordinates are taken as-is: y is spread
        // evenly down the box's interior, x sits PIN_STUB outside the (core)
        // box edge - westMargin/eastMargin already include that PIN_STUB.
        x: side === "WEST" ? westMargin - PIN_STUB : westMargin + coreWidth + PIN_STUB,
        y: NODE_PADDING + ((index + 0.5) / pins.length) * (height - NODE_PADDING * 2),
      }));

    const ports = [...sidePins(west, "WEST"), ...sidePins(east, "EAST")];

    return {
      id: component.id,
      width,
      height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports,
    };
  });

  // Every wire that crosses a region's border is split into hops that run
  // through that region's gates (one WEST "input" and one EAST "output" port
  // per region, created only when used): external pin -> gate -> internal pin.
  // Hops are routed as separate ELK edges and stitched back into a single
  // wire below, so the region border is only ever crossed at its gates.
  type Waypoint = { kind: "pin"; id: string; component: string } | { kind: "gate"; id: string; region: string };
  interface Hop {
    id: string;
    from: Waypoint;
    to: Waypoint;
    /** Region whose coordinate space ELK reports this hop's points in; undefined = root. */
    container?: string;
  }
  // One gate per pin (and side) that has wires crossing the region border:
  // wires from the same pin - e.g. every consumer of a charger's OUT+ - share
  // that pin's gate, while wires from different pins keep separate ones.
  const gateMeta = new Map<string, { region: string; side: PinSide }>();
  const hopsByConnection = new Map<string, Hop[]>();
  const connectionById = new Map(diagram.connections.map((connection, index) => [connectionId(connection, index), connection]));

  diagram.connections.forEach((connection, index) => {
    const id = connectionId(connection, index);
    const fromComp = connection.from.component;
    const toComp = connection.to.component;
    const fromRegion = regionOf.get(fromComp);
    const toRegion = regionOf.get(toComp);

    const pin = (ref: PinRef): Waypoint => ({ kind: "pin", id: pinId(ref.component, ref.pin), component: ref.component });
    const gateFor = (region: string, own: string, ownPin: string, other: string): Waypoint => {
      const anchors = anchorsFor(ctx, own, other);
      const side: PinSide = anchors && anchors.other < anchors.own ? "WEST" : "EAST";
      const gate = `gate::${region}::${own}::${ownPin}::${side}`;
      gateMeta.set(gate, { region, side });
      return { kind: "gate", id: gate, region };
    };

    const path: Waypoint[] = [pin(connection.from)];
    if (fromRegion !== undefined && fromRegion !== toRegion) path.push(gateFor(fromRegion, fromComp, connection.from.pin, toComp));
    if (toRegion !== undefined && fromRegion !== toRegion) path.push(gateFor(toRegion, toComp, connection.to.pin, fromComp));
    path.push(pin(connection.to));

    const hops: Hop[] = [];
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      // A hop lives inside a region when both ends are in it: two of its
      // components, or one of its components and one of its gates.
      const regionIn = (w: Waypoint) => (w.kind === "gate" ? w.region : regionOf.get(w.component));
      const container = regionIn(a) !== undefined && regionIn(a) === regionIn(b) ? regionIn(a) : undefined;
      hops.push({ id: path.length === 2 ? id : `${id}#${k}`, from: a, to: b, container });
    }
    hopsByConnection.set(id, hops);
  });

  const gatePorts = new Map<string, ElkPort[]>();
  for (const [id, { region, side }] of gateMeta) {
    gatePorts.set(region, [
      ...(gatePorts.get(region) ?? []),
      { id, width: 1, height: 1, layoutOptions: { "elk.port.side": side } },
    ]);
  }

  const elkEdges: ElkExtendedEdge[] = [...hopsByConnection.values()].flatMap((hops) =>
    hops.map((hop) => ({ id: hop.id, sources: [hop.from.id], targets: [hop.to.id] })),
  );

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "80",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.edgeEdge": "12",
      "elk.spacing.edgeNode": "20",
      // Lets wires cross region boundaries and be routed together with the
      // rest of the graph instead of each region being laid out in isolation.
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: groupByRegion(diagram, elkNodes, gatePorts),
    edges: elkEdges,
  };

  const result = await elk.layout(graph);

  const flat = flattenResult(result.children);

  const nodes: LayoutNode[] = flat.components.map((node) => {
    const component = diagram.components.find((c) => c.id === node.id);
    if (!component) {
      throw new Error(`Layout produced an unexpected node id "${node.id}"`);
    }
    const definition = resolveDefinition(component.type, ephemeral);
    if (!definition) {
      throw new Error(`Unknown component type "${component.type}" for component "${component.id}"`);
    }
    const pinByName = new Map(definition.pins.map((pin) => [pin.name, pin]));
    const nodeX = node.x ?? 0;
    const nodeY = node.y ?? 0;
    const box = nodeBoxes.get(component.id) ?? { coreWidth: node.width ?? MIN_NODE_WIDTH, westMargin: 0 };

    const pins: LayoutPin[] = (node.ports ?? []).map((port) => {
      const pinName = port.id.slice(pinId(component.id, "").length);
      const pinDef = pinByName.get(pinName);
      const side: PinSide = pinSides.get(port.id) ?? "EAST";
      return {
        name: pinDef?.name ?? pinName,
        label: pinDef?.label,
        side,
        x: nodeX + (port.x ?? 0),
        y: nodeY + (port.y ?? 0),
      };
    });

    return {
      componentId: component.id,
      type: component.type,
      label: component.label ?? definition.label,
      // node.width from ELK is the widened footprint (core box + label
      // margins on each side, see pinLabelReach) - the visible box is just
      // the core, offset in by westMargin.
      x: nodeX + box.westMargin,
      y: nodeY,
      width: box.coreWidth,
      height: node.height ?? MIN_NODE_HEIGHT,
      pins,
    };
  });

  const routedById = new Map((result.edges ?? []).map((edge) => [edge.id, edge]));

  const edges: LayoutEdge[] = [...hopsByConnection].map(([id, hops]) => {
    const connection = connectionById.get(id)!;
    const points: { x: number; y: number }[] = [];
    for (const hop of hops) {
      const routed = routedById.get(hop.id);
      if (!routed) {
        throw new Error(`Layout produced no route for edge "${hop.id}"`);
      }
      // ELK reports a hop's points relative to its containing region (or the
      // root), so shift them into absolute coordinates.
      const container = hop.container === undefined ? undefined : flat.regions.get(hop.container);
      const offsetX = container?.x ?? 0;
      const offsetY = container?.y ?? 0;
      for (const section of routed.sections ?? []) {
        for (const point of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) {
          const absolute = { x: point.x + offsetX, y: point.y + offsetY };
          // Consecutive hops meet at a gate - keep that shared point once.
          const last = points[points.length - 1];
          if (last && Math.abs(last.x - absolute.x) < 1 && Math.abs(last.y - absolute.y) < 1) continue;
          points.push(absolute);
        }
      }
    }
    const fromPinId = pinId(connection.from.component, connection.from.pin);
    const toPinId = pinId(connection.to.component, connection.to.pin);
    return {
      id,
      points: enforceHorizontalPinExits(
        points,
        pinSides.get(fromPinId) ?? "EAST",
        pinLanes.get(fromPinId) ?? 0,
        pinSides.get(toPinId) ?? "EAST",
        pinLanes.get(toPinId) ?? 0,
      ),
      from: connection.from,
      to: connection.to,
    };
  });

  const regions: LayoutRegion[] = (diagram.regions ?? []).flatMap((region) => {
    const box = flat.regions.get(region.id);
    if (!box) return [];
    const gates: LayoutGate[] = box.ports.map((port) => {
      const side: PinSide = gateMeta.get(port.id)?.side ?? "EAST";
      return { side, x: box.x + (port.x ?? 0), y: box.y + (port.y ?? 0) };
    });
    return [{ id: region.id, label: region.label, kind: region.kind ?? "physical", gates, x: box.x, y: box.y, width: box.width, height: box.height }];
  });

  return {
    width: result.width ?? MIN_NODE_WIDTH,
    height: result.height ?? MIN_NODE_HEIGHT,
    regions,
    nodes,
    edges,
  };
}
