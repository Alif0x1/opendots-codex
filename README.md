# OpenDots Codex

**A self-hosted desktop AI workspace that uses your own signed-in Codex CLI account.** Run OpenDots on your computer; your Codex session stays in Codex on that computer.

OpenDots Codex is an independent community project based on [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots). It adds a local Codex CLI connection to OpenDots' personal AI workspace for conversations, documents, research, and specialist agents.

[![CI](https://github.com/Alif0x1/opendots-codex/actions/workflows/ci.yml/badge.svg)](https://github.com/Alif0x1/opendots-codex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## What you can do

- Chat with a personal Dot that uses the Codex account already signed in on your desktop.
- Create focused specialist Dots with different instructions and permissions.
- Organize conversations, notes, and pages in Spaces.
- Research public web pages and save useful results in your workspace.
- Extend the app with your own local tools and workflows.

## Install and run

Each person runs their own OpenDots server on the same computer as their Codex CLI sign-in. Use Node.js 24 or newer, npm, and Git.

### 1. Install and sign in to Codex CLI

Follow the [official Codex CLI installation guide](https://github.com/openai/codex#readme). With npm:

```sh
npm install -g @openai/codex
codex login
codex login status
```

Complete the ChatGPT sign-in in the browser. `codex login status` should confirm that the CLI is signed in.

### 2. Install OpenDots Codex

```sh
git clone https://github.com/Alif0x1/opendots-codex.git
cd opendots-codex
npm ci
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). When the local server starts, OpenDots automatically checks the Codex CLI session and uses it if signed in. In **Settings & setup**, confirm Codex shows as connected. No API key or pasted token is needed for this local connection.

For a production build on the same computer:

```sh
npm run build
npm start
```

Then open [http://127.0.0.1:4310](http://127.0.0.1:4310). Keep the server bound to `127.0.0.1`; this is a single-user desktop app, not a shared hosted service.

### If OpenDots cannot find Codex CLI

If `codex login status` works but OpenDots does not detect the CLI, find its executable path and set it in `.env`:

```dotenv
CODEX_CLI_PATH=/absolute/path/to/codex
```

Use `command -v codex` on macOS/Linux or `where.exe codex` on Windows. Restart OpenDots after changing `.env`. The account must be signed in under the same operating-system user that runs the OpenDots server.

## How the local Codex connection works

OpenDots starts `codex app-server --stdio` on the same computer and asks it to verify the current account. It selects a model that the account reports as available, then sends conversation turns through that local app-server. OpenDots saves the mapping between its conversation and the Codex thread in its local SQLite database; Codex manages its own sign-in and thread history.

The app does not copy Codex credentials into browser storage or ask users to paste a session token. Each person needs their own local OpenDots process and Codex CLI sign-in. A Docker container or remote server cannot automatically use a desktop's Codex session. Do not expose this single-owner app to the public internet or share one server across users.

This integration is also a pattern you can adapt: keep account authentication in the official local CLI, have your desktop app communicate with its supported local app-server interface, and pass only the tools and permissions your app intends to expose. See [`src/server/codex-app-server.ts`](src/server/codex-app-server.ts) and the [Codex setup guide](docs/SETUP.md#use-your-local-codex-account).

## Features

| Area                       | Included                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Local Codex Workspace      | Automatic local Codex CLI detection, app-server session routing, model auto-detection, zero-credential storage                          |
| Spaces and Specialist Dots | Saved names, role instructions, and per-Dot research and memory permissions                                                             |
| Pages                      | Searchable library, visual editor, slash commands, autosave, and revision checks                                                        |
| Conversations              | React SDK chat and Threads integration, page-specific conversations, and source links                                                   |
| Slack                      | Managed Channels SDK declaration with workspace and user allowlists                                                                     |
| Telegram Bot               | Native long-polling bot, user allowlists, Dot switching, /status diagnostics, and chat turns                                            |
| Calls                      | WebRTC speech, delegated compute, bounded sessions, hangup, and timeline receipts                                                       |
| Background work            | Scheduled server-side turns in their original conversation, with pause and retry controls                                               |
| Browser                    | Separate read-only public-page service with page capture and navigation limits                                                          |
| Dot computers              | Per-Dot browser profiles, files, shell, takeover, permissions, and action records through OpenBot                                       |
| Connections                | Per-Dot MCP servers, Composio connected apps, per-tool access, and owner approval for MCP write actions                                 |
| Appearance                 | System, light, and dark themes; dark colors are derived at build time from the light styles                                             |
| Memory                     | User-managed preferences that permitted Dots can use                                                                                    |
| Automatic Learning         | Per-Dot Learning containers, conversation evidence routing, and published-skill delivery; see [setup](docs/SETUP.md#automatic-learning) |
| Deployment                 | Local Node setup and separate application/browser containers                                                                            |

## Configure other services

Codex chat works without configuring an API key. Other OpenDots features can use optional services configured in `.env`, including an OpenAI-compatible model provider, public web research, voice, Slack, and isolated browser/computer services. See [Setup](docs/SETUP.md) and [Computer setup](docs/COMPUTERS.md).

## Build your own version

OpenDots Codex is a starting point for building a personal AI workspace. You can change the Dot instructions, add tools to `src/server/dot-agent.ts`, build new workspace screens, or adapt the local Codex app-server bridge for your own desktop workflows. Keep personal session credentials in Codex's own profile; never commit them or send them to a shared server.

This project is a single-owner template. It does not provide multi-user accounts, shared workspaces, or server-side Codex OAuth. If you add remote hosting, first design per-user identity, isolation, consent, and a supported way for each user's local Codex connection to communicate with that host.

## Credits and license

This project is derived from [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots), an open-source workspace built with [CopilotKit](https://github.com/CopilotKit/CopilotKit) and [AG-UI](https://docs.ag-ui.com/introduction). Thank you to the original maintainers and contributors. The upstream project's MIT license and copyright notices are retained in [`LICENSE`](LICENSE).

OpenDots Codex is an independent community project and is not an official CopilotKit or OpenAI product.
