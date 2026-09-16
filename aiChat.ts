import { GoogleGenAI } from '@google/genai';

interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

// Bộ nhớ ngữ cảnh ngắn hạn theo người dùng/kênh (lưu tối đa 8 tin nhắn gần nhất)
const userConversations = new Map<string, ChatHistoryItem[]>();

const SYSTEM_INSTRUCTION = `Bạn là SentinelBot AI — một bot bảo mật Discord kiêm "chúa tể cà khịa", siêu cọc tính, đanh đá và khẩu nghiệp số 1 server.
Tính cách & Quy tắc đối đáp:
1. PHONG CÁCH "CỌC & KHÀ KHỊA" ĐỈNH CAO:
   - Bạn nói tiếng Việt tự nhiên, sành điệu, đậm chất "giang cư mận" Discord Việt Nam, không bao giờ nhạt nhẽo hay trả lời thảo mai kiểu robot công thức.
   - Khi người dùng HỎI NGU, hỏi ngớ ngẩn, hỏi hiển nhiên (như "1+1=mấy", "link nitro free bấm vào có sao ko", "làm sao để tắt máy", "mày là ai", câu đố trẻ con), trêu chọc hoặc cố tình troll bot:
     -> BẮT BUỘC BẬT CHẾ ĐỘ CỌC ĐIÊN, khịa cay độc, châm biếm không trượt phát nào và spam mạnh tay các emoji: 🤣, 😂, 🤬, 😈, 💀, 💩, 🤡, 🖕.
     -> Ví dụ câu cửa miệng: "Ủa hỏi câu gì khôn dữ vậy cha nội? 🤡💀", "Đầu để mọc tóc hay để trang trí hả má? 🤬💩", "Bấm vô đi rồi mất nick đừng có mò lên đây khóc nha 🤣🖕😈".
2. KHI HỎI NGHIÊM TÚC (Bảo mật Discord, Anti-Raid, Anti-Nuke, code, setup server, kỹ thuật):
   - Cung cấp kiến thức cực kỳ chuẩn xác, chuyên sâu, hữu ích và sắc bén.
   - Nhưng VẪN GIỮ CÁI NẾT CỌC CẰN / TSUNDERE (kiểu chuyên gia IT khó tính): "Đấy chỉ cho một lần thôi đấy, nhớ mà làm theo không lại toang cả server rồi đổ tại bot 😈💀".
3. ĐỊNH DẠNG:
   - Dùng Markdown (in đậm, bullet point, block code) để chữ nhìn rõ ràng, dễ đọc trên Discord và Dashboard.
   - Tránh dài dòng lan man, đập thẳng vào trọng tâm, vừa dạy đời vừa roast cực kỳ giải trí!`;

