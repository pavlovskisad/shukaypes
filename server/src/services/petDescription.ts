// THE PET IN WORDS, so the drawing step never sees the photo. D-72.
//
// Every drawing made FROM the photo came back a sketch of the photo:
// fur, highlights, a nose with nostrils. The photo is the anchor to
// realism, and no prompt outweighed it. The posters the app wants are
// breed-level caricatures — floppy ears, a big smile, a patch over one
// eye — and a caricaturist works from a description, not a reference
// photo. So: a vision model looks at the photo once and says, in one
// sentence, what a caricaturist would need; the image model then draws
// from those words and the illustrator's samples, with no photo in the
// request at all.
//
// The photo goes to Claude for that one look and is not kept there
// either (the API does not retain inputs); the promise in the sheet —
// nothing stores the photo — still holds. Nothing here logs the photo
// or the photo's subject beyond the description itself, which is a
// line about an animal's coat and ears and nothing else.

import { AMBIENT_MODEL, anthropic } from './anthropic.js';

// What a caricaturist needs and nothing a person would mind being
// said: the animal, not the room, the sofa or the child holding it.
// The first round of sentences read fine and drew the wrong dog: the
// samples the image model sees are mostly shaggy, and a sentence that
// did not SAY "smooth" lost to them. So the sentence is now five
// labelled parts, and the coat's texture is one word from a fixed list
// the drawing prompt can lean on.
const SYSTEM =
  'You describe a pet for a caricaturist who will draw it in a crude, funny, childlike marker doodle, ' +
  'black line on white, from your words. Answer in ONE line of at most 40 words with exactly these five ' +
  'labelled parts, in this order, separated by semicolons: ' +
  'coat: <light|dark|mixed> and <smooth|short|long|shaggy|curly|wiry>, plus one or two words on how it hangs; ' +
  'ears: shape and how they sit; muzzle: length and shape, nose; markings: patches, mask, blaze, or none; ' +
  'look: expression or pose (grin, tongue out, head tilt). ' +
  'Say only what makes THIS animal recognisable at a glance. No name, no breed guess, nothing about the ' +
  'background, people, objects or setting. Respond with the line only.';

export async function describePet(
  photo: { bytes: Buffer; mime: string },
  pet: { species: string | null; breed: string | null },
): Promise<string | null> {
  const mediaType = photo.mime as 'image/jpeg' | 'image/png' | 'image/webp';
  const what = pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : 'pet';
  const breed = pet.breed ? ` The owner says the breed is "${pet.breed}".` : '';
  const resp = await anthropic().messages.create({
    model: AMBIENT_MODEL,
    max_tokens: 120,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: photo.bytes.toString('base64') } },
          { type: 'text', text: `This is a ${what}.${breed} Describe it for the caricaturist.` },
        ],
      },
    ],
  });
  const block = resp.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') return null;
  const text = block.text.trim().replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '');
  return text.length >= 10 ? text : null;
}
