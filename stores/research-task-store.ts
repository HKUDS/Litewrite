"use client";

import { create } from "zustand";

/**
 * Research Task Store
 * ===================
 *
 * Manages Deep Research background tasks, supporting:
 * - Running multiple research tasks concurrently
 * - Background SSE streaming reception
 * - Progress tracking
 * - Preserving state when switching tasks
 */

// ==================== Type definitions ====================

export interface ProcessStep {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;  // Store event data for formatted display
}

export interface ResearchTask {
  id: string;
  projectId: string;
  userId: string;
  query: string;
  status: 'running' | 'completed' | 'error';
  progress: number;           // 0-1
  totalSections: number;      // Derived from OUTLINE_DONE
  completedSections: number;  // +1 per SECTION_DONE
  reportContent: string;      // Accumulated report content
  bibtex: string;
  references: string;
  processSteps: ProcessStep[];
  error?: string;
  createdAt: number;
}

interface ResearchTaskStore {
  // State
  tasks: Record<string, ResearchTask>;
  abortControllers: Record<string, AbortController>;

  // Actions
  startTask: (projectId: string, userId: string, query: string) => string;
  updateTaskFromEvent: (taskId: string, event: ResearchEvent) => void;
  saveTaskToServer: (taskId: string) => Promise<void>;
  getTask: (taskId: string) => ResearchTask | undefined;
  getRunningTasks: () => ResearchTask[];
  getAllTasks: () => ResearchTask[];
  abortTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
}

interface ResearchEvent {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

// ==================== Event message formatting ====================

function formatEventMessage(event: ResearchEvent): string {
  const { type, message, data } = event;

  switch (type) {
    case "progress":
      return message;

    case "iteration":
      return `Round ${data?.iteration}: ${message}`;

    case "search_start":
      return `Searching: ${(data?.query as string) || message}`;

    case "search_result": {
      const arxiv = (data?.arxiv_count as number) || 0;
      const web = (data?.web_count as number) || 0;
      return `Found ${arxiv} papers, ${web} web pages`;
    }

    case "analysis":
      return message;

    case "outline_start":
      return "Planning report structure...";

    case "outline_done": {
      const sections = ((data?.outline as { sections?: unknown[] })?.sections?.length) || 0;
      return `Outline ready: ${sections} sections`;
    }

    case "section_start":
      return `Writing: ${(data?.title as string) || message}`;

    case "section_done":
      return `Completed: ${(data?.title as string) || message}`;

    case "report_start":
      return "Generating report...";

    case "report_done":
      return "Report generated";

    case "done":
      return "Research completed";

    case "error":
      return `Error: ${message}`;

    default:
      return message || type;
  }
}

// ==================== Progress calculation ====================

const SEARCH_PROGRESS = 0.3;  // Search completion accounts for 30%
const WRITING_PROGRESS = 0.7; // Writing accounts for 70%

function calculateProgress(
  completedSections: number,
  totalSections: number,
  searchComplete: boolean
): number {
  if (!searchComplete) {
    return 0;
  }
  if (totalSections === 0) {
    return SEARCH_PROGRESS;
  }
  const writingProgress = (completedSections / totalSections) * WRITING_PROGRESS;
  return Math.min(SEARCH_PROGRESS + writingProgress, 1);
}

// ==================== Task ID generation ====================

function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `research_${timestamp}_${random}`;
}

// ==================== Batch buffer ====================

// Used to batch report_chunk events to reduce state update frequency
const chunkBuffers: Record<string, string> = {};
const flushTimers: Record<string, NodeJS.Timeout> = {};
const CHUNK_FLUSH_INTERVAL = 100; // Merge chunks every 100ms

function flushChunkBuffer(
  taskId: string,
  set: (fn: (state: ResearchTaskStore) => ResearchTaskStore) => void
) {
  const bufferedContent = chunkBuffers[taskId];
  if (!bufferedContent) return;

  // Clear buffer
  delete chunkBuffers[taskId];
  delete flushTimers[taskId];

  // Batch update state
  set((state) => {
    const task = state.tasks[taskId];
    if (!task) return state;

    return {
      ...state,
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          reportContent: task.reportContent + bufferedContent,
        },
      },
    };
  });
}

// ==================== Store ====================

