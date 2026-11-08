// Checks real responses against documents/openapi.yaml: the status must be documented for the operation, the
// body must validate against the documented schema, and it must not contain fields the contract does not know.
import { readFileSync } from "node:fs";
import AjvModule, { type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { parse } from "yaml";

// ajv and ajv-formats are CommonJS: under NodeNext their default import is the module object, not the function.
const Ajv = AjvModule as unknown as typeof AjvModule.default;
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

type Node = Record<string, unknown>;

const spec = parse(readFileSync(new URL("../../documents/openapi.yaml", import.meta.url), "utf8")) as Node & {
  paths: Record<string, Record<string, Node>>;
  components: Node;
};

// OpenAPI keywords such as `example` are not JSON Schema, so strict mode is off; `nullable` is understood by Ajv.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map<string, ValidateFunction>();

function pointer(ref: string): Node {
  let node: unknown = spec;
  for (const part of ref.replace(/^#\//, "").split("/")) node = (node as Node)[part];
  return node as Node;
}

function resolve(node: Node): Node {
  const ref = node["$ref"];
  return typeof ref === "string" ? resolve(pointer(ref)) : node;
}

/** The declared properties of an object schema, following $ref and allOf. */
function propertiesOf(node: Node): Record<string, Node> {
  const resolved = resolve(node);
  const own = (resolved["properties"] ?? {}) as Record<string, Node>;
  const merged = ((resolved["allOf"] ?? []) as Node[]).map(propertiesOf);
  const all: Record<string, Node> = {};
  for (const properties of merged) Object.assign(all, properties);
  return Object.assign(all, own);
}

/** Paths of fields present in `value` that the schema does not declare. */
export function undocumentedFields(node: Node, value: unknown, path = "$"): string[] {
  const schema = resolve(node);
  if (Array.isArray(value)) {
    const items = schema["items"] as Node | undefined;
    return items ? value.flatMap((item, i) => undocumentedFields(items, item, `${path}[${i}]`)) : [];
  }
  if (typeof value !== "object" || value === null) return [];

  const declared = propertiesOf(schema);
  // A free-form object (additionalProperties, or no properties at all) documents no fixed field list.
  if (Object.keys(declared).length === 0 || schema["additionalProperties"]) return [];
  return Object.entries(value as Node).flatMap(([key, child]) =>
    key in declared ? undocumentedFields(declared[key] as Node, child, `${path}.${key}`) : [`${path}.${key}`],
  );
}

function validatorFor(schema: Node): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = validators.get(key);
  if (cached) return cached;
  // $refs in the spec are absolute pointers into the whole document, so compile with the components alongside.
  const validate = ajv.compile({ ...schema, components: spec.components });
  validators.set(key, validate);
  return validate;
}

export interface ContractResult {
  problems: string[];
  body: unknown;
}

/** Compares a response with what the contract documents for `method specPath` and `res.status`. */
export async function checkResponse(res: Response, method: string, specPath: string): Promise<ContractResult> {
  const problems: string[] = [];
  const operation = spec.paths[specPath]?.[method.toLowerCase()];
  if (!operation) return { problems: [`${method} ${specPath} is not in the contract`], body: undefined };

  const responses = operation["responses"] as Record<string, Node>;
  const documented = responses[String(res.status)];
  const text = await res.text();
  if (!documented) {
    return {
      problems: [`${method} ${specPath} answered ${res.status}, which the contract does not document`],
      body: text,
    };
  }

  const media = (resolve(documented)["content"] as Record<string, { schema?: Node }> | undefined)?.["application/json"];
  if (!media?.schema) {
    if (text !== "") problems.push(`${method} ${specPath} ${res.status} should have no body`);
    return { problems, body: undefined };
  }

  const body: unknown = text === "" ? undefined : JSON.parse(text);
  const validate = validatorFor(media.schema);
  if (!validate(body)) {
    for (const error of validate.errors ?? [])
      problems.push(`${error.instancePath || "$"} ${error.message ?? "is invalid"}`);
  }
  problems.push(...undocumentedFields(media.schema, body).map((field) => `${field} is not documented`));
  return { problems, body };
}

/** Every method + path the contract describes, with {params} left in place. */
export function documentedOperations(): { method: string; path: string }[] {
  const methods = ["get", "post", "put", "patch", "delete"];
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    methods.filter((method) => item[method]).map((method) => ({ method: method.toUpperCase(), path })),
  );
}
