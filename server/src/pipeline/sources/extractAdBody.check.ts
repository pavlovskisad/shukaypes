// Fixture check for OLX ad-body extraction.
// Run with: pnpm --filter @shukajpes/server check:ad-extract
//
// THIS BUG REACHED A USER'S SCREEN, which is why it gets a check.
//
// cheerio's .text() concatenates every descendant text node, and the
// contents of a <style> tag ARE a text node. OLX renders with a CSS-in-JS
// library that injects <style> elements inside the description container,
// so the "ad text" we stored opened with several hundred characters of
// stylesheet:
//
//     Повідомлення .css-4upmi{text-transform:uppercase;font-size:var(
//     --fontSizeHeadlineLarge);line-height:var(--lineHeightHeadlineLarge…
//
// It was invisible for as long as the body was only ever WRITTEN. The
// first time anything read it back — PostModal, in front of somebody
// looking for their cat — it was most of the panel, with the real
// description a screen further down.
//
// Two things are asserted here, and the second matters as much as the
// first: no stylesheet survives, and the description does. A strip that
// took the description with it would pass a "no CSS" test perfectly.

import { extractAdBody } from './adHtml.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Shaped like the page that actually shipped the bug: style tags
// interleaved with the labels and the real description last.
const REAL_SHAPE = `<html><body>
<div data-cy="ad_title"><h4>кіт з блакитними очима</h4></div>
<div data-cy="ad_description">
  <style>.css-4upmi{text-transform:uppercase;font-size:var(--fontSizeHeadlineLarge);}</style>
  Повідомлення
  <style>.css-fl29zg{word-break:break-word;color:var(--primitivesColorsLightGray07Charcoal);}</style>
  Опис
  Кіт з'явився на вулиці в районі КПІ -Лук'янівка. Має блакитні очі.
  Можливо, хтось його шукає або зможе прихистити.
</div></body></html>`;

{
  const { text } = extractAdBody(REAL_SHAPE);
  check('no css rule survives', !/\.css-[a-z0-9]+\s*\{/i.test(text), text.slice(0, 80));
  check('no css property survives', !/font-size:var\(/.test(text));
  check('the description survives', text.includes('блакитні очі'));
  check('the whole description survives', text.includes('зможе прихистити'));
  check('the title survives', text.includes('кіт з блакитними очима'));
}

// A <script> in the container is the same failure with different noise.
{
  const { text } = extractAdBody(
    `<div data-cy="ad_description"><script>window.__x={a:1};</script>Загубився пес Мухтар на Оболоні</div>`,
  );
  check('no script survives', !text.includes('window.__x'));
  check('description survives a script', text.includes('Мухтар'));
}

// The fallback selectors have to be stripped too — they match a much
// bigger subtree, so they carry MORE stylesheet, not less.
{
  const { text } = extractAdBody(
    `<div data-testid="main"><style>.css-abc{color:red;}</style>Зник пес на Подолі</div>`,
  );
  check('fallback selector is stripped too', !/\.css-abc/.test(text));
  check('fallback description survives', text.includes('Подолі'));
}

// Photo extraction must not be collateral damage of removing nodes.
{
  const { photoUrl } = extractAdBody(
    `<html><head><meta property="og:image" content="https://example/p.jpg"></head>
     <body><style>.css-x{a:b;}</style><div data-cy="ad_description">Зник пес</div></body></html>`,
  );
  check('photo still found', photoUrl === 'https://example/p.jpg', String(photoUrl));
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ ad extraction: stylesheets go, the description stays');
