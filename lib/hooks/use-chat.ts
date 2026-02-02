"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

// Chat message type
export interface ChatMessage {
  id: string;
  content: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  createdAt: string;
}

// WebSocket message type
const messageChat = 2;

// Global connection manager - ensure a single chat connection per project
const globalChatConnections = new Map<string, {
  ws: WebSocket;
  subscribers: Set<(msg: ChatMessage) => void>;
  refCount: number;
}>();

interface UseChatOptions {
  projectId: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  sendMessage: (content: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export function useChat({ projectId }: UseChatOptions): UseChatReturn {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const userIdRef = useRef<string | undefined>(undefined);
  // Keep a ref to the current connection for sendMessage
  const connectionRef = useRef<{
    ws: WebSocket;
    subscribers: Set<(msg: ChatMessage) => void>;
    refCount: number;
  } | null>(null);

  // Store userId in a ref for onmessage callback
  userIdRef.current = session?.user?.id;

  // Load historical messages
  const loadMessages = useCallback(async (cursor?: string) => {
    try {
      setIsLoading(true);
      const url = cursor
        ? `/api/projects/${projectId}/chat?cursor=${cursor}`
        : `/api/projects/${projectId}/chat`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load messages");

      const data = await response.json();

      if (cursor) {
        // Load more: prepend (because API returns descending order)
        setMessages((prev) => [...data.messages.reverse(), ...prev]);
      } else {
        // Initial load: reverse so newest messages are at the bottom
        setMessages(data.messages.reverse());
      }

      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (error) {
      console.error("Failed to load chat messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Load more
  const loadMore = useCallback(async () => {
    if (nextCursor && !isLoading) {
      await loadMessages(nextCursor);
    }
  }, [nextCursor, isLoading, loadMessages]);

  // Get or create global WebSocket connection
  const getOrCreateConnection = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";
    const roomName = `chat-${projectId}`;

    // Check for existing connection (including CONNECTING)
    let existingConnection = globalChatConnections.get(projectId);

    if (existingConnection && (existingConnection.ws.readyState === WebSocket.OPEN || existingConnection.ws.readyState === WebSocket.CONNECTING)) {
      return existingConnection;
    }

    // If connection is closing/closed, clean it up
    if (existingConnection) {
      globalChatConnections.delete(projectId);
    }

    // Create new connection
    const ws = new WebSocket(`${wsUrl}/${roomName}`);
    ws.binaryType = "arraybuffer";

    const connection = {
      ws,
      subscribers: new Set<(msg: ChatMessage) => void>(),
      refCount: 0,
    };

    globalChatConnections.set(projectId, connection);

    ws.onopen = () => {
      console.log("[Chat] Global WebSocket connected to", roomName);
    };

    ws.onmessage = (event) => {
      try {
        const data = new Uint8Array(event.data as ArrayBuffer);
        const decoder = decoding.createDecoder(data);
        const messageType = decoding.readVarUint(decoder);

        if (messageType === messageChat) {
          const jsonStr = decoding.readVarString(decoder);
          const chatData = JSON.parse(jsonStr);

          const newMessage: ChatMessage = {
            id: chatData.id,
            content: chatData.content,
            user: {
              id: chatData.userId,
              name: chatData.userName,
              email: null,
              image: chatData.userImage || null,
            },
            createdAt: new Date(chatData.timestamp).toISOString(),
          };

          // Use subscribers on the current connection object directly (avoid Map lookup)
          // to prevent projectId mismatch issues caused by stale closures.
          console.log("[Chat] Received message, notifying", connection.subscribers.size, "subscribers");
          connection.subscribers.forEach(callback => callback(newMessage));
        }
      } catch (error) {
        // Ignore non-chat messages
      }
    };

    ws.onclose = () => {
      console.log("[Chat] Global WebSocket disconnected");
      // Delete only if the Map still points to this connection
      if (globalChatConnections.get(projectId) === connection) {
      globalChatConnections.delete(projectId);
      }
    };

    ws.onerror = (error) => {
      console.error("[Chat] WebSocket error:", error);
    };

    return connection;
  }, [projectId]);

  // Send message
  const sendMessage = useCallback(async (content: string) => {
    if (!session?.user?.id || !content.trim()) return;

    setIsSending(true);
    try {
      // Save message via API
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const data = await response.json();

      // Add to local list (dedupe by ID)
      setMessages((prev) => {
        if (prev.some(msg => msg.id === data.message.id)) {
          return prev;
        }
        return [...prev, data.message];
      });

      // Broadcast to other users via WebSocket
      // Use connectionRef to ensure we use the correct connection
      const connection = connectionRef.current;
      if (connection && connection.ws.readyState === WebSocket.OPEN) {
        const chatData = {
          id: data.message.id,
          content: data.message.content,
          userId: session.user.id,
          userName: session.user.name || session.user.email,
          userImage: session.user.image,
          timestamp: Date.now(),
        };

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageChat);
        encoding.writeVarString(encoder, JSON.stringify(chatData));
        connection.ws.send(encoding.toUint8Array(encoder));
        console.log("[Chat] Sent message via WebSocket");
      } else {
        console.warn("[Chat] WebSocket not ready, message only saved to DB");
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      throw error;
    } finally {
      setIsSending(false);
    }
  }, [projectId, session?.user]);

  // Keep message handler in a ref to ensure stable reference
  const handleMessageRef = useRef<(msg: ChatMessage) => void>(() => {});
  handleMessageRef.current = (newMessage: ChatMessage) => {
    // Ignore messages sent by self
    if (newMessage.user.id === userIdRef.current) {
      return;
    }

    setMessages((prev) => {
      // Dedupe by ID
      if (prev.some(msg => msg.id === newMessage.id)) {
        return prev;
      }
      return [...prev, newMessage];
    });
  };

  // Init: load messages
  useEffect(() => {
    loadMessages();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket connection lifecycle
  useEffect(() => {
    if (!session?.user?.id) return;

    const connection = getOrCreateConnection();
    connection.refCount++;

    // Store in ref for sendMessage
    connectionRef.current = connection;

    // Create a stable callback
    const messageHandler = (msg: ChatMessage) => {
      handleMessageRef.current?.(msg);
    };

    connection.subscribers.add(messageHandler);
    console.log("[Chat] Subscribed, total subscribers:", connection.subscribers.size);

    return () => {
      connection.subscribers.delete(messageHandler);
      connection.refCount--;
      console.log("[Chat] Unsubscribed, remaining:", connection.subscribers.size, "refCount:", connection.refCount);

      // Clear ref
      if (connectionRef.current === connection) {
        connectionRef.current = null;
      }

      // Close connection when there are no subscribers left
      if (connection.refCount <= 0) {
        connection.ws.close();
        // Delete only if the Map still points to this connection
        if (globalChatConnections.get(projectId) === connection) {
        globalChatConnections.delete(projectId);
        }
      }
    };
  }, [projectId, session?.user?.id, getOrCreateConnection]);

  return {
    messages,
    isLoading,
    isSending,
    sendMessage,
    loadMore,
    hasMore,
  };
}
