import { ChatConsole } from "@/components/console/chat-console";

/**
 * The chat console.
 *
 * Server component so the opening suggestions come from one place, but the
 * conversation itself is client-side: every answer is a read performed at the
 * moment it is asked for, and caching that would be the one thing this screen
 * must not do.
 */

export const dynamic = "force-dynamic";

const SUGGESTIONS = [
  "show me the fleet",
  "show research",
  "who can write agent-context on research",
] as const;

export default function ChatPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">Console</h1>
        <p className="text-sm text-muted-foreground">
          Ask about an agent. The answer is a diagram of what was read, with the
          rows it was drawn from.
        </p>
      </header>

      <ChatConsole suggestions={SUGGESTIONS} />
    </main>
  );
}
