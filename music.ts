import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  AudioPlayer,
  VoiceConnection,
  entersState,
} from '@discordjs/voice';
import {
  Message,
  EmbedBuilder,
  PermissionsBitField,
  TextBasedChannel,
} from 'discord.js';
import play from 'play-dl';
import ffmpegPath from 'ffmpeg-static';

// Configure FFMPEG path
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

// Ensure SoundCloud Client ID is initialized
let scClientId = 'Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo';
async function initSoundCloud() {
  try {
    const freeId = await play.getFreeClientID();
    if (freeId) {
      scClientId = freeId;
    }
  } catch {
    // Fallback ID is already set
  }
  await play.setToken({ soundcloud: { client_id: scClientId } });
}
initSoundCloud();

export interface Song {
  title: string;
  url: string;
  duration: string;
  thumbnail?: string;
  requestedBy: string;
  scTrack: any;
}

export interface GuildQueue {
  voiceChannelId: string;
  textChannelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  songs: Song[];
  isPlaying: boolean;
  volume: number;
}

export const musicQueues = new Map<string, GuildQueue>();

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Plays the next song in the guild queue
 */
export async function playNextSong(guildId: string, client: any) {
  const queue = musicQueues.get(guildId);
  if (!queue) return;

  if (queue.songs.length === 0) {
    queue.isPlaying = false;
    const textChannel = client.channels.cache.get(queue.textChannelId) as TextBasedChannel | undefined;
    if (textChannel && 'send' in textChannel) {
      textChannel.send('⏹️ Đã phát hết danh sách bài hát trong hàng đợi.').catch(() => {});
    }
    return;
  }

  const song = queue.songs[0];

  try {
    // Ensure SoundCloud token is ready
    await play.setToken({ soundcloud: { client_id: scClientId } });

    // Stream from SoundCloud track info
    let stream: any;
    if (song.scTrack) {
      stream = await play.stream_from_info(song.scTrack);
    } else {
      stream = await play.stream(song.url);
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });

    if (resource.volume) {
      resource.volume.setVolume(queue.volume);
    }

    queue.player.play(resource);
    queue.isPlaying = true;

    const textChannel = client.channels.cache.get(queue.textChannelId) as TextBasedChannel | undefined;
    if (textChannel && 'send' in textChannel) {
      const embed = new EmbedBuilder()
        .setTitle('🎶 Đang Phát Nhạc')
        .setDescription(`[**${song.title}**](${song.url})`)
        .setColor('#23A559')
        .addFields(
          { name: '⏱️ Thời lượng', value: song.duration || 'N/A', inline: true },
          { name: '👤 Yêu cầu bởi', value: song.requestedBy, inline: true },
          { name: '🔊 Âm lượng', value: `${Math.round(queue.volume * 100)}%`, inline: true }
        )
        .setFooter({ text: 'SentinelBot Music • Gõ .skip để chuyển bài | .stop để dừng' });

      if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
      }

      textChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (error: any) {
    console.error('Error playing track:', error);
    const textChannel = client.channels.cache.get(queue.textChannelId) as TextBasedChannel | undefined;
    if (textChannel && 'send' in textChannel) {
      textChannel.send(`⚠️ Lỗi khi phát bài: **${song.title}** (${error.message || 'Lỗi stream'}). Đang chuyển bài tiếp...`).catch(() => {});
    }
    queue.songs.shift();
    playNextSong(guildId, client);
  }
}

/**
 * Resolves a song query (keyword or YouTube/SoundCloud URL) into a playable track
 */
async function searchSong(rawQuery: string): Promise<Song | null> {
  await initSoundCloud();

  let searchTerm = rawQuery.trim();

  // If query is a YouTube URL, resolve title via public oEmbed API without bot checks
  if (searchTerm.includes('youtube.com/') || searchTerm.includes('youtu.be/')) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(searchTerm)}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data: any = await res.json();
        if (data.title) {
          searchTerm = data.title;
        }
      }
    } catch {
      // Keep original searchTerm
    }
  }

  // Search on YouTube first
  try {
    const ytResults = await play.search(searchTerm, {
      source: { youtube: 'video' },
      limit: 5,
    });

    if (ytResults && ytResults.length > 0) {
      const searchWords = searchTerm.toLowerCase().split(/\s+/);
      
      // Rank results by title similarity
      const rankedResults = ytResults.map(track => {
        const title = (track.title || '').toLowerCase();
        let score = 0;
        searchWords.forEach(word => {
          if (title.includes(word)) score++;
        });
        return { track, score };
      }).sort((a, b) => b.score - a.score);

      const bestMatch = rankedResults[0].track;

      return {
        title: bestMatch.title || searchTerm,
        url: bestMatch.url,
        duration: formatDuration(bestMatch.durationInSec || 0),
        thumbnail: bestMatch.thumbnails[0]?.url,
        requestedBy: '',
        scTrack: null,
      };
    }
  } catch (err) {
    console.error('YouTube search error:', err);
  }

  // Fallback: Search on SoundCloud
  try {
    const scResults = await play.search(searchTerm, {
      source: { soundcloud: 'tracks' },
      limit: 1,
    });

    if (scResults && scResults.length > 0) {
      const track = scResults[0];
      return {
        title: track.name || searchTerm,
        url: track.url,
        duration: formatDuration(track.durationInSec),
        thumbnail: track.thumbnail,
        requestedBy: '',
        scTrack: track,
      };
    }
  } catch (err) {
    console.error('SoundCloud search error:', err);
  }

  return null;
}

