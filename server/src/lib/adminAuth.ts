// Token checks for the operator-facing surfaces.
//
// Lifted out of routes/admin.ts so /stats, the report endpoint and (next)
// the admin console all ask the same question the same way. Two copies of
// an auth rule is how one of them ends up looser than the other.
//
// TWO KEYS, DELIBERATELY.
//
//   ADMIN_TOKEN   opens everything, including /admin/lost-dogs/ingest,
//                 which can put any pet into the database. It should
//                 never be pasted into a browser or a dashboard.
//   REPORT_TOKEN  opens the read-only surfaces and nothing else.
//   DASHBOARD_TOKEN
//                 opens the metrics endpoints and nothing else. The one
//                 that is safe to live in a browser.
//
// Handing somebody the numbers should not also hand them the ability to
// invent pets — a bad trade for a report, and a worse one when the party
// holding the key is an agent or a dashboard rather than a person.
//
// Fly secrets cannot be read back once set, so "what token do I hand
// over" is answered by minting a fresh REPORT_TOKEN, not by recovering
// the admin one.

export function presentedToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match && match[1] ? match[1].trim() : raw.trim();
}

export function tokenMatches(presented: string, token: string | undefined): boolean {
  if (!token) return false;
  // Constant-time compare to keep timing leaks off the table.
  if (presented.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Writes. ADMIN_TOKEN only — this gates endpoints that can put any pet
 * into the database. Fails closed when the env var is unset.
 */
export function checkAdminAuth(header: string | string[] | undefined): boolean {
  const presented = presentedToken(header);
  return presented != null && tokenMatches(presented, process.env.ADMIN_TOKEN);
}

/**
 * Metrics, for a browser. DASHBOARD_TOKEN is the key meant to be pasted
 * into the admin console and stored there, and it opens NOTHING that
 * writes — it is the only one of the three that is safe to keep in a
 * localStorage on somebody's laptop.
 *
 * REPORT_TOKEN and ADMIN_TOKEN also open it, on the same reasoning as
 * checkReportAuth below: a greater key is not made useless by a lesser
 * one existing. But the console should be handed DASHBOARD_TOKEN only.
 * Fails closed when all three are unset.
 */
export function checkDashboardAuth(header: string | string[] | undefined): boolean {
  const presented = presentedToken(header);
  if (presented == null) return false;
  return (
    tokenMatches(presented, process.env.DASHBOARD_TOKEN) ||
    tokenMatches(presented, process.env.REPORT_TOKEN) ||
    tokenMatches(presented, process.env.ADMIN_TOKEN)
  );
}

/**
 * Reads. REPORT_TOKEN or ADMIN_TOKEN — the greater key is not made
 * useless by the existence of the lesser one. Fails closed when both are
 * unset, which is the right default for anything that reads the pet
 * table or the ingest pipeline's internals.
 */
export function checkReportAuth(header: string | string[] | undefined): boolean {
  const presented = presentedToken(header);
  if (presented == null) return false;
  return (
    tokenMatches(presented, process.env.REPORT_TOKEN) ||
    tokenMatches(presented, process.env.ADMIN_TOKEN)
  );
}
