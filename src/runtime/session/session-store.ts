import type { RuntimeMessage } from "../backend/types.js";

export type RuntimeSession = {
  id: string;
  messages: RuntimeMessage[];
};

export interface SessionStore {
  get(sessionId: string): RuntimeSession;
  replace(sessionId: string, messages: RuntimeMessage[]): RuntimeSession;
  append(sessionId: string, message: RuntimeMessage): RuntimeSession;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, RuntimeSession>();

  get(sessionId: string): RuntimeSession {
    return this.sessions.get(sessionId) ?? { id: sessionId, messages: [] };
  }

  replace(sessionId: string, messages: RuntimeMessage[]): RuntimeSession {
    const session: RuntimeSession = { id: sessionId, messages };
    this.sessions.set(sessionId, session);
    return session;
  }

  append(sessionId: string, message: RuntimeMessage): RuntimeSession {
    const existing = this.get(sessionId);
    const session: RuntimeSession = {
      id: sessionId,
      messages: [...existing.messages, message],
    };

    this.sessions.set(sessionId, session);
    return session;
  }
}
