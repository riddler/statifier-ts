// The shape of a driver state, checked before anything decodes it.
//
// A state reaches the driver from wherever a host kept it - storage, a
// network, an older build - so the driver checks every field's presence and
// type first and refuses a state that does not have the shape, naming the
// first field that fails by its path into the state (`timers[0].dueMs`,
// `datamodel.renewals`). The reference refuses an export it is asked to
// resume the same way: `Statifier.Position.import/2` checks every required
// key is present and then each one's shape (`check_required_keys/1` and
// `check_shapes/1` in statifier-ex at v2.9.0) before it reads a state id.
// The check here covers the reference's keys and the driver's own.
//
// What a shape check cannot see - a state id the chart does not hold, a
// tagged-value text that does not decode, a pending timer whose send is not
// a delayed one - is refused by the decode that follows.

type Check = (value: unknown) => boolean;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString: Check = (value) => typeof value === "string";
const isBoolean: Check = (value) => typeof value === "boolean";
const isCount: Check = (value) => Number.isInteger(value) && (value as number) >= 0;
const isTime: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isStringList: Check = (value) => Array.isArray(value) && value.every(isString);

function oneOf(...allowed: readonly unknown[]): Check {
  return (value) => allowed.includes(value);
}

function orNull(check: Check): Check {
  return (value) => value === null || check(value);
}

// The first failing field of an object, by path, or null. Each check runs on
// the field's value; a missing field is undefined and fails every check.
function firstFailure(
  path: string,
  value: unknown,
  checks: readonly (readonly [string, (value: unknown, at: string) => string | null])[],
): string | null {
  if (!isObject(value)) return path === "" ? "state" : path;
  for (const [field, check] of checks) {
    const at = path === "" ? field : `${path}.${field}`;
    const failed = check(value[field], at);
    if (failed !== null) return failed;
  }
  return null;
}

// A field checked by a plain predicate fails at its own path.
function plain(check: Check): (value: unknown, at: string) => string | null {
  return (value, at) => (check(value) ? null : at);
}

// An optional field: absent passes, present must pass the predicate.
function optional(check: Check): (value: unknown, at: string) => string | null {
  return (value, at) => (value === undefined || check(value) ? null : at);
}

function list(
  item: (value: unknown, at: string) => string | null,
): (value: unknown, at: string) => string | null {
  return (value, at) => {
    if (!Array.isArray(value)) return at;
    for (const [i, entry] of value.entries()) {
      const failed = item(entry, `${at}[${i}]`);
      if (failed !== null) return failed;
    }
    return null;
  };
}

function record(
  entry: (value: unknown, at: string) => string | null,
): (value: unknown, at: string) => string | null {
  return (value, at) => {
    if (!isObject(value)) return at;
    for (const [key, item] of Object.entries(value)) {
      const failed = entry(item, `${at}.${key}`);
      if (failed !== null) return failed;
    }
    return null;
  };
}

const OWNER_FIELDS: Readonly<Record<string, readonly string[]>> = {
  onentry: ["stateIndex", "ordinal"],
  onexit: ["stateIndex", "ordinal"],
  transition: ["tIndex"],
  finalize: ["stateIndex", "invokeIndex"],
};

const ORIGIN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  transition: ["tIndex"],
  content: ["cIndex"],
  state: ["stateIndex"],
  donedata_param: ["stateIndex", "paramIndex"],
  data: ["dIndex"],
  global_script: ["index"],
  invoke: ["stateIndex", "invokeIndex"],
  finalize: ["stateIndex", "invokeIndex"],
};

// A tagged union of plain counts: a known kind, and a count in each field it names.
function counted(
  fields: Readonly<Record<string, readonly string[]>>,
): (value: unknown, at: string) => string | null {
  return (value, at) => {
    if (!isObject(value)) return at;
    const kind = value.kind;
    const named =
      typeof kind === "string" && Object.hasOwn(fields, kind) ? fields[kind] : undefined;
    if (named === undefined) return `${at}.kind`;
    for (const field of named) {
      if (!isCount(value[field])) return `${at}.${field}`;
    }
    return null;
  };
}

const owner = counted(OWNER_FIELDS);

function origin(value: unknown, at: string): string | null {
  const failed = counted(ORIGIN_FIELDS)(value, at);
  if (failed !== null) return failed;
  return isObject(value) && value.kind === "content" ? owner(value.owner, `${at}.owner`) : null;
}

