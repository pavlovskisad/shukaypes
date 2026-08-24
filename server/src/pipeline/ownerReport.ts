// A first-party lost-pet report, composed from form fields.
//
// The scraper pipeline works backwards from prose it doesn't control;
// this is the opposite case: the owner filled in structured fields and
// dropped the pin themselves, so nothing here guesses. The job is only
// to compose the three texts the rest of the system expects:
//
//   postText — the full post, phone included. Becomes scrape_log.rawBody
//              (what «показати оголошення» shows a walker) and the body
//              of the channel/group crossposts. Contacts belong here ON
//              PURPOSE: the owner typed their number into a lost-pet
//              form so that people who see the pet can call them.
//   caption  — postText capped to Telegram's sendPhoto caption limit.
//   description — the short line on the pin. NEVER carries contacts,
//              same rule the scraper pipeline enforces on
//              lastSeenDescription; the walker taps through to the full
//              post for the phone number.
//
// PURE ON PURPOSE, like resolvePlace: fields in, strings out, no I/O —
// so a fixture check can hold the contact rule without a database.

import { redactContacts } from './redactContacts.js';
import type { Species } from './types.js';

// Telegram's sendPhoto caption hard limit.
export const TG_CAPTION_MAX = 1024;

export const OWNER_REPORT_LIMITS = {
  name: 60,
  description: 1500,
  phone: 30,
} as const;

export interface OwnerReportInput {
  species: Species;
  /** Pet's name; optional — a descriptor is used when absent. */
  name?: string;
  /** The owner's own words about the pet and where it was lost. */
  description: string;
  /** Optional contact phone, exactly as the owner typed it. */
  contactPhone?: string;
}

export interface OwnerReport {
  /** Display name for the row — the given name or a species descriptor. */
  name: string;
  emoji: string;
  /** Full post text, contacts included. */
  postText: string;
  /** postText within Telegram's caption limit. */
  caption: string;
  /** Contact-free short line for the pin. */
  description: string;
}

const SPECIES_WORD: Record<Species, string> = { dog: 'пес', cat: 'кіт' };
const SPECIES_EMOJI: Record<Species, string> = { dog: '🐕', cat: '🐈' };

function clean(s: string | undefined, max: number): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function composeOwnerReport(input: OwnerReportInput): OwnerReport {
  const species = input.species === 'cat' ? 'cat' : 'dog';
  const name = clean(input.name, OWNER_REPORT_LIMITS.name);
  const description = clean(input.description, OWNER_REPORT_LIMITS.description);
  const phone = clean(input.contactPhone, OWNER_REPORT_LIMITS.phone);
  const emoji = SPECIES_EMOJI[species];
  const word = SPECIES_WORD[species];

  const displayName = name || `безіменний ${word}`;

  const lines = [
    `${emoji} Загубився ${word}${name ? ` — ${name}` : ''}`,
    '',
    description,
  ];
  if (phone) {
    lines.push('', `📞 ${phone}`);
  }
  lines.push('', 'Опубліковано через шукайпес 🐾');
  const postText = lines.join('\n');

  // The pin line: the owner's words, contact-stripped and shortened.
  // redactContacts catches a phone the owner typed into the DESCRIPTION
  // field despite the dedicated phone field existing — people do.
  const pinLine = redactContacts(description).slice(0, 280);

  return {
    name: displayName,
    emoji,
    postText,
    caption: postText.length <= TG_CAPTION_MAX ? postText : `${postText.slice(0, TG_CAPTION_MAX - 1)}…`,
    description: pinLine,
  };
}
