import { create } from "zustand";
import type { TimelineVisualCopy, TimelineLayerClip } from "@/types/editor";

type Updater<T> = T | ((prev: T) => T);

const MAX_HISTORY = 50;

type HistorySnapshot = {
  visualCopies: TimelineVisualCopy[];
  layers: TimelineLayerClip[];
};

interface TimelineState {
  visualCopies: TimelineVisualCopy[];
  layers: TimelineLayerClip[];
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  setVisualCopies: (updater: Updater<TimelineVisualCopy[]>, noHistory?: boolean) => void;
  setLayers: (updater: Updater<TimelineLayerClip[]>, noHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;
  restore: (snapshot: Partial<HistorySnapshot>) => void;
  clear: () => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  visualCopies: [],
  layers: [],
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  setVisualCopies: (updater, noHistory = false) =>
    set((state) => {
      const prev = state.visualCopies;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (noHistory) return { visualCopies: next };
      const snapshot: HistorySnapshot = { visualCopies: prev, layers: state.layers };
      const past = [...state.past, snapshot].slice(-MAX_HISTORY);
      return { visualCopies: next, past, future: [], canUndo: true, canRedo: false };
    }),

  setLayers: (updater, noHistory = false) =>
    set((state) => {
      const prev = state.layers;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (noHistory) return { layers: next };
      const snapshot: HistorySnapshot = { visualCopies: state.visualCopies, layers: prev };
      const past = [...state.past, snapshot].slice(-MAX_HISTORY);
      return { layers: next, past, future: [], canUndo: true, canRedo: false };
    }),

  undo: () =>
    set((state) => {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      const future = [{ visualCopies: state.visualCopies, layers: state.layers }, ...state.future];
      const past = state.past.slice(0, -1);
      return {
        visualCopies: previous.visualCopies,
        layers: previous.layers,
        past,
        future,
        canUndo: past.length > 0,
        canRedo: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.future.length) return state;
      const next = state.future[0];
      const past = [...state.past, { visualCopies: state.visualCopies, layers: state.layers }];
      const future = state.future.slice(1);
      return {
        visualCopies: next.visualCopies,
        layers: next.layers,
        past,
        future,
        canUndo: true,
        canRedo: future.length > 0,
      };
    }),

  restore: (snapshot) =>
    set((state) => ({
      visualCopies: snapshot.visualCopies ?? state.visualCopies,
      layers: snapshot.layers ?? state.layers,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    })),

  clear: () =>
    set({ visualCopies: [], layers: [], past: [], future: [], canUndo: false, canRedo: false }),
}));
