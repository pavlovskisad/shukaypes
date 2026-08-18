// The two dials that decide how loud territory is: the ground field's
// peak (?field=) and the coat on the buildings standing in it (?paint=).
//
// They live in different layers but they are ONE decision — the balance
// between figure and background — and the only place to judge that is a
// real city on a real phone, which no harness here can render. So they
// are dials rather than a round trip per guess. Read once at module
// load; the values are baked into shaders when those are built, so
// tuning is a reload.
//
// This file also used to publish the ground layer's render targets so the
// buildings could read them. That is gone with the depth field it served:
// the buildings now light themselves, one beacon per zone, from data they
// already have.

export function urlTune(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}
