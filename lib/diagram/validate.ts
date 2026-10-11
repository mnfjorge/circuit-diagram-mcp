import Ajv2020, { type AnySchemaObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectEphemeralDefinitions, resolveDefinition } from "./definitions";
import type { Diagram } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const componentDefinitionSchema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schema/component-definition.schema.json"), "utf8"),
) as AnySchemaObject;

const diagramSchema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schema/diagram.schema.json"), "utf8"),
) as AnySchemaObject;

// diagramSchema's per-component "definition" property $refs into this schema
// (by $id), so it must be registered first for those $refs to resolve.
ajv.addSchema(componentDefinitionSchema);
const validateSchema = ajv.compile(diagramSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a diagram against schema/diagram.schema.json, then against
 * things JSON Schema can't express: a component's type must either exist in
 * data/components/*.json or carry an inline "definition" (validated and
 * deduped via collectEphemeralDefinitions), connections must reference
 * components and pins that exist, and component ids must be unique.
 */
export function validateDiagram(data: unknown): ValidationResult {
  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? []).map((err) => `${err.instancePath || "(root)"} ${err.message}`);
    return { valid: false, errors };
  }

  const diagram = data as Diagram;
  const errors: string[] = [];
  const componentIds = new Set<string>();
  const regionIds = new Set<string>();

  for (const region of diagram.regions ?? []) {
    if (regionIds.has(region.id)) {
      errors.push(`Duplicate region id "${region.id}"`);
    }
    regionIds.add(region.id);
  }
  const componentById = new Map(diagram.components.map((c) => [c.id, c]));

  const ephemeral = collectEphemeralDefinitions(diagram);
  errors.push(...ephemeral.errors);

  for (const component of diagram.components) {
    if (componentIds.has(component.id)) {
      errors.push(`Duplicate component id "${component.id}"`);
    }
    componentIds.add(component.id);

    if (component.region !== undefined && !regionIds.has(component.region)) {
      errors.push(
        `Component "${component.id}" references unknown region "${component.region}". Declare it in "regions" first.`,
      );
    }

    if (!resolveDefinition(component.type, ephemeral.definitions)) {
      errors.push(
        `Component "${component.id}" has unknown type "${component.type}". Use list_component_types to see valid types, or include an inline "definition" to create it on the fly for this diagram.`,
      );
    }
  }

  for (const connection of diagram.connections) {
    for (const [role, ref] of [
      ["from", connection.from],
      ["to", connection.to],
    ] as const) {
      const component = componentById.get(ref.component);
      if (!component) {
        errors.push(`Connection "${role}" references unknown component id "${ref.component}"`);
        continue;
      }

      const definition = resolveDefinition(component.type, ephemeral.definitions);
      if (definition && !definition.pins.some((pin) => pin.name === ref.pin)) {
        const validPins = definition.pins.map((pin) => pin.name).join(", ");
        errors.push(
          `Connection "${role}" references pin "${ref.pin}" which doesn't exist on component "${ref.component}" (type "${component.type}"). Valid pins: ${validPins}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
