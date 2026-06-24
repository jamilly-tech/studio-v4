import { useCallback, useEffect, useState } from "react";
import { Cloud, FolderOpen, Save, Loader2, LogOut, RefreshCw, Check } from "lucide-react";
import type { GoogleDriveProfile } from "@/types/editor";
import {
  gDriveGetEmail, gDriveFindOrCreateFolder,
  gDriveListFolders, gDriveListFiles,
  gDriveSaveJson, gDriveLoadJson,
} from "@/utils/drive";

const TOKEN_KEY = "v4-studio-google-token";
const REFRESH_KEY = "v4-studio-google-refresh";
const PROFILE_KEY = "v4-studio-google-profile";
const FOLDER_KEY = "v4-studio-google-folder-id";
const DEFAULT_FOLDER = "Studio V4";

interface DrivePanelProps {
  onConnect: (profile: GoogleDriveProfile) => void;
  onDisconnect: () => void;
  onLoadProject: (snapshot: unknown) => void;
  getProjectSnapshot: () => unknown;
  projectName: string;
  connected: boolean;
  profile: GoogleDriveProfile | null;
}

export function DrivePanel({
  onConnect, onDisconnect, onLoadProject,
  getProjectSnapshot, projectName, connected, profile,
}: DrivePanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<{ id: string; name: string; modifiedTime: string }[]>([]);
  const [folderId, setFolderId] = useState<string | null>(() => {
    try { return localStorage.getItem(FOLDER_KEY); } catch { return null; }
  });

  function getToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  async function handleConnect() {
    if (!window.studioV4?.googleAuth) {
      setError("Google Auth so funciona no app desktop");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.studioV4.googleAuth();
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      if (result.refreshToken) localStorage.setItem(REFRESH_KEY, result.refreshToken);

      const email = await gDriveGetEmail(result.accessToken);
      const profileData: GoogleDriveProfile = { name: email.split("@")[0], email };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));

      const folder = await gDriveFindOrCreateFolder(result.accessToken, "root", DEFAULT_FOLDER);
      setFolderId(folder);
      localStorage.setItem(FOLDER_KEY, folder);

      onConnect(profileData);
      await loadFiles(result.accessToken, folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setLoading(false);
    }
  }

  function handleDisconnect() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(FOLDER_KEY);
    setFiles([]);
    setFolderId(null);
    onDisconnect();
  }

  async function loadFiles(token?: string, folder?: string) {
    const t = token || getToken();
    const f = folder || folderId;
    if (!t || !f) return;

    try {
      const list = await gDriveListFiles(t, f);
      setFiles(list);
    } catch {
      setFiles([]);
    }
  }

  async function handleSave() {
    const token = getToken();
    if (!token || !folderId) { setError("Conecte ao Drive primeiro"); return; }

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const snapshot = getProjectSnapshot();
      const fileName = `${projectName}.v4`;
      const existing = files.find((f) => f.name === fileName);
      await gDriveSaveJson(token, folderId, fileName, JSON.stringify(snapshot), existing?.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await loadFiles(token, folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoad(fileId: string) {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const raw = await gDriveLoadJson(token, fileId);
      const snapshot = JSON.parse(raw);
      onLoadProject(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (connected && getToken() && folderId) loadFiles();
  }, [connected, folderId]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-black flex items-center gap-1.5">
          <Cloud className="size-3.5 text-primary" />
          Google Drive
        </h3>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Salve e abra projetos no Drive. Acesse de qualquer computador apos login.
        </p>
      </div>

      {!connected ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
        >
          {loading ? (
            <><Loader2 className="size-4 animate-spin" /> Conectando...</>
          ) : (
            <><Cloud className="size-4" /> Conectar Google Drive</>
          )}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2.5 rounded-lg bg-card border border-border p-2.5">
            <div className="grid size-8 place-items-center rounded-full bg-green-500/20 text-green-500">
              <Check className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold truncate">{profile?.name || "Conectado"}</p>
              <p className="text-[9px] text-muted-foreground truncate">{profile?.email}</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="grid size-7 place-items-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Desconectar"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-white hover:bg-primary/90 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
              {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar no Drive"}
            </button>
            <button
              type="button"
              onClick={() => loadFiles()}
              className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-card"
              title="Atualizar lista"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>

          {files.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                Projetos no Drive
              </p>
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border">
                {files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handleLoad(file.id)}
                    className="flex w-full items-center gap-2 border-b border-border/50 px-2.5 py-2 text-left last:border-0 hover:bg-card/50 transition"
                  >
                    <FolderOpen className="size-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold">{file.name}</p>
                      <p className="text-[8px] text-muted-foreground">
                        {new Date(file.modifiedTime).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
          <p className="text-[10px] text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
