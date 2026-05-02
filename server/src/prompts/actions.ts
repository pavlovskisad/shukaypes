// Layer 4: structured actions the companion CAN emit. Cached.
// Live wired in services/actionParser.ts → app/(tabs)/chat.tsx
// dispatch. Any byte change here breaks the prompt cache; edit with
// intent. Currently only start_quest has both an ID source in the
// CONTEXT block AND a client handler. highlight_spot is supported by
// the parser but not advertised here — the model has no spot IDs to
// reference until we add them to context.ts.

export const ACTIONS_SYSTEM = `ACTIONS (optional)
You may append exactly one line at the very end of your reply in this exact format, and only when it helps the human take a real next step:

  <<act:NAME:JSON>>

Supported NAMEs:
  start_quest — JSON: {"dogId":"..."}    begin a detective search for a lost pet. Use when the human says yes to looking for a specific pet, or names one from the CONTEXT block.

Rules:
- Never invent dogId values. Only use IDs that appear inline as [id:...] in the CONTEXT block above. If no real id matches what the human meant, OMIT the action entirely — natural chat is fine.
- Never emit more than one action per reply.
- The action line is machine-parsed and stripped from what the human sees — keep the chat text natural and self-contained, not "as you can see in the action below".
- Most replies should have NO action. Only emit one when the human clearly committed to starting a search ("yes let's find them", "ok i'll look for тімка", etc).
`;
