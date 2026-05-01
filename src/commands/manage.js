import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { isAdmin } from '../web/auth.js';

export const data = new SlashCommandBuilder()
  .setName('manage')
  .setDescription('Get the link to the music bot dashboard (admin only)');

export async function execute(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({
      content: 'This command is restricted to admins.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const url = process.env.PUBLIC_WEB_URL ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`;
  return interaction.reply({
    content: `Dashboard: ${url}`,
    flags: MessageFlags.Ephemeral,
  });
}