export const useResearchTaskStore = create<ResearchTaskStore>((set, get) => ({
  tasks: {},
  abortControllers: {},

  startTask: (projectId: string, userId: string, query: string) => {
    const taskId = generateTaskId();
    const abortController = new AbortController();

    const newTask: ResearchTask = {
      id: taskId,
      projectId,
      userId,
      query,
      status: 'running',
      progress: 0,
      totalSections: 0,
      completedSections: 0,
      reportContent: '',
      bibtex: '',
      references: '',
      processSteps: [],
      createdAt: Date.now(),
    };

    set((state) => ({
      tasks: { ...state.tasks, [taskId]: newTask },
      abortControllers: { ...state.abortControllers, [taskId]: abortController },
    }));

    // Start background fetch
    startResearchFetch(taskId, query, abortController.signal, get, set);

    return taskId;
  },

  // Save task to server
  saveTaskToServer: async (taskId: string) => {
    const task = get().tasks[taskId];
    if (!task) return;

    try {
      const response = await fetch('/api/deep-research/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: task.projectId,
          query: task.query,
          report: task.reportContent,
          bibtex: task.bibtex,
          references: task.references,
          processSteps: task.processSteps.map(step => ({
            id: step.id,
            type: step.type,
            message: step.message,
            timestamp: step.timestamp instanceof Date ? step.timestamp.toISOString() : step.timestamp,
            data: step.data,
          })),
          reportId: task.id,  // Use taskId as reportId
        }),
      });

      if (!response.ok) {
        console.error('[ResearchTaskStore] Save failed:', response.status);
      }
    } catch (error) {
      console.error('[ResearchTaskStore] Save error:', error);
    }
  },

  updateTaskFromEvent: (taskId: string, event: ResearchEvent) => {
    // Track whether we need to save
    let shouldSave = false;
    let updatedTaskForSave: ResearchTask | null = null;

    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return state;

      const updatedTask = { ...task };

      // Add a step - format message by event type
      const formattedMessage = formatEventMessage(event);
      const step: ProcessStep = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: event.type,
        message: formattedMessage,
        timestamp: new Date(),
        data: event.data,
      };

      // Only add meaningful steps (exclude chunk events)
      if (event.type !== 'report_chunk' && event.type !== 'section_chunk') {
        updatedTask.processSteps = [...updatedTask.processSteps, step];
        shouldSave = true; // Save when a new step is added
      }

      // Update state based on event type
      switch (event.type) {
        case 'search_result':
          // Search finished: progress to 30%
          updatedTask.progress = SEARCH_PROGRESS;
          shouldSave = true;
          break;

        case 'outline_done':
          // Outline finished: record total section count
          if (event.data?.outline) {
            const outline = event.data.outline as { sections?: unknown[] };
            // sections + abstract + conclusion
            updatedTask.totalSections = (outline.sections?.length || 0) + 2;
          }
          shouldSave = true;
          break;

        case 'section_done':
          // Section completed
          updatedTask.completedSections += 1;
          updatedTask.progress = calculateProgress(
            updatedTask.completedSections,
            updatedTask.totalSections,
            true
          );
          shouldSave = true;
          break;

        case 'report_chunk':
        case 'section_chunk':
          // Report content chunk - batch to reduce update frequency
          if (event.data?.chunk) {
            const chunk = event.data.chunk as string;
            // Append to buffer
            if (!chunkBuffers[taskId]) {
              chunkBuffers[taskId] = '';
            }
            chunkBuffers[taskId] += chunk;

            // Schedule a delayed flush
            if (!flushTimers[taskId]) {
              flushTimers[taskId] = setTimeout(() => {
                flushChunkBuffer(taskId, set as any);
              }, CHUNK_FLUSH_INTERVAL);
            }

            // Don't update reportContent here; flushChunkBuffer will batch-update it
            return state; // Return early without updating state
          }
          // Chunk events don't trigger saves (too frequent)
          break;

        case 'done':
          // Done - flush any remaining chunk buffer first
          if (chunkBuffers[taskId]) {
            updatedTask.reportContent += chunkBuffers[taskId];
            delete chunkBuffers[taskId];
            if (flushTimers[taskId]) {
              clearTimeout(flushTimers[taskId]);
              delete flushTimers[taskId];
            }
          }
          updatedTask.status = 'completed';
          updatedTask.progress = 1;
          if (event.data) {
            if (event.data.bibtex) {
              updatedTask.bibtex = event.data.bibtex as string;
            }
            if (event.data.references_markdown) {
              updatedTask.references = event.data.references_markdown as string;
            }
          }
          shouldSave = true; // Must save on completion
          break;

        case 'error':
          // Error - clean up buffer
          if (chunkBuffers[taskId]) {
            updatedTask.reportContent += chunkBuffers[taskId];
            delete chunkBuffers[taskId];
            if (flushTimers[taskId]) {
              clearTimeout(flushTimers[taskId]);
              delete flushTimers[taskId];
            }
          }
          updatedTask.status = 'error';
          updatedTask.error = event.message;
          shouldSave = true;
          break;
      }

      updatedTaskForSave = updatedTask;

      return {
        ...state,
        tasks: { ...state.tasks, [taskId]: updatedTask },
      };
    });

    // Save asynchronously to server
    if (shouldSave) {
      // Use setTimeout to ensure this runs after the state update
      setTimeout(() => {
        get().saveTaskToServer(taskId);
      }, 0);
    }
  },

  getTask: (taskId: string) => {
    return get().tasks[taskId];
  },

  getRunningTasks: () => {
    return Object.values(get().tasks).filter((t) => t.status === 'running');
  },

  getAllTasks: () => {
    return Object.values(get().tasks).sort((a, b) => b.createdAt - a.createdAt);
  },

  abortTask: (taskId: string) => {
    const controller = get().abortControllers[taskId];
    if (controller) {
      controller.abort();
    }
    set((state) => {
      const task = state.tasks[taskId];
      if (task && task.status === 'running') {
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: { ...task, status: 'error', error: 'Aborted by user' },
          },
        };
      }
      return state;
    });
  },

  removeTask: (taskId: string) => {
    const controller = get().abortControllers[taskId];
    if (controller) {
      controller.abort();
    }
    set((state) => {
      const { [taskId]: _, ...remainingTasks } = state.tasks;
      const { [taskId]: __, ...remainingControllers } = state.abortControllers;
      return {
        tasks: remainingTasks,
        abortControllers: remainingControllers,
      };
    });
  },

  clearCompletedTasks: () => {
    set((state) => {
      const activeTasks: Record<string, ResearchTask> = {};
      const activeControllers: Record<string, AbortController> = {};

      Object.entries(state.tasks).forEach(([id, task]) => {
        if (task.status === 'running') {
          activeTasks[id] = task;
          if (state.abortControllers[id]) {
            activeControllers[id] = state.abortControllers[id];
          }
        }
      });

      return {
        tasks: activeTasks,
        abortControllers: activeControllers,
      };
    });
  },
}));

