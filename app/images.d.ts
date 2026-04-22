// Let tsc accept PNG imports as opaque module references. Metro + Expo
// resolve these to an image source object at bundle time; consumers pass
// them into <Image source={...} /> without caring about the exact shape.
declare module '*.png' {
  const content: number;
  export default content;
}

declare module '*.jpg' {
  const content: number;
  export default content;
}

declare module '*.jpeg' {
  const content: number;
  export default content;
}

declare module '*.svg' {
  const content: number;
  export default content;
}