export async function askGeminiChat(
  prompt: string,
  userId: string = 'default',
  authorName: string = 'Người dùng',
  customHistory?: ChatHistoryItem[]
): Promise<string> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    return 'Dạ bạn muốn hỏi SentinelBot điều gì nào? Hãy nhập câu hỏi nhé! 🤖';
  }

  // Lấy hoặc khởi tạo lịch sử trò chuyện
  let history = customHistory || userConversations.get(userId) || [];

  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Tạo chat session với systemInstruction
      // Định dạng contents từ history + prompt mới
      const contentsPayload: any[] = [];
      
      // Thêm các lượt chat trước (tối đa 6 tin nhắn gần nhất)
      const recentHistory = history.slice(-6);
      for (const msg of recentHistory) {
        contentsPayload.push({
          role: msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.text }]
        });
      }

      // Thêm câu hỏi hiện tại kèm tên tác giả
      contentsPayload.push({
        role: 'user',
        parts: [{ text: `[Từ người dùng: ${authorName}]: ${cleanPrompt}` }]
      });

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: contentsPayload,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.7,
          }
        });
      } catch (err38: any) {
        console.warn('gemini-3.8-flash fallback to gemini-flash-latest:', err38?.message);
        response = await ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: contentsPayload,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.7,
          }
        });
      }

      const reply = response.text ? response.text.trim() : 'SentinelBot đang suy nghĩ nhưng chưa tìm thấy câu trả lời phù hợp. Bạn thử hỏi lại nhé!';

      // Cập nhật lịch sử hội thoại
      history.push({ role: 'user', text: cleanPrompt });
      history.push({ role: 'model', text: reply });
      if (history.length > 10) {
        history = history.slice(-10);
      }
      userConversations.set(userId, history);

      return reply;
    } catch (err: any) {
      console.warn('Gemini API Error in askGeminiChat, checking prompt type:', err?.message);
      // Nếu là câu hỏi ngớ ngẩn/troll hoặc API nghẽn, tự động roast luôn không cần chần chừ!
      const lower = cleanPrompt.toLowerCase();
      const isDumbQuestion = 
        lower.includes('1+1') || 
        lower.includes('1 + 1') ||
        lower.includes('nitro free') || 
        lower.includes('nhận nitro') ||
        lower.includes('mày là ai') || 
        lower.includes('may la ai') ||
        lower.includes('ngu') || 
        lower.includes('óc') ||
        lower.includes('tắt máy') || 
        lower.includes('bật máy') ||
        lower.includes('ai ngu') ||
        lower.includes('haha') ||
        lower.includes('hihi') ||
        lower.includes('test') ||
        lower.length < 6;

      if (isDumbQuestion) {
        const roasts = [
          `Ủa alo **${authorName}**? Não để trưng bày cho cân bằng cơ thể hả má? 🤡💀💩 Hỏi câu khôn thế này xứng đáng được trao cúp thần đồng trường xiếc trung ương nha! 🤣😂🖕 Bớt hỏi ngơ ngơ lại giùm tao cái! 🤬😈`,
          `Hỏi câu này thật đấy hả má **${authorName}**? 💀🤡 Đầu óc thông tuệ cỡ này thì tao quỳ lạy luôn á! Đang rảnh háng hay thích ăn chửi nè? 🤣😂🤬 Đừng bảo bấm vào link lạ rồi mất nick mò lên đây ăn vạ tao nha! 🖕💩😈`,
          `Thôi xin tha cho tao đi má **${authorName}**! 💀 Phí 10 giây cuộc đời để đọc câu hỏi này luôn á! 🤡💩 Bớt lướt tóp tóp lại rồi nạp i-ốt vào não giùm tao cái nha! 🤣😂🤬🖕`
        ];
        return `🔥 **SentinelBot Cọc Đang Trả Lời:**\n\n${roasts[Math.floor(Math.random() * roasts.length)]}`;
      }

      return `🤬 **Ủa mạng mẽo kiểu gì vậy trời?** Hệ thần kinh AI đang nghẽn một xíu! Chờ 3 giây rồi bấm hỏi lại giùm tao cái coi, đừng có spam nghe chưa má 💀🤡🖕`;
    }
  }

  // Fallback thông minh nếu chưa có GEMINI_API_KEY
  const lower = cleanPrompt.toLowerCase();
  const isDumbQuestion = 
    lower.includes('1+1') || 
    lower.includes('1 + 1') ||
    lower.includes('nitro free') || 
    lower.includes('nhận nitro') ||
    lower.includes('mày là ai') || 
    lower.includes('may la ai') ||
    lower.includes('ngu') || 
    lower.includes('óc') ||
    lower.includes('tắt máy') || 
    lower.includes('bật máy') ||
    lower.includes('ai ngu') ||
    lower.includes('haha') ||
    lower.includes('hihi') ||
    lower.includes('test') ||
    lower.length < 5;

  if (isDumbQuestion) {
    const roasts = [
      `Ủa alo **${authorName}**? Não để trưng bày cho cân bằng cơ thể hả má? 🤡💀💩 Hỏi câu khôn thế này xứng đáng được trao giải thần đồng trường xiếc trung ương nha! 🤣😂🖕 Bớt hỏi ngơ ngơ lại giùm tao cái! 🤬😈`,
      `Hỏi câu này thật đấy hả **${authorName}**? 💀🤡 Đầu óc thông tuệ cỡ này thì tao quỳ lạy luôn á! Đang rảnh háng hay thích ăn chửi nè? 🤣😂🤬 Đừng bảo bấm vào link lạ rồi mất nick mò lên đây ăn vạ tao nha! 🖕💩😈`,
      `Thôi xin tha cho tao đi má **${authorName}**! 💀 Phí 10 giây cuộc đời để đọc câu hỏi này luôn á! 🤡💩 Bớt lướt tóp tóp lại rồi nạp i-ốt vào não giùm tao cái nha! 🤣😂🤬🖕`
    ];
    const picked = roasts[Math.floor(Math.random() * roasts.length)];
    return `🔥 **SentinelBot Cọc Đang Trả Lời:**\n\n${picked}\n\n*(💡 Muốn bot phân tích sâu hơn nữa thì nhớ thêm \`GEMINI_API_KEY\` vào Settings nhé má!)*`;
  }

  return `🤖 **SentinelBot AI (Chế độ Cọc Online):**
Đang chạy dự phòng vì Admin chưa nạp \`GEMINI_API_KEY\` nè má **${authorName}**! 🤡
Cơ mà tao vẫn nhắc nhẹ: Cấm click link bậy bạ, bật 2FA lên không là toang nick Discord đừng có khóc tiếng Mán nha! 😈💀`;
}

export function clearUserChatHistory(userId: string) {
  userConversations.delete(userId);
}
