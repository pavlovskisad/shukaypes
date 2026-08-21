export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  // Where the "I lost a pet" sheet sends people: a DM to our own bot.
  //
  // This used to point at the Telegram group the ingest watches, and
  // stayed empty because there wasn't a public group link to give.
  // The bot is the better destination anyway — it takes the report in
  // a private chat (routes/telegram.ts handles a lost-looking DM
  // through the same Haiku parse + upsert the group listener uses), so
  // a person in distress isn't asked to post their phone number and
  // their pet's photo into a room full of strangers to get on the map.
  //
  // ?start=lost makes Telegram send `/start lost` on open, which the
  // bot answers with the "tell me about your missing pet" prompt
  // instead of the generic welcome — the button lands ON the flow, not
  // next to it.
  //
  // Empty is still a supported state, not a bug: the sheet then
  // explains the route without offering a button that goes nowhere.
  telegramBotUrl:
    process.env.EXPO_PUBLIC_TELEGRAM_BOT_URL ?? 'https://t.me/shukaypes_bot?start=lost',
};
