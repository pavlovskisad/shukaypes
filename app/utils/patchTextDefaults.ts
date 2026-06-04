// React Native Web's default <Text> applies `fontFamily: 'System'`,
// which on iOS resolves to SF Pro and overrides our body font-family
// inherit chain. Any Text component that doesn't pass an explicit
// fontFamily style (and there are many — pet names, spot names,
// quest labels, profile stats) ends up rendering in SF Pro instead
// of the brand font.
//
// Patching Text.render at app boot puts SYSTEM_FONT into every Text's
// style array as the FIRST entry, so component-level styles (later in
// the array) still win when they want a different family. Same patch
// for TextInput since it carries the same default.

import { Text, TextInput } from 'react-native';
import { SYSTEM_FONT } from '../constants/fonts';

const fontFallback = { fontFamily: SYSTEM_FONT };

type RenderFn = (props: { style?: unknown }, ref: unknown) => unknown;
interface Renderable {
  render?: RenderFn;
}

function patch(Comp: Renderable, label: string) {
  const original = Comp.render;
  if (!original) {
    // eslint-disable-next-line no-console
    console.warn(`[fonts] ${label}.render missing — patch skipped`);
    return;
  }
  const wrapped: RenderFn = function patchedRender(this: unknown, props, ref) {
    const mergedStyle = Array.isArray(props.style)
      ? [fontFallback, ...props.style]
      : [fontFallback, props.style];
    return original.call(this, { ...props, style: mergedStyle }, ref);
  };
  Comp.render = wrapped;
}

patch(Text as unknown as Renderable, 'Text');
patch(TextInput as unknown as Renderable, 'TextInput');
