export type ChatMode = 'normal' | 'rag';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  answer: string;
  sources: { content: string; distance: number }[];
}
