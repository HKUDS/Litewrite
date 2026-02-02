"use client";

import { create } from "zustand";

/**
 * Vibe Writing Lock Store
 *
 * Manages the state of files being "vibe written" by AI.
 * When a user initiates an AI request that reads a file, that file gets locked
 * to prevent concurrent edits (both from the same user and other collaborators).
 */

export interface VibeLock {
  filePath: string;
  userId: string;
  userName: string;
  projectId: string;
  lockedAt: number;
}

interface VibeLockState {
  // Current locks (keyed by `${projectId}:${filePath}`)
  locks: Map<string, VibeLock>;

  // Actions
  setLock: (lock: VibeLock) => void;
  clearLock: (projectId: string, filePath: string) => void;
  clearAllLocksForProject: (projectId: string) => void;
  clearAllLocksForUser: (projectId: string, userId: string) => void;

  // Queries
  isFileLocked: (projectId: string, filePath: string) => boolean;
  getFileLock: (projectId: string, filePath: string) => VibeLock | null;
  getLocksForProject: (projectId: string) => VibeLock[];
}

function getLockKey(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

export const useVibeLockStore = create<VibeLockState>((set, get) => ({
  locks: new Map(),

  setLock: (lock) => {
    set((state) => {
      const newLocks = new Map(state.locks);
      newLocks.set(getLockKey(lock.projectId, lock.filePath), lock);
      return { locks: newLocks };
    });
  },

  clearLock: (projectId, filePath) => {
    set((state) => {
      const newLocks = new Map(state.locks);
      newLocks.delete(getLockKey(projectId, filePath));
      return { locks: newLocks };
    });
  },

  clearAllLocksForProject: (projectId) => {
    set((state) => {
      const newLocks = new Map(state.locks);
      for (const [key, lock] of newLocks) {
        if (lock.projectId === projectId) {
          newLocks.delete(key);
        }
      }
      return { locks: newLocks };
    });
  },

  clearAllLocksForUser: (projectId, userId) => {
    set((state) => {
      const newLocks = new Map(state.locks);
      for (const [key, lock] of newLocks) {
        if (lock.projectId === projectId && lock.userId === userId) {
          newLocks.delete(key);
        }
      }
      return { locks: newLocks };
    });
  },

  isFileLocked: (projectId, filePath) => {
    return get().locks.has(getLockKey(projectId, filePath));
  },

  getFileLock: (projectId, filePath) => {
    return get().locks.get(getLockKey(projectId, filePath)) || null;
  },

  getLocksForProject: (projectId) => {
    const locks: VibeLock[] = [];
    for (const lock of get().locks.values()) {
      if (lock.projectId === projectId) {
        locks.push(lock);
      }
    }
    return locks;
  },
}));
