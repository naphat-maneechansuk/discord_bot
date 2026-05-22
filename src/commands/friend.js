import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { listLikers } from '../lib/likes.js';
import { friendListEmbed, friendSelectRow } from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('friend')
  .setDescription("Browse friends and play a friend's liked songs");

export async function execute(interaction) {
  const likers = await listLikers();
  const friends = likers.slice(0, 25).map((l) => {
    const member = interaction.guild?.members?.cache.get(l.id);
    return { ...l, displayName: member?.displayName ?? l.username };
  });

  return interaction.reply({
    embeds: [friendListEmbed(friends)],
    components: friends.length ? [friendSelectRow(friends)] : [],
    flags: MessageFlags.Ephemeral,
  });
}
