import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TelegramBotService,
  splitMessage,
} from '../src/server/telegram-bot.js';
import type { Platform } from '../src/server/platform.js';
import type { PlatformConfig } from '../src/server/platform-config.js';

describe('TelegramBotService', () => {
  describe('splitMessage', () => {
    it('returns a single chunk when text length is within limit', () => {
      const text = 'Hello world!';
      expect(splitMessage(text, 100)).toEqual(['Hello world!']);
    });

    it('splits text at newline when text exceeds limit', () => {
      const line1 = 'A'.repeat(50);
      const line2 = 'B'.repeat(50);
      const text = `${line1}\n${line2}`;
      const chunks = splitMessage(text, 60);
      expect(chunks).toEqual([line1, line2]);
    });

    it('splits text at spaces when no newline is present', () => {
      const word1 = 'A'.repeat(40);
      const word2 = 'B'.repeat(40);
      const text = `${word1} ${word2}`;
      const chunks = splitMessage(text, 50);
      expect(chunks).toEqual([word1, word2]);
    });

    it('splits hard at limit when no spaces or newlines are present', () => {
      const text = 'A'.repeat(120);
      const chunks = splitMessage(text, 50);
      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(50);
      expect(chunks[1].length).toBe(50);
      expect(chunks[2].length).toBe(20);
    });
  });

  describe('bot authorization and message handling', () => {
    let mockPlatform: Partial<Platform>;
    let mockConfig: PlatformConfig;
    let service: TelegramBotService;
    let sentMessages: Array<{ chatId: number | string; text: string }>;

    beforeEach(() => {
      sentMessages = [];
      mockConfig = {
        telegramBotToken: 'test-token-123',
        telegramAllowedUsers: ['12345', 'alif0x'],
        runtimeUrl: 'http://127.0.0.1:4310/api/copilotkit',
        baseUrl: 'https://api.openai.com/v1',
        voiceName: 'marin',
        slackUsers: [],
      };

      mockPlatform = {
        codex: {
          isConnected: () => true,
          getModel: () => 'gpt-6.1-sol',
        } as unknown as Platform['codex'],
        store: {
          settings: () => ({
            paused: false,
            name: 'OpenDots',
            researchAllowed: true,
            memoryAllowed: true,
            appsAllowed: true,
          }),
        } as unknown as Platform['store'],
        workspace: {
          dots: () => [
            {
              id: 'dot-1',
              name: 'General Dot',
              instructions: 'Help with general tasks',
              spaceId: 'space-1',
              spaceIds: ['space-1'],
              researchAllowed: true,
              memoryAllowed: true,
              appsAllowed: true,
              composioToolkits: [],
              createdAt: 0,
            },
            {
              id: 'dot-2',
              name: 'Researcher',
              instructions: 'Research web sources',
              spaceId: 'space-1',
              spaceIds: ['space-1'],
              researchAllowed: true,
              memoryAllowed: true,
              appsAllowed: true,
              composioToolkits: [],
              createdAt: 0,
            },
          ],
          dot: (id: string) => {
            if (id === 'dot-1') {
              return {
                id: 'dot-1',
                name: 'General Dot',
                instructions: 'Help with general tasks',
                spaceId: 'space-1',
                spaceIds: ['space-1'],
                researchAllowed: true,
                memoryAllowed: true,
                appsAllowed: true,
                composioToolkits: [],
                createdAt: 0,
              };
            }
            if (id === 'dot-2') {
              return {
                id: 'dot-2',
                name: 'Researcher',
                instructions: 'Research web sources',
                spaceId: 'space-1',
                spaceIds: ['space-1'],
                researchAllowed: true,
                memoryAllowed: true,
                appsAllowed: true,
                composioToolkits: [],
                createdAt: 0,
              };
            }
            return undefined;
          },
          spaces: () => [
            { id: 'space-1', name: 'Work', description: '', createdAt: 0 },
          ],
          bindThread: vi.fn(),
          requireThread: vi.fn(),
        } as unknown as Platform['workspace'],
      };

      service = new TelegramBotService(mockPlatform as Platform, mockConfig);
      // Mock sendMessage and sendChatAction to avoid real network calls
      service.sendMessage = vi.fn(async (chatId, text) => {
        sentMessages.push({ chatId, text });
      });
      service.sendChatAction = vi.fn(async () => {});
    });

    it('reports enabled when token is configured', () => {
      expect(service.isEnabled()).toBe(true);
      const disabled = new TelegramBotService(mockPlatform as Platform, {
        ...mockConfig,
        telegramBotToken: undefined,
      });
      expect(disabled.isEnabled()).toBe(false);
    });

    it('rejects unauthorized users with informative notice', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 999, type: 'private' },
        date: 0,
        from: {
          id: 88888,
          is_bot: false,
          first_name: 'Stranger',
          username: 'unknown_person',
        },
        text: 'Hello!',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Access Denied');
      expect(sentMessages[0].text).toContain('88888');
    });

    it('allows authorized users by ID', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: {
          id: 12345,
          is_bot: false,
          first_name: 'Alif',
          username: 'other_handle',
        },
        text: '/start',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Welcome to OpenDots Codex');
      expect(sentMessages[0].text).toContain('General Dot');
      expect(sentMessages[0].text).toContain('Connected');
    });

    it('allows authorized users by username', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 777, type: 'private' },
        date: 0,
        from: {
          id: 777,
          is_bot: false,
          first_name: 'Alif',
          username: 'Alif0x',
        },
        text: '/help',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('OpenDots Telegram Commands');
    });

    it('handles /status command correctly', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: { id: 12345, is_bot: false, first_name: 'Alif' },
        text: '/status',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('OpenDots Status');
      expect(sentMessages[0].text).toContain('gpt-6.1-sol');
      expect(sentMessages[0].text).toContain('General Dot');
    });

    it('lists available Dots with /dots', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: { id: 12345, is_bot: false, first_name: 'Alif' },
        text: '/dots',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('General Dot');
      expect(sentMessages[0].text).toContain('Researcher');
    });

    it('switches Dot with /dot command', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: { id: 12345, is_bot: false, first_name: 'Alif' },
        text: '/dot Researcher',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain(
        'Switched to specialist Dot: *Researcher*',
      );
    });

    it('handles /new or /reset command', async () => {
      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: { id: 12345, is_bot: false, first_name: 'Alif' },
        text: '/new',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Conversation refreshed');
    });

    it('blocks interactions when workspace is paused', async () => {
      mockPlatform.store!.settings = () => ({
        paused: true,
        name: 'OpenDots',
        researchAllowed: true,
        memoryAllowed: true,
        appsAllowed: true,
      });

      await service.handleMessage({
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 0,
        from: { id: 12345, is_bot: false, first_name: 'Alif' },
        text: 'Can you summarize my notes?',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('paused');
    });
  });
});
