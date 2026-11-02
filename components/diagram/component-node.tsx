"use client";

import type { Node, NodeProps } from "@xyflow/react";
import type { ComponentDefinition } from "@/lib/components/registry";
import type { LayoutNode, LayoutPin } from "@/lib/diagram/layout";

export interface ComponentNodeData extends Record<string, unknown> {
  layoutNode: LayoutNode;
  definition?: ComponentDefinition;
  onHoverComponent: (node: LayoutNode, definition?: ComponentDefinition) => void;
  onHoverPin: (node: LayoutNode, pin: LayoutPin, definition?: ComponentDefinition) => void;
  onLeave: () => void;
  onClickComponent: (componentId: string) => void;
  /** True when this component is the one currently focused by a click. */
  focused?: boolean;
}

export type ComponentNodeType = Node<ComponentNodeData, "component">;

const PIN_SIZE = 10;
const PIN_LABEL_GAP = 6;
// Raise pin labels above the pin's horizontal stub/wire (both sit at pinY)
// so the wire doesn't visually cross through the label text.
const PIN_LABEL_RAISE = 9;

export function ComponentNode({ data }: NodeProps<ComponentNodeType>) {
  const { layoutNode, definition, onHoverComponent, onHoverPin, onLeave, onClickComponent, focused } = data;

  return (
    <div
      className={`relative cursor-pointer overflow-visible rounded-lg border-2 bg-white shadow-sm dark:bg-zinc-900 ${
        focused ? "border-blue-500 ring-2 ring-blue-500" : "border-zinc-800 dark:border-zinc-200"
      }`}
      style={{ width: layoutNode.width, height: layoutNode.height }}
      onClick={() => onClickComponent(layoutNode.componentId)}
      onMouseEnter={() => onHoverComponent(layoutNode, definition)}
      onMouseLeave={onLeave}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1 truncate px-2 text-center text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        {layoutNode.label}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[22px] truncate px-2 text-center text-[10px] text-zinc-500 dark:text-zinc-400">
        {layoutNode.type}
      </div>

      {layoutNode.pins.map((pin) => {
        const pinX = pin.x - layoutNode.x;
        const pinY = pin.y - layoutNode.y;
        const boxEdgeX = pin.side === "WEST" ? 0 : layoutNode.width;
        const stubLeft = Math.min(boxEdgeX, pinX);
        const stubWidth = Math.abs(pinX - boxEdgeX);
        const labelOnWest = pin.side === "WEST";
        return (
          <div key={pin.name} className="absolute inset-0 overflow-visible" style={{ pointerEvents: "none" }}>
            <div
              className="absolute bg-zinc-900 dark:bg-zinc-100"
              style={{
                left: stubLeft,
                top: pinY - 1,
                width: stubWidth,
                height: 2,
              }}
            />
            <span
              className={`absolute font-mono text-[10px] leading-none text-zinc-900 dark:text-zinc-100 ${
                labelOnWest ? "-translate-x-full text-right" : "text-left"
              }`}
              style={{
                top: pinY - 5 - PIN_LABEL_RAISE,
                left: labelOnWest ? pinX - PIN_LABEL_GAP : pinX + PIN_LABEL_GAP,
              }}
            >
              {pin.name}
            </span>
            <div
              className="absolute rounded-full border border-zinc-900 bg-zinc-900 transition-transform hover:scale-150 dark:border-zinc-100 dark:bg-zinc-100"
              style={{
                width: PIN_SIZE,
                height: PIN_SIZE,
                left: pinX - PIN_SIZE / 2,
                top: pinY - PIN_SIZE / 2,
                cursor: "pointer",
                pointerEvents: "auto",
              }}
              onMouseEnter={(event) => {
                event.stopPropagation();
                onHoverPin(layoutNode, pin, definition);
              }}
              onMouseLeave={(event) => {
                event.stopPropagation();
                onHoverComponent(layoutNode, definition);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
