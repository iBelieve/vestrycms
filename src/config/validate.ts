/**
 * Checks a Vestry config when the integration loads, so a mistake is an
 * error at startup rather than something the control panel quietly ignores.
 */
import { parsePathPattern, templateError } from "../core/paths.js";
import type {
  CollectionConfig,
  ComponentConfig,
  Field,
  Schema,
  VestryConfig,
} from "./types.js";

const fail = (message: string): never => {
  throw new Error(`[vestry] ${message}`);
};

/** Every field in a schema below the top level, with a readable path. */
function nestedFields(schema: Schema, prefix = ""): [string, Field][] {
  return Object.entries(schema).flatMap(([key, field]) => {
    const path = `${prefix}${key}`;
    const inner =
      field.type === "object" || field.type === "tree"
        ? field.fields
        : field.type === "array"
          ? { "[]": field.of }
          : null;
    if (!inner) return [];
    return [
      ...Object.entries(inner).map(([k, f]): [string, Field] => [
        `${path}.${k}`,
        f,
      ]),
      ...nestedFields(inner, `${path}.`),
    ];
  });
}

const isFilenameDate = (field: Field) =>
  field.type === "date" && field.storeIn === "filename";

/** `storeIn: "filename"` only works on one top-level date of a file-per-entry collection. */
function checkFilenameDates(
  what: string,
  schema: Schema,
  filePerEntry: boolean,
) {
  const nested = nestedFields(schema).find(([, field]) =>
    isFilenameDate(field),
  );
  if (nested) {
    fail(
      `${what}: "${nested[0]}" uses storeIn: "filename", which is only for a top-level field`,
    );
  }
  const keys = Object.keys(schema).filter((key) => isFilenameDate(schema[key]));
  if (!keys.length) return;
  if (!filePerEntry) {
    fail(
      `${what}: "${keys[0]}" uses storeIn: "filename", which needs a collection with one file per entry (a "*" in its path)`,
    );
  }
  if (keys.length > 1) {
    fail(
      `${what}: only one field can use storeIn: "filename" (found ${keys.join(", ")})`,
    );
  }
  const field = schema[keys[0]];
  if (field.type === "date" && field.time) {
    fail(
      `${what}: "${keys[0]}" uses storeIn: "filename", which cannot be combined with time`,
    );
  }
}

/** A `{field|filter}` placeholder must name a filter that exists. */
function checkTemplate(what: string, template: string | undefined) {
  const error = template ? templateError(template) : undefined;
  if (error) fail(`${what}: ${error}`);
}

export function validateConfig(config: VestryConfig) {
  if (!config.repo?.owner || !config.repo?.name) {
    fail("config.repo.owner and config.repo.name are required");
  }
  checkTemplate("commitMessage", config.commitMessage);

  for (const [key, col] of Object.entries(config.collections ?? {}))
    checkCollection(config, `collection "${key}"`, col);

  for (const [key, singleton] of Object.entries(config.singletons ?? {})) {
    const what = `singleton "${key}"`;
    checkFilenameDates(what, singleton.schema, false);
    checkTemplate(`${what} previewUrl`, singleton.previewUrl);
    checkTemplate(`${what} commitMessage`, singleton.commitMessage);
  }

  for (const [name, component] of Object.entries(config.components ?? {}))
    checkComponent(name, component);

  try {
    JSON.stringify(config);
  } catch {
    fail("config must be JSON-serializable (no functions)");
  }
}

function checkCollection(
  config: VestryConfig,
  what: string,
  col: CollectionConfig,
) {
  if (!col.path) fail(`${what} needs a path`);
  for (const name of col.body ? (col.body.components ?? []) : []) {
    if (!config.components?.[name]) {
      fail(`${what} references unknown component "${name}"`);
    }
  }
  checkFilenameDates(what, col.schema, !parsePathPattern(col.path).single);
  checkTemplate(`${what} previewUrl`, col.previewUrl);
  checkTemplate(`${what} slug.template`, col.slug?.template);
  // A `*` path lists only the files directly in its directory, so entries
  // created in subfolders would never show up again.
  if (col.slug?.template?.includes("/") && !parsePathPattern(col.path).deep) {
    fail(
      `${what} slug.template contains "/", which needs a "**" wildcard in its path`,
    );
  }
  // The tree nests entries by the folders in their slugs: a `*` path has
  // none, and a single file's ids need not be unique paths at all.
  if (col.tree && !parsePathPattern(col.path).deep) {
    fail(`${what} sets tree, which needs a "**" wildcard in its path`);
  }
  checkTemplate(`${what} commitMessage`, col.commitMessage);
}

function checkComponent(name: string, component: ComponentConfig) {
  const props = component.props ?? {};
  const dated = [...Object.entries(props), ...nestedFields(props)].find(
    ([, field]) => isFilenameDate(field),
  );
  if (dated) {
    fail(
      `component "${name}": "${dated[0]}" uses storeIn: "filename", which is only for collection fields`,
    );
  }
}
