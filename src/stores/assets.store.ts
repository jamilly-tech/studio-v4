import { create } from "zustand";
import type { ImportedAsset } from "@/types/editor";

type Updater<T> = T | ((prev: T) => T);

interface AssetsState {
  assets: ImportedAsset[];
  selectedAssetId: string | null;
  setAssets: (updater: Updater<ImportedAsset[]>) => void;
  addAssets: (newAssets: ImportedAsset[]) => void;
  updateAsset: (id: string, updates: Partial<ImportedAsset>) => void;
  removeAsset: (id: string) => void;
  setSelectedAssetId: (id: string | null) => void;
  clearAssets: () => void;
}

export const useAssetsStore = create<AssetsState>((set) => ({
  assets: [],
  selectedAssetId: null,

  setAssets: (updater) =>
    set((state) => ({
      assets: typeof updater === "function" ? updater(state.assets) : updater,
    })),

  addAssets: (newAssets) =>
    set((state) => ({ assets: [...newAssets, ...state.assets] })),

  updateAsset: (id, updates) =>
    set((state) => ({
      assets: state.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),

  removeAsset: (id) =>
    set((state) => ({ assets: state.assets.filter((a) => a.id !== id) })),

  setSelectedAssetId: (id) => set({ selectedAssetId: id }),

  clearAssets: () => set({ assets: [], selectedAssetId: null }),
}));
