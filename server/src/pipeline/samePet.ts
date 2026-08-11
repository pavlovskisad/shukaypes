// "Is this the same animal we already have?"
//
// Called by upsert to decide whether an incoming post is a repost of a
// pet already in the table, or a different pet that happens to look
// similar in the fields we store.
//
// THE ASYMMETRY THAT SHAPES ALL OF THIS. Getting it wrong in one
// direction leaves two pins for one dog: untidy, obvious, harmless, and
// fixable later by anyone who notices. Getting it wrong in the other
// direction overwrites one family's lost pet with another family's,
// and the losing record is gone — no second pin, no trace, nothing for
// the owner to find. So this predicate is built to refuse. Where the
// evidence is thin it returns false and accepts the duplicate.
//
// That is not a hypothetical preference. Measured on production, of the
// four active pairs that the old rule (same species, similar name,
// within 1500m, within 7 days) considered the same pet:
//
//   Лола / Лола          721m apart — a chihuahua and a dachshund
//   кіт / кіт хлопчик     one cat missing, one cat found seeking owner
//   котик / котик        one ill with a skin condition, one by a café
//   Тайсон / Тайсон      same street, same date, same dog  ← the only
//                        genuine duplicate of the four
//
// Three of four were different animals. A rule that merged all four
// would have destroyed three real reports to tidy up one duplicate.
//
// Two additions do the work, and each is needed for a different pair:
//
//   breed compatibility   separates the two Лолas, who share a name
//   descriptor rejection  separates the cats, who share nothing but a
//                         generic word — every one of them is stored
//                         with breed 'unknown' or 'mixed', so breed
//                         cannot help there
//
// The descriptor rule exists because `name` is often not a name. The
// parser is told to emit "a short descriptor if unnamed", so the table
// is full of "чорний кіт", "собака без імені", "сіро-білий котик".
// Those describe a category of animal, not an individual, and two cats
// being equally black is not evidence they are one cat.

import type { Species } from './types.js';

export const DEDUPE_RADIUS_M = 1500;
export const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PetIdentity {
  name: string;
  species: Species;
  breed: string;
  lastSeenAtMs: number;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`ʼ]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalise(s).split(/[\s-]+/).filter(Boolean);
}

// Words that make a "name" a description of an animal rather than the
// name of one. Species nouns, colours, sizes, sexes, and the phrasings
// the parser reaches for when a post never gave a name.
const DESCRIPTOR_WORDS = new Set([
  // species
  'кіт', 'кот', 'котик', 'кошка', 'кішка', 'киця', 'кицька', 'кошеня', 'котеня', 'котёнок',
  'пес', 'песик', 'собака', 'собачка', 'пёс', 'щеня', 'цуценя', 'щенок', 'собаку', 'собаки',
  'cat', 'kitten', 'dog', 'puppy', 'pet', 'dogs', 'cats',
  // breed-ish generics that behave like species nouns
  'дворняга', 'двортерєр', 'метис', 'mixed',
  // colours
  'чорний', 'чорна', 'чорно', 'білий', 'біла', 'біло', 'рудий', 'руда', 'рыжий', 'рыжая',
  'сірий', 'сіра', 'сіро', 'серый', 'коричневий', 'шоколадний', 'полосатий', 'смугастий',
  'полосатый', 'трьохкольоровий', 'black', 'white', 'grey', 'gray', 'ginger', 'tabby',
  // size / age / sex
  'дорослий', 'доросла', 'малий', 'мала', 'маленький', 'великий', 'старий', 'молодий',
  'хлопчик', 'дівчинка', 'мальчик', 'девочка', 'кабель', 'кобель', 'сука',
  // "no name" phrasings
  'безіменний', 'безіменна', 'без', 'імені', 'имени', 'name', 'unnamed', 'unknown', 'owner',
]);

// Breeds that carry no distinguishing information. If either side is
// one of these, breed simply cannot rule the pair out either way.
const UNSPECIFIC_BREEDS = new Set([
  '', 'unknown', 'mixed', 'метис', 'дворняга', 'двортерєр', 'невідомо', 'невідома', 'unclear',
]);

/**
 * True when `name` looks like an individual animal's name rather than a
 * description of one. A name made entirely of descriptor words, or too
 * short to carry information, is not usable evidence of identity.
 */
export function isUsableName(name: string): boolean {
  const t = tokens(name);
  if (t.length === 0) return false;
  // Any descriptor word anywhere disqualifies the whole string: "кіт
  // хлопчик" and "сіро-білий котик" are descriptions, and a real name
  // sitting beside a descriptor ("Мурзик чорний") still matches on the
  // name half through the containment rule below.
  if (t.some((w) => DESCRIPTOR_WORDS.has(w))) return false;
  // A one- or two-letter token is noise, not a name.
  return t.some((w) => w.length >= 3);
}

function namesMatch(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * True when breed cannot rule the pair out. Unknown/mixed on either
 * side is a wildcard; two stated breeds must agree.
 */
export function breedsCompatible(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  if (UNSPECIFIC_BREEDS.has(na) || UNSPECIFIC_BREEDS.has(nb)) return true;
  if (na === nb) return true;
  // "dachshund / такса" vs "такса" is one breed written two ways.
  return na.includes(nb) || nb.includes(na);
}

/**
 * The identity test. `distanceM` is the great-circle distance between
 * the two sightings. Every condition must hold; anything uncertain
 * resolves to false and leaves a duplicate rather than risking a merge.
 */
export function isSamePet(a: PetIdentity, b: PetIdentity, distanceM: number): boolean {
  // A dog named Murka and a cat named Murka on the same block are two
  // pets, not a dedupe.
  if (a.species !== b.species) return false;
  if (!(distanceM < DEDUPE_RADIUS_M)) return false;
  if (Math.abs(a.lastSeenAtMs - b.lastSeenAtMs) >= DEDUPE_WINDOW_MS) return false;
  // Both sides must offer a real name. One descriptor is enough to make
  // the comparison meaningless.
  if (!isUsableName(a.name) || !isUsableName(b.name)) return false;
  if (!namesMatch(a.name, b.name)) return false;
  return breedsCompatible(a.breed, b.breed);
}
