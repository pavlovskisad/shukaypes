// A SECOND READER FOR THE PLACEMENTS WE CANNOT DEFEND.
//
// resolvePlace is a string matcher over a gazetteer. It is deterministic
// and fixture-checked, and it is blind to meaning — which is exactly the
// failure the owner reported:
//
//   «Горобчик»  ad: «Жулянська-Ярошівська-Соборна (Соф. Боршагівка)»
//               → «Соборна площа», central Kyiv, 2.9km from the pin
//
// Софіївська Борщагівка is a village on Kyiv's western edge, and it has a
// вулиця Соборна of its own. The match is not a bug in the matcher; the
// matcher cannot know that a street inside a village shares a name with a
// square in the centre. That is world knowledge.
//
// So a model reads the ad afterwards and answers one question: does this
// ad support this pin? Measured over the 44 bare-placed pets on
// production it rejected 10, and every rejection held up on reading:
//
//   Борік   «Вул. Ракетна»          ← «ракетної атаки», a rocket attack
//   Джек    «Забір'я»               ← «забирав», a conjugated verb
//   Жужа    «Святошинський район»   ← «КИЄВО-Святошинський», an oblast raion
//   кішечка «Васильківська»         ← «вул. Василя Сергієнка», a stem collision
//   котик   «Васильківська»         ← «Васильків», a separate city
//
// Two of those are place names that are really a noun about war and a
// verb. No amount of geometry finds them.
//
// IT MAY ONLY REJECT.
//
// This is the whole safety argument, and it is not a style preference.
// Asking a model WHERE a pet is produced «Таруша», whose ad names a
// Kharkiv metro station and which the model placed at Олімпійська in
// central Kyiv — a walker sent across the city for an animal in another
// oblast. Asking whether an ad supports a pin somebody else chose is a
// different task with a different worst case: a wrong rejection hides a
// pet, which is a real loss but a quiet one, and a reversible one.
//
// It never returns a coordinate, never names a place, and never promotes
// anything the resolver did not already find.
//
// WHEN IT CANNOT RUN, NOTHING CHANGES. No key, no budget, an API error,
// an answer in an unexpected shape: all return null, and the caller keeps
// the unjudged label — which the placement bar already hides. The
// fallback is today's behaviour, so an outage costs nothing that works.
import { anthropic } from '../services/anthropic.js';

// Opus rather than the parser's Haiku, deliberately. The distinctions
// that matter here are the hard half of the task — a district of Kyiv
// against an oblast raion of nearly the same name, a street name against
// a conjugated verb — and the whole point of the layer is to be right
// where the cheap deterministic pass was wrong. At 44 pets for $0.19 and
// roughly one new pet every other day, the model choice is not the cost.
export const JUDGE_MODEL = 'claude-opus-5';

// Enough for a one-line answer with adaptive thinking in front of it.
//
// The first prototype used 300 and six of forty-four answers came back
// EMPTY: on this model thinking is on by default, it spent the budget
// reasoning, and no text block was left. Empty then read as "no REJECT
// prefix", which silently scored those six as keeps. A cap that turns
// into a wrong verdict is worse than one that errors.
const MAX_TOKENS = 2000;

// How much of the ad the judge sees. Ads run long and the location is
// almost always early; this keeps a runaway post from becoming a
// runaway bill.
const MAX_AD_CHARS = 2500;

export interface PlacementVerdict {
  keep: boolean;
  /** The model's own one-line justification, for the ledger and the CLI. */
  reason: string;
}

const SYSTEM = `You verify pet-location pins for a Kyiv lost-pet map.

You are given a lost-pet ad (Ukrainian or Russian) and the place our string
matcher chose for it. Answer one question: does the ad support putting the
animal at that place, in Kyiv?

Reject when:
- the ad points at a different settlement or city, even if it never names it
  (a district, road, tram stop or market that belongs to another place)
- the matched name appears in the ad in a different sense (a street inside a
  village vs a square of the same name in central Kyiv; a colour, a date, a
  breed, a person's name, an ordinary word)
- the ad names a place, but not this one

Keep when the ad names this place or the area around it. A district or metro
station named without «вул.» is a normal, complete address in Ukrainian —
that alone is not a reason to reject.

You are a safety net after a string matcher, and you may only reject. When
genuinely unsure, KEEP: a hidden pet is one nobody searches for.

Reply with exactly one line:
KEEP <short reason>
or
REJECT <short reason>`;

/**
 * Read one verdict line. Exported for the fixtures: the parsing is where
 * an ambiguous answer becomes a decision about somebody's pet, so it is
 * tested without a network.
 *
 * ANYTHING THAT IS NOT A CLEAR REJECT IS A KEEP. An empty answer, a
 * refusal, a sentence that starts with an apology — none of those are the
 * model saying the pin is wrong, and only the model saying so should
 * hide a pet.
 */
export function parseVerdict(text: string): PlacementVerdict | null {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  if (!line) return null;
  const reject = /^REJECT\b/i.test(line);
  const keep = /^KEEP\b/i.test(line);
  if (!reject && !keep) return null;
  return {
    keep: !reject,
    reason: line.replace(/^(KEEP|REJECT)\b[\s:—-]*/i, '').trim().slice(0, 200),
  };
}

export interface JudgeInput {
  /** The ad as the poster wrote it — title and body, plus our description. */
  adText: string;
  /** The gazetteer name the resolver chose. */
  placeName: string;
  lat: number;
  lng: number;
}

/**
 * Ask whether the ad supports the pin. Returns null when the question
 * could not be put — no key, an API error, an answer in a shape we do not
 * recognise — and the caller must then leave the placement alone.
 */
export async function judgePlacement(input: JudgeInput): Promise<PlacementVerdict | null> {
  const ad = input.adText.trim().slice(0, MAX_AD_CHARS);
  if (!ad) return null;

  try {
    const res = await anthropic().messages.create({
      model: JUDGE_MODEL,
      max_tokens: MAX_TOKENS,
      // Low effort on purpose: this is a one-line judgement over a short
      // ad, and the measured run at low effort matched the higher-effort
      // one on every pet it judged.
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `AD:\n${ad}\n\nWE PLACED IT AT: «${input.placeName}» (${input.lat.toFixed(4)}, ${input.lng.toFixed(4)})\n\nDoes the ad support this pin?`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    return parseVerdict(text);
  } catch {
    // Deliberately swallowed. A judge that throws would fail an ingest
    // that was working before it existed.
    return null;
  }
}

// THE LABELS THIS LAYER WRITES.
//
// Kept and rejected placements both keep the coordinate the resolver
// chose — the judge never moves anything — so the label is the only
// thing that changes, and it has to say which of the three states a row
// is in: never judged, judged and kept, judged and rejected.
export const JUDGED_PREFIX = 'gazetteer-judged:';
export const REJECTED_PREFIX = 'gazetteer-rejected:';

/** The place name inside any `gazetteer-<tier>:<name>` label. */
export function placeNameOf(placementSource: string): string {
  return placementSource.replace(/^gazetteer-[a-z]+:/, '');
}

/** Which placements this layer is allowed to look at. */
export function isJudgeable(placementSource: string | null): boolean {
  if (!placementSource) return false;
  return (
    placementSource.startsWith('gazetteer-bare:') ||
    placementSource.startsWith('gazetteer-fuzzy:')
  );
}
