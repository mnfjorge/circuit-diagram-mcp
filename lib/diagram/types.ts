import type { ComponentPin } from "../components/registry";

export interface PinRef {
  component: string;
  pin: string;
}

export interface DiagramConnection {
  id?: string;
  from: PinRef;
  to: PinRef;
}

/** An ad-hoc component type definition scoped to a single diagram; see schema/component-definition.schema.json (minus 'type', which comes from the component's own 'type' field). */
export interface InlineComponentDefinition {
  label: string;
  category: string;
  description?: string;
  pins: ComponentPin[];
}

export type RegionKind = "physical" | "virtual";

/** A named group of components drawn as a bordered box, e.g. the physical device vs. the software/cloud side. */
export interface DiagramRegion {
  id: string;
  label: string;
  /** Styling hint only: "physical" regions get a solid border, "virtual" ones a dashed border. Defaults to "physical". */
  kind?: RegionKind;
  description?: string;
}

export interface DiagramComponent {
  id: string;
  type: string;
  label?: string;
  /** id of the region this component belongs to; omitted means it sits outside every region. */
  region?: string;
  /** Only present when 'type' isn't a registered component type; defines it on the fly for this diagram. */
  definition?: InlineComponentDefinition;
}

export interface Diagram {
  id: string;
  title?: string;
  regions?: DiagramRegion[];
  components: DiagramComponent[];
  connections: DiagramConnection[];
}
