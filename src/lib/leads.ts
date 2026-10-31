import "server-only";

// Record-level scope lives in lead-scope.ts so the list exports (and their tests) can use it
export { leadScope } from "./lead-scope";

export { normalizePhone } from "./contacts";
