import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  type Message,
} from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PASTEFY_API_KEY = process.env.PASTEFY_API_KEY;
const PASTE_ID = process.env.PASTE_ID;

if (!DISCORD_TOKEN || !PASTEFY_API_KEY || !PASTE_ID) {
  console.error(
    "Missing required environment variables: DISCORD_TOKEN, PASTEFY_API_KEY, PASTE_ID"
  );
  process.exit(1);
}

const PASTEFY_RAW_URL = `https://pastefy.app/${PASTE_ID}/raw`;
const PASTEFY_API_URL = `https://pastefy.app/api/v2/paste/${PASTE_ID}`;

interface KeyEntry {
  key: string;
  used: boolean;
  expires: number;
  generatedBy?: string;
  generatedAt?: number;
}

interface KeyStore {
  keys: KeyEntry[];
}

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5000;

function generateKeyString(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "KEY-";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function fetchKeys(): Promise<KeyStore> {
  const res = await fetch(PASTEFY_RAW_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch paste: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.keys)) {
      return { keys: [] };
    }
    return parsed as KeyStore;
  } catch {
    return { keys: [] };
  }
}

async function saveKeys(store: KeyStore): Promise<void> {
  const res = await fetch(PASTEFY_API_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${PASTEFY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: JSON.stringify(store, null, 2),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to save paste: ${res.status} ${res.statusText} — ${body}`
    );
  }
}

function checkCooldown(userId: string): number {
  const last = cooldowns.get(userId);
  if (!last) return 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

function setCooldown(userId: string): void {
  cooldowns.set(userId, Date.now());
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Bot online: ${client.user?.tag}`);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  if (content.startsWith("!gerar")) {
    const remaining = checkCooldown(message.author.id);
    if (remaining > 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("⏳ Aguarde")
            .setDescription(
              `Você precisa esperar **${Math.ceil(remaining / 1000)}s** antes de usar este comando novamente.`
            ),
        ],
      });
      return;
    }

    const parts = content.split(/\s+/);
    const days = parseInt(parts[1] ?? "", 10);

    if (isNaN(days) || days <= 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Uso incorreto")
            .setDescription("Use: `!gerar <dias>`\nExemplo: `!gerar 7`"),
        ],
      });
      return;
    }

    try {
      setCooldown(message.author.id);
      const store = await fetchKeys();
      const newKey: KeyEntry = {
        key: generateKeyString(),
        used: false,
        expires: Math.floor(Date.now() / 1000) + days * 86400,
        generatedBy: message.author.id,
        generatedAt: Math.floor(Date.now() / 1000),
      };

      store.keys.push(newKey);
      await saveKeys(store);

      const expiresDate = new Date(newKey.expires * 1000).toLocaleDateString(
        "pt-BR"
      );

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle("🔑 Key Gerada")
            .addFields(
              { name: "Key", value: `\`${newKey.key}\``, inline: true },
              {
                name: "Expira em",
                value: `**${days} dia(s)** (${expiresDate})`,
                inline: true,
              },
              { name: "Gerada por", value: `<@${message.author.id}>` }
            )
            .setTimestamp(),
        ],
      });
    } catch (err) {
      console.error("Erro ao gerar key:", err);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Erro")
            .setDescription(
              "Não foi possível gerar a key. Tente novamente mais tarde."
            ),
        ],
      });
    }
    return;
  }

  if (content.startsWith("!remover")) {
    const remaining = checkCooldown(message.author.id);
    if (remaining > 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("⏳ Aguarde")
            .setDescription(
              `Você precisa esperar **${Math.ceil(remaining / 1000)}s** antes de usar este comando novamente.`
            ),
        ],
      });
      return;
    }

    const parts = content.split(/\s+/);
    const keyToRemove = parts[1]?.toUpperCase();

    if (!keyToRemove) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Uso incorreto")
            .setDescription(
              "Use: `!remover <KEY>`\nExemplo: `!remover KEY-AB12CD34`"
            ),
        ],
      });
      return;
    }

    try {
      setCooldown(message.author.id);
      const store = await fetchKeys();
      const index = store.keys.findIndex((k) => k.key === keyToRemove);

      if (index === -1) {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff9900)
              .setTitle("⚠️ Key não encontrada")
              .setDescription(`Não existe nenhuma key \`${keyToRemove}\`.`),
          ],
        });
        return;
      }

      store.keys.splice(index, 1);
      await saveKeys(store);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle("✅ Key Removida")
            .setDescription(`A key \`${keyToRemove}\` foi removida com sucesso.`)
            .setTimestamp(),
        ],
      });
    } catch (err) {
      console.error("Erro ao remover key:", err);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Erro")
            .setDescription(
              "Não foi possível remover a key. Tente novamente mais tarde."
            ),
        ],
      });
    }
    return;
  }

  if (content === "!listar") {
    try {
      const store = await fetchKeys();
      const now = Math.floor(Date.now() / 1000);
      const active = store.keys.filter((k) => k.expires > now);
      const expired = store.keys.filter((k) => k.expires <= now);

      if (store.keys.length === 0) {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x888888)
              .setTitle("📋 Keys")
              .setDescription("Nenhuma key cadastrada."),
          ],
        });
        return;
      }

      const activeLines = active
        .slice(0, 15)
        .map((k) => {
          const date = new Date(k.expires * 1000).toLocaleDateString("pt-BR");
          return `\`${k.key}\` — expira ${date}`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 Lista de Keys")
        .addFields({
          name: `✅ Ativas (${active.length})`,
          value: activeLines || "Nenhuma",
        });

      if (expired.length > 0) {
        embed.addFields({
          name: `❌ Expiradas (${expired.length})`,
          value: expired
            .slice(0, 5)
            .map((k) => `\`${k.key}\``)
            .join("\n"),
        });
      }

      embed.setFooter({ text: `Total: ${store.keys.length} key(s)` });

      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Erro ao listar keys:", err);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Erro")
            .setDescription("Não foi possível listar as keys."),
        ],
      });
    }
    return;
  }

  if (content === "!ajuda") {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🤖 Comandos do Bot de Keys")
          .addFields(
            {
              name: "`!gerar <dias>`",
              value: "Gera uma nova key com validade em dias.\nEx: `!gerar 7`",
            },
            {
              name: "`!remover <KEY>`",
              value:
                "Remove uma key existente.\nEx: `!remover KEY-AB12CD34`",
            },
            {
              name: "`!listar`",
              value: "Lista todas as keys ativas e expiradas.",
            },
            { name: "`!ajuda`", value: "Exibe esta mensagem de ajuda." }
          )
          .setFooter({ text: "Cooldown: 5s por comando" }),
      ],
    });
  }
});

client.login(DISCORD_TOKEN);
