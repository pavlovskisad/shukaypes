// Reading an OLX ad page into text. Pure HTML in, text out — no database,
// no network, so it can be exercised by a fixture check.
//
// It lives apart from olx.ts for exactly that reason: the extraction bug
// below was invisible for as long as nobody could cheaply test it, and
// olx.ts drags in the db module the moment you import it.

import { load as loadHtml } from 'cheerio';

// OLX'S OWN FURNITURE, WHICH IS NOT THE OWNER'S TEXT.
//
// The description container carries the page's section labels before it
// carries the post: «Повідомлення», then «Опис», then what the owner
// actually wrote. Stored verbatim, every single body opens with two
// words of OLX chrome, and the walker reads them before reading about
// the animal.
//
// Both language variants, because ads are posted in either and the page
// is served in whichever the reader picked.
const SECTION_LABELS = ['Повідомлення', 'Опис', 'Сообщение', 'Описание'];

// Anchored at the START and nowhere else, which is the whole safety
// property. A post that says «опис зовнішності: рудий, білі лапки» in
// the middle of a sentence keeps every word — we only ever remove a
// label that the body BEGINS with, and only when a word boundary
// follows it, so «Описание» never eats the front of «Описания немає».
//
// Repeated because the two labels arrive together, and either can be
// absent on a given layout.
export function stripSectionLabels(body: string): string {
  let out = body.trimStart();
  for (let pass = 0; pass < SECTION_LABELS.length; pass++) {
    const before = out;
    for (const label of SECTION_LABELS) {
      const re = new RegExp(`^${label}(?=[\\s:]|$)[\\s:]*`, 'iu');
      out = out.replace(re, '');
    }
    if (out === before) break;
  }
  return out;
}

// THE SAME RULE, FOR TEXT WE ALREADY STORED.
//
// A stored body is `title` + the description, so its labels are not at
// character zero — they sit on their own lines a little way in, and the
// anchored strip above cannot reach them. This walks the lines and
// applies that strip to each, dropping a line only when it was NOTHING
// BUT a label. A line that merely begins with one keeps its remainder;
// a line with no label is returned byte-for-byte, indentation included,
// so this can be run over the corpus without quietly reformatting
// anybody's post.
export function stripSectionLabelLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const stripped = stripSectionLabels(line);
    if (stripped === line.trimStart()) {
      out.push(line); // no label here — leave it exactly as it was
      continue;
    }
    if (stripped.trim() === '') continue; // the line was only furniture
    out.push(stripped);
  }
  return out.join('\n').trim();
}

export function extractAdBody(html: string): { text: string; photoUrl: string | null } {
  const $ = loadHtml(html);

  // STRIP <style> AND <script> FIRST, or the ad "text" is mostly CSS.
  //
  // cheerio's .text() concatenates every descendant text node, and a
  // <style> tag's contents ARE a text node. OLX renders with a CSS-in-JS
  // library that injects <style> elements inside the markup, so the
  // description container carries several rules' worth of them. Nobody
  // noticed at ingest — the body was only ever stored, never read — but
  // the moment PostModal put it on screen the walker got
  //
  //     Повідомлення .css-4upmi{text-transform:uppercase;font-size:var(
  //     --fontSizeHeadlineLarge);line-height:var(--lineHeightHeadline…
  //
  // before reaching "Кіт з'явився на вулиці в районі КПІ". The real
  // description was there all along, buried a screen down.
  //
  // Removing them from the parsed tree before reading text fixes the
  // stored corpus and the display in one place. It also matters for the
  // PARSER, which has been reading this same polluted text: every
  // classification so far spent part of its input on stylesheets.
  $('style, script, noscript').remove();

  // OLX ad body is the only multi-line description on the page. data-cy
  // markers here have been stable too, with a couple of fallbacks for
  // layout experiments.
  // Labels that live in an element of their own come out here, where we
  // can still see the tree. Matching on the element's ENTIRE text means a
  // heading is removed and a paragraph that merely opens with the same
  // word is not.
  $('h1, h2, h3, h4, h5, h6, span, div, p').each((_, el) => {
    const node = $(el);
    if (SECTION_LABELS.includes(node.text().trim())) node.remove();
  });

  const body =
    $('[data-cy="ad_description"]').text() ||
    $('[data-testid="ad-description"]').text() ||
    $('div[data-testid="main"]').text() ||
    '';
  const title = $('[data-cy="ad_title"] h4').first().text() || $('h4').first().text();
  // …and labels that are bare text nodes come out here. OLX has shipped
  // both shapes; the fixture check pins both.
  const combined = `${title}\n\n${stripSectionLabels(body.trim())}`
    .replace(/\s+\n/g, '\n')
    .trim();

  const photo =
    $('[data-cy="ad-photo"] img').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  return { text: combined, photoUrl: photo };
}
