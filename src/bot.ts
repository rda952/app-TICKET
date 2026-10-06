import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type Interaction,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { dailyDigest } from "./ai.js";
import { config } from "./config.js";
import { Store } from "./db.js";
import { FIELD_KEYS, FIELDS, type SubjectKind } from "./fields.js";
import { findAnswer, formatAnswer, formatFiche, runExtraction } from "./knowledge.js";
import { isLikelyQuestion } from "./text.js";

if (!config.discordToken) {
  console.error("DISCORD_TOKEN manquant : copie .env.example en .env et remplis-le.");
  process.exit(1);
}

const store = new Store();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const commands = [
  new SlashCommandBuilder()
    .setName("fiche")
    .setDescription("Affiche la fiche d'un événement ou d'une plateforme")
    .addStringOption((o) => o.setName("nom").setDescription("Ex. : SDM, Céline, Viagogo").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName("ajouter")
    .setDescription("(Staff) Ajoute une info validée à une fiche")
    .addStringOption((o) => o.setName("sujet").setDescription("Nom de l'événement ou de la plateforme").setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o.setName("champ").setDescription("Type d'info").setRequired(true)
        .addChoices(...FIELD_KEYS.map((k) => ({ name: FIELDS[k], value: k }))),
    )
    .addStringOption((o) => o.setName("valeur").setDescription("L'info, en une phrase").setRequired(true))
    .addStringOption((o) =>
      o.setName("type").setDescription("Événement (par défaut) ou plateforme")
        .addChoices({ name: "Événement", value: "event" }, { name: "Plateforme", value: "platform" }),
    ),
  new SlashCommandBuilder().setName("a-valider").setDescription("(Staff) Infos trouvées par l'IA en attente de validation"),
  new SlashCommandBuilder().setName("analyser").setDescription("(Staff) Analyse maintenant les nouveaux messages"),
  new SlashCommandBuilder().setName("resume").setDescription("(Staff) Résumé des dernières 24 h"),
].map((c) => c.toJSON());

async function registerCommands(guild: Guild): Promise<void> {
  await guild.commands.set(commands);
  console.log(`Commandes enregistrées sur ${guild.name}`);
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`Connecté en tant que ${ready.user.tag}`);
  for (const guild of ready.guilds.cache.values()) await registerCommands(guild);
  setInterval(() => void extractionTick(), config.extractEveryMinutes * 60_000);
  setInterval(() => void digestTick(), 5 * 60_000);
});

client.on(Events.GuildCreate, (guild) => void registerCommands(guild));

// --- Messages : on enregistre, et on répond aux questions si on sait ---

function baseChannelId(message: Message): string {
  return message.channel.isThread() ? (message.channel.parentId ?? message.channelId) : message.channelId;
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild() || !message.content.trim()) return;
  const channelId = baseChannelId(message);
  const watched = config.watchedChannelIds.includes(channelId);
  const questions = config.questionChannelIds.includes(channelId);
  if (!watched && !questions) return;

  store.saveMessage({
    id: message.id,
    channelId,
    author: message.member?.displayName ?? message.author.username,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    url: message.url,
  });

  if (!questions || !isLikelyQuestion(message.content)) return;
  try {
    const answer = await findAnswer(store, message.content);
    if (answer) await message.reply({ content: formatAnswer(answer), allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error("Erreur en répondant à une question :", err);
  }
});

// --- Commandes et boutons ---

function isStaff(interaction: Interaction): boolean {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member;
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    config.staffRoleIds.some((id) => member.roles.cache.has(id))
  );
}

