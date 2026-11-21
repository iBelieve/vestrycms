import type { ComponentConfig, Schema } from "../../../config/types.js";
import type { PMNode } from "../../../mdx/types.js";

const COMPONENT_NODES = new Set(["mdxComponent", "mdxInlineComponent"]);

/**
 * `doc` with `convert` applied to the props of each component node whose
 * component is configured with props. Other nodes are kept as they are.
 */
export function mapComponentProps(
  doc: PMNode,
  components: Record<string, ComponentConfig>,
  convert: (
    schema: Schema,
    props: Record<string, unknown>,
  ) => Record<string, unknown>,
): PMNode {
  const visit = (node: PMNode): PMNode => {
    let next = node;
    if (COMPONENT_NODES.has(node.type)) {
      const schema = components[String(node.attrs?.name)]?.props;
      const props = node.attrs?.props;
      if (schema && props && typeof props === "object")
        next = {
          ...node,
          attrs: {
            ...node.attrs,
            props: convert(schema, props as Record<string, unknown>),
          },
        };
    }
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return visit(doc);
}
