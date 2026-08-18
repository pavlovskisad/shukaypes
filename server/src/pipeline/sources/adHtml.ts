// Reading an OLX ad page into text. Pure HTML in, text out — no database,
// no network, so it can be exercised by a fixture check.
//
// It lives apart from olx.ts for exactly that reason: the extraction bug
// below was invisible for as long as nobody could cheaply test it, and
// olx.ts drags in the db module the moment you import it.

import { load as loadHtml } from 'cheerio';

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
  const body =
    $('[data-cy="ad_description"]').text() ||
    $('[data-testid="ad-description"]').text() ||
    $('div[data-testid="main"]').text() ||
    '';
  const title = $('[data-cy="ad_title"] h4').first().text() || $('h4').first().text();
  const combined = `${title}\n\n${body}`.replace(/\s+\n/g, '\n').trim();

  const photo =
    $('[data-cy="ad-photo"] img').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  return { text: combined, photoUrl: photo };
}