// ==================== Background fetch ====================

async function startResearchFetch(
  taskId: string,
  query: string,
  signal: AbortSignal,
  get: () => ResearchTaskStore,
  set: (fn: (state: ResearchTaskStore) => ResearchTaskStore) => void
) {
  try {
    const response = await fetch('/api/deep-research/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        arxiv_papers: 10,
        web_pages: 10,
        structured: true,
        max_iterations: 3,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        // SSE format: event: {type}\ndata: {json}\n\n
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEventType) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const data = JSON.parse(jsonStr);
              const event: ResearchEvent = {
                type: currentEventType,
                message: data.message || '',
                data: data.data || data,
              };
              get().updateTaskFromEvent(taskId, event);
            } catch {
              // Ignore parse errors
            }
          }
          currentEventType = null;
        }
      }
    }

    // Process remaining buffer
    const remainingLines = buffer.split('\n');
    for (const line of remainingLines) {
      if (line.startsWith('event: ')) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEventType) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const data = JSON.parse(jsonStr);
            const event: ResearchEvent = {
              type: currentEventType,
              message: data.message || '',
              data: data.data || data,
            };
            get().updateTaskFromEvent(taskId, event);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      // User cancelled
      return;
    }

    // Update error state
    set((state) => {
      const task = state.tasks[taskId];
      if (task) {
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              status: 'error',
              error: (error as Error).message || 'Unknown error',
            },
          },
        };
      }
      return state;
    });
  }
}

export default useResearchTaskStore;
