"use client";

import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Background, Controls, ReactFlow, ViewportPortal } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ComponentDefinition } from "@/lib/components/registry";
import type { DiagramLayout, LayoutEdge, LayoutNode, LayoutPin } from "@/lib/diagram/layout";
import type { Diagram, PinRef } from "@/lib/diagram/types";
import { classifyWire, type WireKind } from "@/lib/diagram/wire-colors";
import { ComponentNode, type ComponentNodeType } from "./component-node";

const nodeTypes = { component: ComponentNode };

const WIRE_KIND_LABEL: Record<WireKind, string> = {
  ground: "Ground wire",
  power: "Power wire",
  signal: "Signal wire",
};

interface HoverInfo {
  /** Identifies the hovered element so the matching wire can be highlighted. */
  id: string;
  title: string;
  subtitle?: string;
  rows: { label: string; value: string }[];
}

function pointsToPath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function pinDisplay(
  ref: PinRef,
  diagram: Diagram,
  componentDefinitions: Record<string, ComponentDefinition>,
): { componentLabel: string; pinLabel: string } {
  const component = diagram.components.find((c) => c.id === ref.component);
  const definition = component ? componentDefinitions[component.type] : undefined;
  const pinDef = definition?.pins.find((p) => p.name === ref.pin);
  return {
    componentLabel: component?.label ?? definition?.label ?? ref.component,
    pinLabel: pinDef?.label ? `${ref.pin} (${pinDef.label})` : ref.pin,
  };
}

export interface InteractiveDiagramProps {
  diagram: Diagram;
  layout: DiagramLayout;
  componentDefinitions: Record<string, ComponentDefinition>;
}

export function InteractiveDiagram({ diagram, layout, componentDefinitions }: InteractiveDiagramProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    setPointer({ x: event.clientX, y: event.clientY });
  }, []);

  const handleHoverComponent = useCallback((node: LayoutNode, definition?: ComponentDefinition) => {
    const rows: { label: string; value: string }[] = [{ label: "Type", value: node.type }];
    if (definition?.category) rows.push({ label: "Category", value: definition.category });
    rows.push({ label: "Pins", value: String(node.pins.length) });
    if (definition?.description) rows.push({ label: "Notes", value: definition.description });
    setHover({ id: `component:${node.componentId}`, title: node.label, rows });
  }, []);

  const handleHoverPin = useCallback((node: LayoutNode, pin: LayoutPin, definition?: ComponentDefinition) => {
    const pinDef = definition?.pins.find((p) => p.name === pin.name);
    const rows: { label: string; value: string }[] = [{ label: "Pin", value: pin.name }];
    if (pinDef?.group) rows.push({ label: "Group", value: pinDef.group });
    rows.push({ label: "Side", value: pin.side === "WEST" ? "Left" : "Right" });
    setHover({
      id: `pin:${node.componentId}:${pin.name}`,
      title: pin.label ?? pin.name,
      subtitle: node.label,
      rows,
    });
  }, []);

  const handleLeave = useCallback(() => setHover(null), []);

  const handleHoverWire = useCallback(
    (edge: LayoutEdge, kind: WireKind) => {
      const from = pinDisplay(edge.from, diagram, componentDefinitions);
      const to = pinDisplay(edge.to, diagram, componentDefinitions);
      setHover({
        id: `wire:${edge.id}`,
        title: WIRE_KIND_LABEL[kind],
        rows: [
          { label: "From", value: `${from.componentLabel} · ${from.pinLabel}` },
          { label: "To", value: `${to.componentLabel} · ${to.pinLabel}` },
        ],
      });
    },
    [diagram, componentDefinitions],
  );

  const nodes = useMemo<ComponentNodeType[]>(
    () =>
      layout.nodes.map((layoutNode) => {
        const component = diagram.components.find((c) => c.id === layoutNode.componentId);
        const definition = component ? componentDefinitions[component.type] : undefined;
        return {
          id: layoutNode.componentId,
          type: "component",
          position: { x: layoutNode.x, y: layoutNode.y },
          selectable: false,
          draggable: false,
          data: {
            layoutNode,
            definition,
            onHoverComponent: handleHoverComponent,
            onHoverPin: handleHoverPin,
            onLeave: handleLeave,
          },
        };
      }),
    [diagram.components, layout.nodes, componentDefinitions, handleHoverComponent, handleHoverPin, handleLeave],
  );

  return (
    <div
      className="relative h-[640px] w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      onMouseMove={handleMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={3}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // Nodes are neither draggable nor selectable, so React Flow marks their
        // wrapper `pointer-events: none` by default - this is otherwise the only
        // hook available to opt back in, letting our node/pin hover handlers fire.
        onNodeMouseEnter={() => {}}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        <ViewportPortal>
          {layout.regions.map((region) => {
            const virtual = region.kind === "virtual";
            return (
              <div
                key={region.id}
                className={`pointer-events-none absolute rounded-xl border-2 ${
                  virtual
                    ? "border-dashed border-violet-500 bg-violet-500/5"
                    : "border-blue-500 bg-blue-500/5"
                }`}
                style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
              >
                <span
                  className={`absolute left-4 top-2 text-sm font-bold ${
                    virtual ? "text-violet-600 dark:text-violet-400" : "text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {region.label}
                </span>
              </div>
            );
          })}
          <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {layout.edges.map((edge) => {
              const { kind, color } = classifyWire(edge);
              // The static JPEG renderer's near-black ground color is only ever drawn on a
              // fixed white background; here the canvas can be dark, so ground wires use a
              // theme-aware CSS variable instead to stay visible in both themes.
              const stroke = kind === "ground" ? "var(--wire-ground)" : color;
              const isHovered = hover?.id === `wire:${edge.id}`;
              const d = pointsToPath(edge.points);
              return (
                <g key={edge.id}>
                  {/* Wide invisible stroke: an easier hover target than the visible 2px wire. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onMouseEnter={() => handleHoverWire(edge, kind)}
                    onMouseLeave={handleLeave}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isHovered ? 4 : 2}
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              );
            })}
          </svg>
        </ViewportPortal>
      </ReactFlow>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: pointer.x + 16, top: pointer.y + 16 }}
        >
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{hover.title}</div>
          {hover.subtitle && <div className="text-zinc-500 dark:text-zinc-400">{hover.subtitle}</div>}
          <dl className="mt-1 space-y-0.5">
            {hover.rows.map((row) => (
              <div key={row.label} className="flex gap-1">
                <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{row.label}:</dt>
                <dd className="text-zinc-700 dark:text-zinc-300">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
