// Expo's default babel setup (babel-preset-expo — which also auto-wires
// expo-router and the react-native-reanimated worklets plugin) plus one
// addition: `three`'s prebuilt bundle ships ES2022 static class blocks, and
// Metro runs babel over node_modules, so we enable that transform here.
// Without it the web build fails on three.core.js ("Static class blocks are
// not enabled"). See constants/experiments.ts (GAME_RENDER) for why three
// is in the tree.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-class-static-block'],
  };
};
