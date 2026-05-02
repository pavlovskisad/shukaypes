// Parses + validates the trailing `<<act:NAME:JSON>>` tag the
// companion can append to a chat reply, into a typed CompanionAction
// the client knows how to dispatch. Unknown names + invalid JSON
// return null (the action is silently dropped — the visible chat
// text still reaches the user). Tag grammar lives in
// prompts/actions.ts; keep them in sync.

export type CompanionAction =
  | { name: 'start_quest'; args: { dogId: string } }
  | { name: 'highlight_spot'; args: { spotId: string } };

const ACTION_TAG_RE = /<<act:([a-z_]+):([\s\S]*?)>>\s*$/;

interface ParseResult {
  visible: string;
  action: CompanionAction | null;
}

export function parseActionTag(raw: string): ParseResult {
  const match = raw.match(ACTION_TAG_RE);
  if (!match) return { visible: raw.trim(), action: null };

  const visible = raw.slice(0, match.index).trim();
  const name = match[1];
  const argsJson = match[2];

  let args: unknown;
  try {
    args = JSON.parse(argsJson ?? 'null');
  } catch {
    return { visible, action: null };
  }

  const action = validate(name, args);
  return { visible, action };
}

function validate(name: string | undefined, args: unknown): CompanionAction | null {
  if (!name || typeof args !== 'object' || args === null) return null;
  const a = args as Record<string, unknown>;

  switch (name) {
    case 'start_quest': {
      const dogId = a.dogId;
      if (typeof dogId !== 'string' || !dogId) return null;
      return { name: 'start_quest', args: { dogId } };
    }
    case 'highlight_spot': {
      const spotId = a.spotId;
      if (typeof spotId !== 'string' || !spotId) return null;
      return { name: 'highlight_spot', args: { spotId } };
    }
    // set_waypoint + collect_reward in the prompt grammar are documented
    // but not wired to client handlers yet — drop silently so a stray
    // emission doesn't surface as a no-op error.
    default:
      return null;
  }
}
