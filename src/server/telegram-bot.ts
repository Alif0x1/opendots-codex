import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import { DotAgent } from './dot-agent.js';
import type { Platform } from './platform.js';
import type { PlatformConfig } from './platform-config.js';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export class TelegramBotService {
  private polling = false;
  private abortController?: AbortController;
  private botInfo?: TelegramBotInfo;
  private chatActiveDot = new Map<number, string>();
  private chatThreadId = new Map<number, string>();

  constructor(
    private readonly platform: Platform,
    private readonly config: PlatformConfig,
  ) {}

  isEnabled(): boolean {
    return !!this.config.telegramBotToken?.trim();
  }

  getBotInfo(): TelegramBotInfo | undefined {
    return this.botInfo;
  }

  isPolling(): boolean {
    return this.polling;
  }

  private apiBase(): string {
    const token = this.config.telegramBotToken?.trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
    return `https://api.telegram.org/bot${token}`;
  }

  private async callApi<T>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.apiBase()}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Telegram API ${method} failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      ok: boolean;
      result: T;
      description?: string;
    };
    if (!data.ok) {
      throw new Error(
        `Telegram API error: ${data.description ?? 'Unknown failure'}`,
      );
    }

    return data.result;
  }

  async verify(): Promise<TelegramBotInfo> {
    const info = await this.callApi<TelegramBotInfo>('getMe');
    this.botInfo = info;
    return info;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    parseMode?: 'Markdown' | 'HTML',
  ): Promise<void> {
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      try {
        if (parseMode) {
          await this.callApi('sendMessage', {
            chat_id: chatId,
            text: chunk,
            parse_mode: parseMode,
          });
          continue;
        }
      } catch {
        // Fall back to plain text if Markdown parsing fails
      }
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: chunk,
      });
    }
  }

  async sendChatAction(
    chatId: number | string,
    action = 'typing',
  ): Promise<void> {
    try {
      await this.callApi('sendChatAction', {
        chat_id: chatId,
        action,
      });
    } catch {
      // Ignore transient typing indicator errors
    }
  }

  private isUserAuthorized(from?: TelegramUser): boolean {
    const allowed = this.config.telegramAllowedUsers;
    if (!allowed || allowed.length === 0) return true;
    if (!from) return false;

    const idStr = String(from.id);
    const username = from.username ? from.username.toLowerCase() : '';
    const usernameWithAt = username ? `@${username}` : '';

    return allowed.some((entry) => {
      const clean = entry.trim().toLowerCase();
      return clean === idStr || clean === username || clean === usernameWithAt;
    });
  }

  private getDotForChat(chatId: number): string {
    const mapped = this.chatActiveDot.get(chatId);
    if (mapped && this.platform.workspace.dot(mapped)) return mapped;

    if (
      this.config.telegramDotId &&
      this.platform.workspace.dot(this.config.telegramDotId)
    ) {
      return this.config.telegramDotId;
    }

    const first = this.platform.workspace.dots()[0];
    return first?.id ?? 'default';
  }

  private getOrCreateThreadId(
    chatId: number,
    dotId: string,
    title?: string,
  ): string {
    let threadId = this.chatThreadId.get(chatId);
    if (threadId) {
      try {
        this.platform.workspace.requireThread(threadId);
        return threadId;
      } catch {
        // Thread does not exist, recreate
      }
    }

    threadId = `telegram-${chatId}-${randomUUID().slice(0, 8)}`;
    this.platform.workspace.bindThread(
      threadId,
      dotId,
      title ?? `Telegram Chat (${chatId})`,
    );
    this.chatThreadId.set(chatId, threadId);
    return threadId;
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;

    const chatId = message.chat.id;
    const from = message.from;

    if (!this.isUserAuthorized(from)) {
      await this.sendMessage(
        chatId,
        `⛔ *Access Denied*: You are not authorized to access this OpenDots workspace.\n\nYour Telegram User ID: \`${from?.id ?? 'unknown'}\`${from?.username ? `\nUsername: @${from.username}` : ''}\n\nTo allow access, add your ID or username to \`TELEGRAM_ALLOWED_USERS\` in your OpenDots \`.env\`.`,
        'Markdown',
      );
      return;
    }

    if (text === '/start') {
      const dotId = this.getDotForChat(chatId);
      const dot = this.platform.workspace.dot(dotId);
      const isCodex = this.platform.codex.isConnected();
      await this.sendMessage(
        chatId,
        `👋 *Welcome to OpenDots Codex on Telegram!*\n\n` +
          `I am connected to your private desktop workspace.\n\n` +
          `🤖 *Active Specialist:* ${dot?.name ?? 'General Dot'}\n` +
          `💻 *Codex CLI Session:* ${isCodex ? '🟢 Connected' : '⚪ Setup Required'}\n` +
          `📚 *Spaces Available:* ${this.platform.workspace.spaces().length}\n\n` +
          `Send any message to chat with your Dot, or use /help to view available commands.`,
        'Markdown',
      );
      return;
    }

    if (text === '/help') {
      await this.sendMessage(
        chatId,
        `*OpenDots Telegram Commands:*\n\n` +
          `• \`/start\` - Welcome banner and status\n` +
          `• \`/status\` - Diagnostic info (Codex, model, workspace)\n` +
          `• \`/dots\` - List available specialist Dots\n` +
          `• \`/dot <name>\` - Switch active Dot for this chat\n` +
          `• \`/new\` - Start a fresh conversation\n` +
          `• \`/help\` - Show this help menu`,
        'Markdown',
      );
      return;
    }

    if (text === '/status') {
      const dotId = this.getDotForChat(chatId);
      const dot = this.platform.workspace.dot(dotId);
      const isCodex = this.platform.codex.isConnected();
      const codexModel = this.platform.codex.getModel();
      const paused = this.platform.store.settings().paused;

      await this.sendMessage(
        chatId,
        `📊 *OpenDots Status*\n\n` +
          `• *Codex CLI:* ${isCodex ? '🟢 Connected' : '⚪ Not connected'}\n` +
          `• *Active Model:* ${codexModel ?? this.config.model ?? 'Default'}\n` +
          `• *Current Dot:* ${dot?.name ?? 'None'}\n` +
          `• *Total Dots:* ${this.platform.workspace.dots().length}\n` +
          `• *Spaces:* ${this.platform.workspace.spaces().length}\n` +
          `• *Paused:* ${paused ? '⏸️ Yes' : '▶️ No'}`,
        'Markdown',
      );
      return;
    }

    if (text === '/dots') {
      const activeDotId = this.getDotForChat(chatId);
      const dots = this.platform.workspace.dots();
      if (!dots.length) {
        await this.sendMessage(
          chatId,
          'No specialist Dots configured yet in this workspace.',
        );
        return;
      }

      const list = dots
        .map((d) => {
          const isCurrent = d.id === activeDotId;
          const preview = d.instructions
            ? ` - ${d.instructions.slice(0, 80)}…`
            : '';
          return `${isCurrent ? '👉 ' : '• '}*${d.name}*${isCurrent ? ' _(active)_' : ''}${preview}`;
        })
        .join('\n');

      await this.sendMessage(
        chatId,
        `🤖 *Available Specialist Dots:*\n\n${list}\n\nTo switch, type \`/dot <name>\` (e.g. \`/dot ${dots[0].name}\`).`,
        'Markdown',
      );
      return;
    }

    if (text.startsWith('/dot ')) {
      const targetName = text.slice(5).trim().toLowerCase();
      const target = this.platform.workspace
        .dots()
        .find(
          (d) => d.name.toLowerCase() === targetName || d.id === targetName,
        );

      if (!target) {
        await this.sendMessage(
          chatId,
          `Dot "${text.slice(5).trim()}" not found. Type /dots to list available specialist Dots.`,
        );
        return;
      }

      this.chatActiveDot.set(chatId, target.id);
      this.chatThreadId.delete(chatId);
      await this.sendMessage(
        chatId,
        `✅ Switched to specialist Dot: *${target.name}*.\nA new conversation has been started.`,
        'Markdown',
      );
      return;
    }

    if (text === '/new' || text === '/reset') {
      const dotId = this.getDotForChat(chatId);
      this.chatThreadId.delete(chatId);
      this.getOrCreateThreadId(chatId, dotId);
      await this.sendMessage(
        chatId,
        '🔄 Conversation refreshed. What would you like to work on?',
      );
      return;
    }

    if (this.platform.store.settings().paused) {
      await this.sendMessage(
        chatId,
        '⏸️ OpenDots is currently paused. Resume it in the desktop app before continuing.',
      );
      return;
    }

    const dotId = this.getDotForChat(chatId);
    const dot = this.platform.workspace.dot(dotId);
    if (!dot) {
      await this.sendMessage(
        chatId,
        'Specialist Dot not found. Use /dots to choose an active Dot.',
      );
      return;
    }

    const threadId = this.getOrCreateThreadId(
      chatId,
      dotId,
      `Telegram: ${from?.first_name ?? from?.username ?? chatId}`,
    );

    // Keep typing indicator active while Dot responds
    await this.sendChatAction(chatId, 'typing');
    const typingInterval = setInterval(() => {
      void this.sendChatAction(chatId, 'typing');
    }, 4000);

    try {
      const answer = await this.executeTurn(dot.id, threadId, text);
      clearInterval(typingInterval);
      await this.sendMessage(chatId, answer, 'Markdown');
    } catch (error) {
      clearInterval(typingInterval);
      const messageText =
        error instanceof Error ? error.message : 'Unknown error';
      await this.sendMessage(
        chatId,
        `⚠️ Could not complete request: ${messageText}`,
      );
    }
  }

  private async executeTurn(
    dotId: string,
    threadId: string,
    prompt: string,
  ): Promise<string> {
    const agent = new DotAgent(
      this.platform.store,
      this.platform.workspace,
      this.config,
      dotId,
      false,
      this.platform.codex,
      this.platform.setupTelemetry,
    );

    return new Promise<string>((resolve, reject) => {
      let fullText = '';
      const runId = randomUUID();
      const subscription = agent
        .run({
          threadId,
          runId,
          state: {},
          messages: [{ id: randomUUID(), role: 'user', content: prompt }],
          tools: [],
          context: [],
          forwardedProps: {},
        })
        .subscribe({
          next: (event) => {
            if (
              event.type === EventType.TEXT_MESSAGE_CONTENT &&
              typeof event.delta === 'string'
            ) {
              fullText += event.delta;
            } else if (event.type === EventType.RUN_FINISHED) {
              resolve(fullText.trim() || 'Completed.');
            } else if (event.type === EventType.RUN_ERROR) {
              const errorMessage =
                typeof (event as Record<string, unknown>).message === 'string'
                  ? ((event as Record<string, unknown>).message as string)
                  : 'Dot execution encountered an error.';
              reject(new Error(errorMessage));
            }
          },
          error: (err: unknown) => {
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          complete: () => {
            resolve(fullText.trim() || 'Completed.');
          },
        });

      if (this.abortController?.signal) {
        this.abortController.signal.addEventListener(
          'abort',
          () => {
            subscription.unsubscribe();
            agent.abortRun();
            reject(new Error('Bot stopped.'));
          },
          { once: true },
        );
      }
    });
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    if (this.polling) return;

    try {
      await this.verify();
    } catch (error) {
      console.error(
        `Telegram bot verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    this.polling = true;
    this.abortController = new AbortController();
    void this.pollLoop(this.abortController.signal);
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.abortController?.abort();
    this.abortController = undefined;
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let offset = 0;
    while (this.polling && !signal.aborted) {
      try {
        const updates = await this.callApi<TelegramUpdate[]>(
          'getUpdates',
          { offset, timeout: 25, allowed_updates: ['message'] },
          signal,
        );

        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.message) {
            void this.handleMessage(update.message);
          }
        }
      } catch {
        if (signal.aborted) break;
        // Wait 3 seconds on error before retrying poll
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}

export function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLen);
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.filter(Boolean);
}
