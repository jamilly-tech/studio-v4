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
  const [credentialsOk, setCredentialsOk] = useState<boolean | null>(null);

  useEffect(() => {
    window.studioV4?.googleAuthConfigured?.().then((r) => setCredentialsOk(r.configured)).catch(() => setCredentialsOk(false));
  }, []);
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
    } catch (err) {
      setFiles([]);
      setError(err instanceof Error ? err.message : "Falha ao listar arquivos do Drive");
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

      {credentialsOk === false && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 overflow-hidden">
          <div className="bg-amber-500/15 px-3 py-2 flex items-center gap-2">
            <div className="size-4 rounded-full bg-amber-400/20 grid place-items-center shrink-0">
              <span className="text-[9px] font-black text-amber-400">!</span>
            </div>
            <p className="text-[10px] font-bold text-amber-400">Configure o Google Drive em 5 passos</p>
          </div>

          <div className="flex flex-col divide-y divide-amber-500/10">
            {[
              {
                n: 1,
                title: "Abra o Google Cloud Console",
                desc: "Acesse console.cloud.google.com e faça login com sua conta Google.",
                tag: "console.cloud.google.com",
              },
              {
                n: 2,
                title: "Crie um projeto",
                desc: 'Clique em "Selecionar projeto" → "Novo projeto". Dê qualquer nome, ex: Studio V4.',
              },
              {
                n: 3,
                title: "Ative a API do Drive",
                desc: 'Menu lateral → "APIs e serviços" → "Biblioteca" → busque "Google Drive API" → clique em Ativar.',
              },
              {
                n: 4,
                title: "Crie credenciais OAuth 2.0",
                desc: '"APIs e serviços" → "Credenciais" → "+ Criar credenciais" → "ID do cliente OAuth". Tipo: App para computador. Copie o Client ID e o Client Secret.',
              },
              {
                n: 5,
                title: "Preencha o arquivo .env",
                desc: "Na pasta do Studio V4, abra o arquivo .env e adicione:",
                code: "GOOGLE_CLIENT_ID=cole_aqui\nGOOGLE_CLIENT_SECRET=cole_aqui",
              },
            ].map(({ n, title, desc, tag, code }) => (
              <div key={n} className="px-3 py-2 flex gap-2.5">
                <div className="mt-0.5 size-4 rounded-full bg-amber-400/20 grid place-items-center shrink-0">
                  <span className="text-[8px] font-black text-amber-400">{n}</span>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <p className="text-[10px] font-semibold text-amber-300">{title}</p>
                  <p className="text-[9px] text-amber-200/60 leading-relaxed">{desc}</p>
                  {tag && (
                    <span className="mt-0.5 inline-flex text-[8px] font-mono text-amber-400/70 bg-black/20 rounded px-1.5 py-0.5 w-fit">{tag}</span>
                  )}
                  {code && (
                    <code className="mt-1 block rounded bg-black/30 px-2 py-1.5 text-[8px] text-amber-200/80 font-mono whitespace-pre leading-relaxed">{code}</code>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="px-3 py-2 bg-black/20 border-t border-amber-500/10">
            <p className="text-[8px] text-amber-300/50 leading-relaxed">
              Depois de salvar o .env, reinicie o Studio V4. O botão de conectar ficara disponivel.
            </p>
          </div>
        </div>
      )}

      {!connected ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={loading || credentialsOk === false}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
