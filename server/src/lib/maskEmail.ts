// Show enough of an address to tell two people apart, and no more.
//
// The console's key (DASHBOARD_TOKEN) is a shared secret kept in a phone
// browser and passable in a link. Until the accounts panel it opened
// nothing but aggregates; now it opens a list of the people using the
// app, and the realistic way that list escapes is a screenshot, not a
// breach. So the address is masked on the SERVER — the full string never
// reaches the page, and no toggle in the markup can reveal what was
// never sent.
//
// TWO CHARACTERS, THEN EXACTLY THREE BULLETS, THEN THE DOMAIN.
//
//   sashko@gmail.com  →  sa•••@gmail.com
//   ab@example.com    →  a•••@example.com
//   a@example.com     →  •••@example.com
//
// Three bullets always, whatever the length: a mask that grows with the
// local part tells you how long the address is, which is a free guess
// nobody needs to be given.
//
// The domain stays whole. It is the half that disambiguates least (most
// of these are gmail) and the half most useful for spotting something
// odd — a run of sign-ups from one company, say.
//
// The full address is one query away in the database, which is the only
// place it should be when somebody actually needs to write to a person.
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  // No @ at all: not an address we can reason about, so reveal nothing
  // rather than guessing where the safe part ends.
  if (at < 1) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the @
  const keep = local.length >= 3 ? 2 : local.length >= 2 ? 1 : 0;
  return local.slice(0, keep) + '•••' + domain;
}
