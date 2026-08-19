export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  // Public invite link to the Telegram group the ingest bot watches. A
  // lost-pet post there is parsed and lands on the map immediately
  // (server/src/services/telegramIngest.ts), which is why the "I lost a
  // pet" sheet sends people to it rather than to a form we do not have.
  //
  // Empty is a supported state, not a bug: the sheet then explains the
  // route without offering a button that goes nowhere. Set
  // EXPO_PUBLIC_TELEGRAM_GROUP_URL in Vercel to switch it on.
  telegramGroupUrl: process.env.EXPO_PUBLIC_TELEGRAM_GROUP_URL ?? '',
};
