import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  CopilotSseRuntime,
  createCopilotHonoHandler,
  type AgentsConfig,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import {
  INTELLIGENCE_KEY_MISSING_LABEL,
  setupStatus,
  type PlatformConfig,
} from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
import { CodexService } from './codex-app-server.js';
import { SetupTelemetry } from './setup-telemetry.js';
import { TelegramBotService } from './telegram-bot.js';
export class Platform {
  private channelStartupFailed = false;
  private codexConnected = false;
  readonly codex = new CodexService();
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly telegram?: TelegramBotService;
  readonly intelligence?: CopilotKitIntelligence;
  readonly handler?: CopilotHonoApp;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    this.pages = new PageService(
      workspace,
      () => {
        this.requireReady();
        return this.intelligence!;
      },
      () => this.codexConnected,
      async (threadId) =>
        this.codex.readThread(this.workspace.codexThread(threadId)),
    );
    if (config.telegramBotToken) {
      this.telegram = new TelegramBotService(this, config);
    }
    if (!config.intelligenceKey) return;
    this.intelligence = new CopilotKitIntelligence({
      apiKey: config.intelligenceKey,
      apiUrl: config.intelligenceApiUrl,
      wsUrl: config.intelligenceWsUrl,
      getLearningContainerId: learningSelector(
        workspace,
        config.slackDotId ?? workspace.dots()[0]?.id,
      ),
    });
    const channels = [];
    if (
      this.intelligence &&
      config.slackChannel &&
      config.slackTeam &&
      config.slackUsers.length
    ) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () =>
          new DotAgent(
            store,
            workspace,
            config,
            dotId,
            true,
            this.codex,
            this.setupTelemetry,
          ),
      });
      channels.push(slack);
    }
    const agents = (async () =>
      Object.fromEntries(
        workspace
          .dots()
          .map((dot): [string, DotAgent] => [
            dot.id,
            new DotAgent(
              store,
              workspace,
              config,
              dot.id,
              false,
              this.codex,
              this.setupTelemetry,
            ),
          ]),
      )) as unknown as AgentsConfig;
    const runtime = this.intelligence
      ? new CopilotRuntime({
          intelligence: this.intelligence,
          telemetryId: this.setupTelemetry.identity,
          telemetryProperties: this.setupTelemetry.metadata,
          identifyUser: async () => ({
            id: workspace.ownerId,
            name: 'OpenDots owner',
          }),
          agents,
          channels,
          generateThreadNames: true,
        })
      : new CopilotSseRuntime({ agents });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  setup() {
    return setupStatus(
      this.config,
      this.handler?.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
      this.codexConnected,
    );
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Connect the local Codex account in Settings or configure ${missing.join(', ')}.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    try {
      this.codexConnected = (await this.codex.verify()).connected;
    } catch {
      this.codexConnected = false;
    }
    if (this.telegram) {
      await this.telegram.start().catch((err: unknown) => {
        console.error(
          'Telegram bot failed to start:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
    if (this.handler?.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        this.setupTelemetry.capture({
          kind: 'setup_failed',
          step: 'settings',
          error_class: 'channel_start_failed',
        });
        throw error;
      }
    }
  }
  async stop() {
    await this.setupTelemetry.stop();
    await this.telegram?.stop();
    await this.handler?.channels?.stop();
  }
  async verifyCodex() {
    const status = await this.codex.verify();
    this.codexConnected = status.connected;
    return {
      connected: this.codexConnected,
      accountType: status.accountType,
      model: status.model,
    };
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    if (!this.codexConnected) {
      try {
        await this.intelligence!.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
      } catch {
        throw new Error(
          'Intelligence could not create this conversation. Check the runtime key and connection.',
        );
      }
    }
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    if (this.codexConnected) {
      const messages = await this.codex.readThread(
        this.workspace.codexThread(threadId),
      );
      return messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
        .slice(-12000);
    }
    const history = await this.intelligence!.getThreadMessages({
      threadId,
      userId: this.workspace.ownerId,
    });
    return history.messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async messages(threadId: string) {
    this.requireReady();
    this.workspace.requireThread(threadId);
    if (!this.codexConnected) return [];
    return this.codex.readThread(this.workspace.codexThread(threadId));
  }
  async handle(request: Request): Promise<Response> {
    if (!this.handler)
      return Response.json(
        {
          error: this.codexConnected
            ? 'Conversation runtime unavailable.'
            : `Setup required: ${INTELLIGENCE_KEY_MISSING_LABEL}.`,
        },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
}