function splitForDiscord(text: string, max = 1900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > max && current) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function replyLong(interaction: ChatInputCommandInteraction, text: string, ephemeral = false): Promise<void> {
  const [first, ...rest] = splitForDiscord(text);
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  if (interaction.deferred) await interaction.editReply(first);
  else await interaction.reply({ content: first, flags });
  for (const chunk of rest) await interaction.followUp({ content: chunk, flags });
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const typed = interaction.options.getFocused().toLowerCase();
      const choices = store
        .subjects()
        .filter((s) => [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(typed)))
        .slice(0, 25)
        .map((s) => ({ name: s.name.slice(0, 100), value: s.name.slice(0, 100) }));
      await interaction.respond(choices);
      return;
    }

    if (interaction.isButton()) {
      const [kind, action, rawId] = interaction.customId.split(":");
      if (kind !== "fact") return;
      if (!isStaff(interaction)) {
        await interaction.reply({ content: "Réservé au staff.", flags: MessageFlags.Ephemeral });
        return;
      }
      const fact = store.setFactStatus(Number(rawId), action === "ok" ? "validated" : "rejected", interaction.user.username);
      await interaction.update({
        content: `${action === "ok" ? "✅ Validé" : "🗑️ Rejeté"} par ${interaction.user.username} : **${fact?.subjectName}** › ${fact?.value}`,
        components: [],
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "fiche") {
      const name = interaction.options.getString("nom", true);
      const subject = store.findSubject(name) ?? store.subjectsMentionedIn(name)[0];
      if (!subject) {
        await interaction.reply({ content: `Pas encore de fiche pour « ${name} ».`, flags: MessageFlags.Ephemeral });
        return;
      }
      await replyLong(interaction, formatFiche(store, subject));
      return;
    }

    if (!isStaff(interaction)) {
      await interaction.reply({ content: "Commande réservée au staff.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "ajouter") {
      const kind = (interaction.options.getString("type") ?? "event") as SubjectKind;
      const subject = store.upsertSubject(kind, interaction.options.getString("sujet", true));
      const field = interaction.options.getString("champ", true) as (typeof FIELD_KEYS)[number];
      const id = store.addFact({
        subjectId: subject.id,
        field,
        value: interaction.options.getString("valeur", true),
        status: "validated",
        createdBy: interaction.user.username,
        validatedBy: interaction.user.username,
      });
      await interaction.reply({
        content: id === null ? "Cette info existe déjà." : `✅ Ajouté à **${subject.name}** › ${FIELDS[field]}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "a-valider") {
      const pending = store.pendingFacts(5);
      if (pending.length === 0) {
        await interaction.reply({ content: "Rien à valider 👌", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: `${pending.length} info(s) à vérifier :`, flags: MessageFlags.Ephemeral });
      for (const f of pending) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`fact:ok:${f.id}`).setLabel("Valider").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`fact:no:${f.id}`).setLabel("Rejeter").setStyle(ButtonStyle.Danger),
        );
        const source = f.sourceUrl ? `\n-# source : ${f.sourceUrl}` : f.sourceExcerpt ? `\n-# « ${f.sourceExcerpt} »` : "";
        await interaction.followUp({
          content: `**${f.subjectName}** › ${FIELDS[f.field]}\n${f.value}${source}`,
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.commandName === "analyser") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const added = await runExtraction(store);
      await interaction.editReply(`${added.length} nouvelle(s) info(s) trouvée(s). Utilise /a-valider pour les vérifier.`);
      return;
    }

    if (interaction.commandName === "resume") {
      await interaction.deferReply();
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const digest = await dailyDigest(store.messagesSince(since));
      await replyLong(interaction, digest ?? "Rien de notable sur les dernières 24 h.");
    }
  } catch (err) {
    console.error("Erreur d'interaction :", err);
    if (interaction.isRepliable() && !interaction.replied) {
      const content = "Oups, une erreur est survenue.";
      if (interaction.deferred) await interaction.editReply(content).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// --- Tâches de fond ---

let extracting = false;
async function extractionTick(): Promise<void> {
  if (extracting) return;
  extracting = true;
  try {
    const added = await runExtraction(store);
    if (added.length) console.log(`${added.length} info(s) ajoutée(s) en attente de validation`);
  } catch (err) {
    console.error("Erreur d'extraction :", err);
  } finally {
    extracting = false;
  }
}

async function digestTick(): Promise<void> {
  if (!config.digestChannelId) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() < config.digestHour || store.getMeta("last_digest") === today) return;
  store.setMeta("last_digest", today);
  try {
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const digest = await dailyDigest(store.messagesSince(since));
    if (!digest) return;
    const channel = await client.channels.fetch(config.digestChannelId);
    if (channel?.isSendable()) {
      for (const chunk of splitForDiscord(`📰 **Résumé des dernières 24 h**\n${digest}`)) await channel.send(chunk);
    }
  } catch (err) {
    console.error("Erreur du résumé quotidien :", err);
  }
}

await client.login(config.discordToken);
