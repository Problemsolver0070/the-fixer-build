# the-fixer-build

Early build of "The Fixer / Bricks": a browser-based IDE with a Claude-driven coding agent.
Sibling repo to `bricks`.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Clerk for auth
- Drizzle ORM against Postgres
- Zustand for client state
- Monaco editor + WebContainers for the in-browser dev environment
- PayPal for subscription billing
- Anthropic Foundry SDK (Claude via Azure AI Foundry) for the agent backend
- AWS Lambda Function URL for SSE streaming chat

See `package.json` for exact versions.

## Layout

```
src/                 Next.js app, components, stores, server actions
lambda-chat/         Standalone Lambda handler for the streaming chat endpoint
schema.sql           Postgres schema (also defined in Drizzle)
drizzle.config.ts    Drizzle Kit configuration
*.md                 Architecture notes (frontend, sandbox, websocket, billing, etc.)
```

## Local development

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm start
```

Lint:

```bash
npm run lint
```

Bundle the Lambda chat handler:

```bash
npm run build:lambda
```

## Configuration

Copy `.env.example` to `.env.local` and fill in:

- Clerk publishable + secret keys
- Postgres connection string
- Azure AI Foundry credentials for the Claude client
- PayPal client ID / secret
- Lambda Function URL for the streaming chat endpoint

## Notes

- WebContainers requires cross-origin isolation, so COOP/COEP headers are scoped to the `/chat` and `/build` routes via `next.config.ts` and `middleware.ts`.
- The chat endpoint streams Server-Sent Events from Lambda; the client uses a shared `useChatStream` hook to consume them.
- Tool use (e.g. `write_files`) is handled in `src/ai/` and surfaced in the UI through `ToolBlock` and `InlineImage` components.

## Author

Problemsolver0070
