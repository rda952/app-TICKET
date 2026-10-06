function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  // Salons dont le bot lit les messages pour alimenter la base (questions, infos, talk…)
  watchedChannelIds: list(process.env.WATCHED_CHANNEL_IDS),
  // Salons où le bot répond automatiquement aux questions
  questionChannelIds: list(process.env.QUESTION_CHANNEL_IDS),
  // Salon où le résumé quotidien est posté (vide = pas de résumé auto)
  digestChannelId: process.env.DIGEST_CHANNEL_ID ?? "",
  digestHour: Number(process.env.DIGEST_HOUR ?? "9"),
  // Rôles autorisés à valider / ajouter des infos (staff, helpers)
  staffRoleIds: list(process.env.STAFF_ROLE_IDS),
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  dbPath: process.env.DB_PATH ?? "data/copilot.db",
  extractEveryMinutes: Number(process.env.EXTRACT_EVERY_MINUTES ?? "10"),
};
