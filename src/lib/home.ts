// Where a visit to "/" goes. The company website and the ERP share one domain: a brand-new installation
// still opens first-run setup, a signed-in person goes to the ERP, everyone else sees the public website.
export type HomeDestination = "/setup" | "/dashboard" | "website";

export function homeDestination(state: { setupNeeded: boolean; signedIn: boolean }): HomeDestination {
  if (state.setupNeeded) return "/setup";
  return state.signedIn ? "/dashboard" : "website";
}
