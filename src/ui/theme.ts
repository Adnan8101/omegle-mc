/**
 * Central design tokens for every message the bot renders.
 * Keep colours and glyphs here so the whole bot stays visually consistent.
 */
export const Colors = {
  brand: 0x5865f2,
  success: 0x23a55a,
  danger: 0xf23f43,
  warning: 0xf0b232,
  info: 0x5865f2,
  neutral: 0x80848e,
  minecraft: 0x5b8731
} as const;

/**
 * Custom Discord emojis. The bot must be in the server that owns them
 * (or they must be uploaded as application emojis), otherwise Discord
 * shows the plain :name: text instead.
 */
export const Emojis = {
  minecraft: "<a:Minecraft:1572976101419126784>",
  dot: "<:Ozy_pink_dot:1507650437610737795>"
} as const;

export const Icons = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  online: "🟢",
  offline: "🔴",
  pending: "🟡",
  disabled: "⚪",
  server: "🖥️",
  status: "📡",
  bridge: "💬",
  whitelist: "📋",
  utility: "🛠️",
  java: "☕",
  bedrock: "📱"
} as const;
