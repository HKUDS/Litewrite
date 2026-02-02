"use client";

import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { getUserColorById, generateUserColor, generateUserName } from "@/lib/utils";
import type { CollaboratorInfo } from "@/components/editor/collaborative-editor";

interface UseProjectCollaboratorsOptions {
  projectId: string;
  userId?: string;
  userName?: string;
  userImage?: string;
  wsUrl?: string;
}

/**
 * Project-level collaborators hook.
 * Tracks all users connected to the same project (not per-file).
 *
 * Note: the WebSocket connection is created based only on projectId.
 * When user info changes, we only update awareness and do not reconnect.
 */
export function useProjectCollaborators({
  projectId,
  userId,
  userName,
  userImage,
  wsUrl,
}: UseProjectCollaboratorsOptions) {
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  // Keep user info in a ref to avoid reconnecting on every change
  const userInfoRef = useRef({ userId, userName, userImage });
  userInfoRef.current = { userId, userName, userImage };

  // Helper to set user awareness
  const setUserAwareness = (provider: WebsocketProvider) => {
    const { userId, userName, userImage } = userInfoRef.current;
    const userColor = userId ? getUserColorById(userId) : generateUserColor();
    const displayName = userName || generateUserName();

    provider.awareness.setLocalStateField("user", {
      name: displayName,
      color: userColor,
      colorLight: userColor + "33",
      id: userId,
      image: userImage,
    });
  };

  // Create/destroy connection only when projectId changes
  useEffect(() => {
    if (!projectId) return;

    const effectiveWsUrl = wsUrl || process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";

    // Create Yjs doc (for awareness only)
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Project-level room name (no fileId)
    const roomName = `project-${projectId}`;
    const provider = new WebsocketProvider(effectiveWsUrl, roomName, ydoc);
    providerRef.current = provider;

    // Set user info immediately
    setUserAwareness(provider);

    // Listen to connection status
    provider.on("status", ({ status }: { status: string }) => {
      setIsConnected(status === "connected");
      // Set user info again after connected to ensure it is synced
      if (status === "connected") {
        setUserAwareness(provider);
      }
    });

    // Listen to collaborator changes
    const updateCollaborators = () => {
      const states = provider.awareness.getStates();
      const users: CollaboratorInfo[] = [];
      states.forEach((state) => {
        if (state.user) {
          users.push({
            name: state.user.name,
            color: state.user.color,
            id: state.user.id,
            image: state.user.image,
          });
        }
      });
      setCollaborators(users);
    };

    provider.awareness.on("change", updateCollaborators);
    updateCollaborators();

    // Cleanup
    return () => {
      provider.awareness.off("change", updateCollaborators);
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
      providerRef.current = null;
      ydocRef.current = null;
    };
  }, [projectId, wsUrl]); // Depend only on projectId and wsUrl

  // Update awareness when user info changes (without reconnecting)
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    setUserAwareness(provider);
  }, [userId, userName, userImage]);

  return {
    collaborators,
    isConnected,
  };
}
