import { create } from "zustand";
import type { Attachment } from "@/lib/types/attachment";
import type { Citation } from "@/lib/ai/types";

// ─── Message Type ────────────────────────────────────────────────────────────

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: Attachment[] | null;

  // Phase 1: Thinking + Citations
  thinkingContent?: string;
  thinkingDurationMs?: number;
  citations?: Citation[];
}

// ─── Streaming State ─────────────────────────────────────────────────────────

interface StreamingState {
  content: string;
  thinkingContent: string;
  activeBlock: "thinking" | "text" | null;
  citations: Citation[];
  thinkingStartedAt: number | null;
}

const EMPTY_STREAMING: StreamingState = {
  content: "",
  thinkingContent: "",
  activeBlock: null,
  citations: [],
  thinkingStartedAt: null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

interface ChatState {
  messages: ChatMessageItem[];
  isStreaming: boolean;
  streaming: StreamingState;

  // Keep legacy accessor for backward compat during migration
  streamingContent: string;

  // Actions
  setMessages: (messages: ChatMessageItem[]) => void;
  addMessage: (message: ChatMessageItem) => void;
  setStreaming: (streaming: boolean) => void;

  // Text streaming
  appendStreamContent: (chunk: string) => void;
  clearStreamContent: () => void;

  // Thinking streaming
  startThinking: () => void;
  appendThinkingContent: (chunk: string) => void;
  finishThinking: (durationMs: number) => void;

  // Citations
  addCitation: (citation: Citation) => void;

  // Finalize
  finalizeStream: (id: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streaming: { ...EMPTY_STREAMING },
  streamingContent: "",

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setStreaming: (isStreaming) => set({ isStreaming }),

  appendStreamContent: (chunk) =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        content: state.streaming.content + chunk,
        activeBlock: "text",
      },
      streamingContent: state.streamingContent + chunk,
    })),

  clearStreamContent: () =>
    set({ streaming: { ...EMPTY_STREAMING }, streamingContent: "" }),

  startThinking: () =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        activeBlock: "thinking",
        thinkingStartedAt: Date.now(),
      },
    })),

  appendThinkingContent: (chunk) =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        thinkingContent: state.streaming.thinkingContent + chunk,
      },
    })),

  finishThinking: (durationMs) =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        activeBlock: null,
        thinkingStartedAt: null,
      },
    })),

  addCitation: (citation) =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        citations: [...state.streaming.citations, citation],
      },
    })),

  finalizeStream: (id) => {
    const { streaming } = get();
    if (streaming.content || streaming.thinkingContent) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id,
            role: "assistant" as const,
            content: streaming.content,
            createdAt: new Date().toISOString(),
            thinkingContent: streaming.thinkingContent || undefined,
            thinkingDurationMs: streaming.thinkingContent
              ? (state.streaming.thinkingStartedAt
                ? Date.now() - state.streaming.thinkingStartedAt
                : undefined)
              : undefined,
            citations: streaming.citations.length > 0
              ? streaming.citations
              : undefined,
          },
        ],
        streaming: { ...EMPTY_STREAMING },
        streamingContent: "",
        isStreaming: false,
      }));
    } else {
      set({ isStreaming: false, streaming: { ...EMPTY_STREAMING }, streamingContent: "" });
    }
  },

  reset: () =>
    set({
      messages: [],
      isStreaming: false,
      streaming: { ...EMPTY_STREAMING },
      streamingContent: "",
    }),
}));
