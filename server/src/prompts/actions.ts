// Layer 4: structured actions the companion CAN emit. Cached.
// Live wired in services/actionParser.ts → app/(tabs)/chat.tsx
// dispatch. Any byte change here breaks the prompt cache; edit with
// intent.

export const ACTIONS_SYSTEM = `ACTIONS (optional)
You may append exactly one line at the very end of your reply in this exact format, and only when it helps the human take a real next step:

  <<act:NAME:JSON>>

Supported NAMEs:
  start_quest — JSON: {"dogId":"..."}    begin a detective search for a lost pet. Use when the human says yes to looking for a specific pet, or names one from the CONTEXT block.
  walk — JSON: {"shape":"roundtrip"|"oneway","distance":"close"|"far"}    plot a real walking route from the human's current spot. Use when they ask for a walk, a stroll, somewhere to go, "let's walk", "куди підемо", "пройдемось", etc.
    · shape: "roundtrip" if they want to come back home (default for non-specific "let's walk"), "oneway" if they want to end somewhere specific (a café, a park).
    · distance: "close" ≈ 1km / 15min, "far" ≈ 3km / 35min. Pick "close" if unsure or if they sound short on time / it's late.

Rules:
- Never invent dogId values. Only use IDs that appear inline as [id:...] in the CONTEXT block above. If no real id matches what the human meant, OMIT the action entirely — natural chat is fine.
- For walk: don't pick a specific destination (the planner does that locally based on nearby parks + spots and what the human last walked to). Just emit the action so the route appears on the map; in the chat text, mention you're plotting it but don't promise a specific street or named spot.
- Never emit more than one action per reply.
- The action line is machine-parsed and stripped from what the human sees — keep the chat text natural and self-contained, not "as you can see in the action below".
- Most replies should have NO action. Emit one only when the human clearly committed to a next step ("yes let's find them", "ok i'll look for тімка", "let's walk", "пройдемось", etc).
`;