const COUNTERS = [
  ["macrostep", plain(isCount)],
  ["microstep", plain(isCount)],
  ["round", plain(isCount)],
] as const;

function cause(value: unknown, at: string): string | null {
  return firstFailure(at, value, [["origin", origin], ...COUNTERS]);
}

function queuedEvent(value: unknown, at: string): string | null {
  return firstFailure(at, value, [
    ["name", plain(isString)],
    ["type", plain(oneOf("external", "internal", "platform"))],
    ["data", plain(isString)],
    ["cause", (v, a) => (v === undefined ? null : cause(v, a))],
    ["sendid", optional(isString)],
    ["origin", optional(isString)],
    ["origintype", optional(isString)],
    ["invokeid", optional(isString)],
  ]);
}

function sendRecord(value: unknown, at: string): string | null {
  return firstFailure(at, value, [
    ["kind", plain(oneOf("send", "send_delayed"))],
    ["event", plain(isString)],
    ["target", plain(isString)],
    ["type", plain(isString)],
    ["data", plain(isString)],
    ["sendId", plain(isString)],
    ["idFromAuthor", plain(isBoolean)],
    ["cIndex", plain(isCount)],
    ["owner", owner],
    ...COUNTERS,
    ["ordinal", plain(orNull(isCount))],
    ["delayMs", plain(orNull(isTime))],
  ]);
}

function timer(value: unknown, at: string): string | null {
  return firstFailure(at, value, [
    ["sendId", plain(isString)],
    ["dueMs", plain(isTime)],
    ["sequence", plain(isCount)],
    ["send", sendRecord],
  ]);
}

function identity(value: unknown, at: string): string | null {
  return firstFailure(at, value, [
    ["contentHash", plain(isString)],
    ["name", plain(orNull(isString))],
    ["version", plain(orNull(isString))],
  ]);
}

function activeInvocation(value: unknown, at: string): string | null {
  return firstFailure(at, value, [
    ["state", plain(isString)],
    ["invokeIndex", plain(isCount)],
    ["invokeId", plain(isString)],
  ]);
}

function done(value: unknown, at: string): string | null {
  if (value === null) return null;
  return firstFailure(at, value, [
    ["donedata", plain(isString)],
    ["configuration", plain(isStringList)],
  ]);
}

const isRoundBudget: Check = (value) =>
  value === "infinity" || (Number.isInteger(value) && (value as number) > 0);

type FieldCheck = readonly [string, (value: unknown, at: string) => string | null];

// The reference's required export keys (`@required_export_keys` in
// `Statifier.Position`), spelled in camel case, in the order its
// `check_shapes/1` checks them. An exported position is these fields beside
// `identity`, and a driver state holds them first.
const POSITION_FIELDS: readonly FieldCheck[] = [
  ["configuration", plain(isStringList)],
  ["enteredStates", plain(isStringList)],
  ["statesToInvoke", plain(isStringList)],
  ["historyValues", record(plain(isStringList))],
  ["activeInvocations", list(activeInvocation)],
  ["invokeCounter", plain(isCount)],
  ["sendCounter", plain(isCount)],
  ["timerCounter", plain(isCount)],
  ["datamodel", record(plain(isString))],
  ["running", plain(isBoolean)],
  ["status", plain(oneOf("running", "done"))],
  ...COUNTERS,
  ["trace", plain(isBoolean)],
  ["maxMacrostepRounds", plain(isRoundBudget)],
];

/** The required keys of an exported position, in the order they are checked. */
export const POSITION_KEYS: readonly string[] = POSITION_FIELDS.map(([field]) => field);

/**
 * The first required field of an exported position whose type is wrong, by
 * its path into the position, or null when every one has the shape. A key
 * that is not required is not looked at.
 */
export function positionShapeFailure(position: unknown): string | null {
  return firstFailure("", position, POSITION_FIELDS);
}

/**
 * The first field of a driver state whose presence or type is wrong, by its
 * path into the state, or null when the whole state has the shape.
 */
export function stateShapeFailure(state: unknown): string | null {
  return firstFailure("", state, [
    ["identity", identity],
    ...POSITION_FIELDS,
    ["sessionId", plain(isString)],
    ["nowMs", plain(isTime)],
    ["timers", list(timer)],
    ["timerSequence", plain(isCount)],
    ["externalQueue", list(queuedEvent)],
    ["internalQueue", list(queuedEvent)],
    ["heldSends", record(plain(isStringList))],
    ["halted", plain(oneOf(null, "budget_exhausted"))],
    ["done", done],
  ]);
}
