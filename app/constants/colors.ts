export const colors = {
  black: '#1a1a1a',
  grey: '#777',
  greyLight: '#aaa',
  greyPale: '#ddd',
  greyBg: '#f0f0f0',
  white: '#ffffff',
  accent: '#c8ff00',
  red: '#e84040',
  redBg: '#fde8e8',
  amber: '#d9a030',
  amberBg: '#fdf3e0',
} as const;

export type ColorKey = keyof typeof colors;