/**
 * Handles all music-related commands (.play, .skip, .stop, etc.)
 */
export async function handleMusicCommand(
  command: string,
  args: string[],
  message: Message,
  client: any
) {
  if (!message.guild) return;

  const memberVoiceChannel = message.member?.voice.channel;

  switch (command) {
    case 'play': {
      if (!memberVoiceChannel) {
        await message.reply('❌ Bạn cần phải tham gia vào một kênh thoại (Voice Channel) trước!');
        return;
      }

      const permissions = memberVoiceChannel.permissionsFor(message.guild.members.me!);
      if (!permissions?.has(PermissionsBitField.Flags.Connect) || !permissions.has(PermissionsBitField.Flags.Speak)) {
        await message.reply('❌ Bot không có quyền Kết nối (Connect) hoặc Nói (Speak) trong kênh thoại của bạn!');
        return;
      }

      const query = args.join(' ').trim();
      if (!query) {
        await message.reply('❌ Vui lòng nhập tên bài hát hoặc link nhạc. Ví dụ: `.play novocaine` hoặc `.play Shape of You`');
        return;
      }

      const searchingMsg = await message.reply(`🔍 Đang tìm kiếm và chuẩn bị phát: \`${query}\`...`);

      try {
        const songInfo = await searchSong(query);

        if (!songInfo) {
          await searchingMsg.edit(`❌ Không tìm thấy bài hát nào cho từ khóa: \`${query}\`. Hãy thử từ khóa khác!`);
          return;
        }

        songInfo.requestedBy = message.author.tag;

        let queue = musicQueues.get(message.guild.id);

        if (!queue) {
          const connection = joinVoiceChannel({
            channelId: memberVoiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator as any,
          });

          const player = createAudioPlayer();

          connection.subscribe(player);

          queue = {
            voiceChannelId: memberVoiceChannel.id,
            textChannelId: message.channel.id,
            connection,
            player,
            songs: [],
            isPlaying: false,
            volume: 1,
          };

          musicQueues.set(message.guild.id, queue);

          // Handle player status changes
          player.on(AudioPlayerStatus.Idle, () => {
            const currentQueue = musicQueues.get(message.guild!.id);
            if (currentQueue && currentQueue.songs.length > 0) {
              currentQueue.songs.shift(); // Remove finished song
              playNextSong(message.guild!.id, client);
            }
          });

          player.on('error', (err) => {
            console.error('Player runtime error:', err);
            const currentQueue = musicQueues.get(message.guild!.id);
            if (currentQueue && currentQueue.songs.length > 0) {
              currentQueue.songs.shift();
              playNextSong(message.guild!.id, client);
            }
          });

          connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
              await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
            } catch {
              connection.destroy();
              musicQueues.delete(message.guild!.id);
            }
          });
        }

        queue.songs.push(songInfo);

        if (!queue.isPlaying) {
          await searchingMsg.delete().catch(() => {});
          playNextSong(message.guild.id, client);
        } else {
          const queueEmbed = new EmbedBuilder()
            .setTitle('➕ Đã Thêm Vào Hàng Đợi')
            .setDescription(`[**${songInfo.title}**](${songInfo.url})`)
            .setColor('#5865F2')
            .addFields(
              { name: '⏱️ Thời lượng', value: songInfo.duration, inline: true },
              { name: '🔢 Vị trí hàng đợi', value: `#${queue.songs.length}`, inline: true },
              { name: '👤 Yêu cầu bởi', value: songInfo.requestedBy, inline: true }
            );
          if (songInfo.thumbnail) {
            queueEmbed.setThumbnail(songInfo.thumbnail);
          }
          await searchingMsg.edit({ content: '', embeds: [queueEmbed] });
        }
      } catch (err: any) {
        console.error('Error in .play command:', err);
        await searchingMsg.edit(`❌ Đã xảy ra lỗi khi tìm kiếm bài hát: ${err.message || 'Lỗi không xác định'}`);
      }
      break;
    }

    case 'volume':
    case 'vol': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue) {
        await message.reply('❌ Bot hiện không phát nhạc trong phòng thoại!');
        return;
      }
      const volArg = parseInt(args[0]);
      if (isNaN(volArg) || volArg < 1 || volArg > 150) {
        await message.reply(`🔊 Âm lượng hiện tại: **${Math.round(queue.volume * 100)}%**. Để thay đổi, gõ: \`.volume 1-150\``);
        return;
      }
      queue.volume = volArg / 100;
      await message.reply(`🔊 Đã điều chỉnh âm lượng thành **${volArg}%**.`);
      break;
    }

    case 'skip':
    case 's': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue || !queue.isPlaying) {
        await message.reply('❌ Hiện tại không có bài hát nào đang phát để chuyển bài!');
        return;
      }
      if (!memberVoiceChannel || memberVoiceChannel.id !== queue.voiceChannelId) {
        await message.reply('❌ Bạn phải ở cùng kênh thoại với Bot để chuyển bài!');
        return;
      }

      const skippedSong = queue.songs[0]?.title || 'bài hiện tại';
      queue.player.stop();
      await message.reply(`⏭️ Đã bỏ qua: **${skippedSong}**`);
      break;
    }

    case 'stop':
    case 'leave': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue) {
        await message.reply('❌ Bot không có trong kênh thoại nào!');
        return;
      }
      if (!memberVoiceChannel || memberVoiceChannel.id !== queue.voiceChannelId) {
        await message.reply('❌ Bạn phải ở cùng kênh thoại với Bot để dừng nhạc!');
        return;
      }

      queue.songs = [];
      queue.player.stop();
      queue.connection.destroy();
      musicQueues.delete(message.guild.id);
      await message.reply('🛑 Đã dừng phát nhạc, xóa toàn bộ hàng đợi và rời khỏi kênh thoại.');
      break;
    }

    case 'pause': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue || !queue.isPlaying) {
        await message.reply('❌ Không có bài hát nào đang phát để tạm dừng!');
        return;
      }
      queue.player.pause();
      await message.reply('⏸️ Đã tạm dừng phát nhạc. Dùng `.resume` để tiếp tục.');
      break;
    }

    case 'resume': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue) {
        await message.reply('❌ Không có bài hát nào đang bị tạm dừng!');
        return;
      }
      queue.player.unpause();
      await message.reply('▶️ Đã tiếp tục phát nhạc.');
      break;
    }

    case 'queue':
    case 'q': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue || queue.songs.length === 0) {
        await message.reply('📭 Hàng đợi hiện đang trống! Dùng `.play <tên bài>` để thêm bài hát.');
        return;
      }

      const current = queue.songs[0];
      const upcoming = queue.songs.slice(1, 11);

      const listText = upcoming.length > 0
        ? upcoming.map((s, idx) => `\`${idx + 1}.\` [${s.title}](${s.url}) | \`${s.duration}\` (bởi ${s.requestedBy})`).join('\n')
        : '_Không có bài hát tiếp theo trong hàng đợi._';

      const embed = new EmbedBuilder()
        .setTitle(`📜 Hàng Đợi Nhạc - ${message.guild.name}`)
        .setColor('#5865F2')
        .addFields(
          { name: '🎶 Đang phát', value: `[**${current.title}**](${current.url}) | \`${current.duration}\` (bởi ${current.requestedBy})` },
          { name: `📑 Tiếp theo (${queue.songs.length - 1} bài)`, value: listText }
        )
        .setFooter({ text: `Tổng cộng ${queue.songs.length} bài hát trong hàng đợi` });

      await message.reply({ embeds: [embed] });
      break;
    }

    case 'nowplaying':
    case 'np': {
      const queue = musicQueues.get(message.guild.id);
      if (!queue || !queue.isPlaying || queue.songs.length === 0) {
        await message.reply('❌ Hiện tại không có bài hát nào đang phát!');
        return;
      }

      const current = queue.songs[0];
      const embed = new EmbedBuilder()
        .setTitle('🎶 Bài Hát Đang Phát')
        .setDescription(`[**${current.title}**](${current.url})`)
        .setColor('#23A559')
        .addFields(
          { name: '⏱️ Thời lượng', value: current.duration, inline: true },
          { name: '👤 Yêu cầu bởi', value: current.requestedBy, inline: true },
          { name: '📑 Còn lại trong hàng đợi', value: `${queue.songs.length - 1} bài`, inline: true }
        );

      if (current.thumbnail) {
        embed.setThumbnail(current.thumbnail);
      }

      await message.reply({ embeds: [embed] });
      break;
    }
  }
}
