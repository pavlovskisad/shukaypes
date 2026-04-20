// Layer 4: structured actions the companion CAN emit. ~300 tokens. Cached.
// Phase 4: format is documented but the server currently ignores action blocks
// and returns plain text to the client. Phase 5 wires these to quests / spots.
// Any byte change here breaks cache — edit only with intent.

export const ACTIONS_SYSTEM = `ACTIONS (optional)
You may append a single line at the very end of your reply in this exact format, and only if it helps the human:

  <<act:NAME:JSON>>

Supported NAMEs:
  start_quest    — JSON: {"dogId":"..."}          begin a detective quest for a lost dog
  set_waypoint   — JSON: {"lat":..,"lng":..,"note":".."}   drop a pin the human should walk to
  highlight_spot — JSON: {"spotId":"..."}         draw attention to a partner spot
  collect_reward — JSON: {"kind":"token","value":1}        give the human a reward for good behavior

Rules:
- Never invent dog or spot IDs. Omit the action if you don't have a real ID from context.
- Never emit more than one action per reply.
- The action line is machine-parsed and not shown to the human — keep your chat text natural.
- Most replies should have NO action. Only use when the human clearly asked to go somewhere, find someone, or take an action.
`;
