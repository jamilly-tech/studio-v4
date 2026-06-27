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
            <span className="text-[9px] font-black text-amber-400">!</span>
            <p className="text-[10px] font-bold text-amber-400">Configuração necessária — 3 minutos</p>
          </div>
          <div className="px-3 py-2.5 flex flex-col gap-2">
            <p className="text-[9px] text-amber-200/70 leading-relaxed">
              <strong className="text-amber-300">1.</strong> Acesse <span className="font-mono text-amber-400/80 bg-black/20 rounded px-1">console.cloud.google.com</span> → crie um projeto → ative <strong className="text-amber-300">Google Drive API</strong>.
            </p>
            <p className="text-[9px] text-amber-200/70 leading-relaxed">
              <strong className="text-amber-300">2.</strong> Credenciais → "+ Criar" → <strong className="text-amber-300">ID do cliente OAuth</strong> → Tipo: <em>App para computador</em> → copie o Client ID e Secret.
            </p>
            <p className="text-[9px] text-amber-200/70 leading-relaxed">
              <strong className="text-amber-300">3.</strong> Na pasta do Studio V4, abra o arquivo <span className="font-mono text-amber-400/80 bg-black/20 rounded px-1">.env</span> e cole:
            </p>
            <code className="block rounded bg-black/30 px-2 py-1.5 text-[8px] text-amber-200/80 font-mono whitespace-pre leading-relaxed">GOOGLE_CLIENT_ID=cole_aqui{"\n"}GOOGLE_CLIENT_SECRET=cole_aqui</code>
            <p className="text-[8px] text-amber-300/50">Salve o .env e reinicie o Studio V4.</p>
          </div>
        </div>
      )}

      {/* ── Alternativa sem configuração ─────────────────────────────────── */}
      {credentialsOk === false && (
        <LocalBackupCard getProjectSnapshot={getProjectSnapshot} projectName={projectName} />
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

// ── Backup local — alternativa sem credenciais ─────────────────────────────
function LocalBackupCard({
  getProjectSnapshot,
  projectName,
}: {
  getProjectSnapshot: () => unknown;
  projectName: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const snapshot = getProjectSnapshot();
      const path = await window.studioV4?.saveProjectFile?.({ snapshot, defaultName: projectName });
      if (path) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } finally {
      setSaving(false);
    }
  }

  async function handleOpen() {
    setLoading(true);
    try {
      await window.studioV4?.openProjectFile?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
        <Save className="size-3 text-muted-foreground" />
        <p className="text-[10px] font-bold">Alternativa — Backup Local</p>
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Sem precisar configurar o Google Drive, salve o projeto como arquivo <strong className="text-foreground">.v4</strong> em qualquer pasta — incluindo pastas do <strong className="text-foreground">OneDrive</strong>, <strong className="text-foreground">Google Drive Desktop</strong> ou <strong className="text-foreground">Dropbox</strong> já instalados no PC. A sincronização acontece automaticamente pelo app de nuvem.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/90 px-3 py-2 text-[10px] font-bold text-white hover:bg-primary transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : saved ? <Check className="size-3" /> : <Save className="size-3" />}
            {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar .v4"}
          </button>
          <button
            type="button"
            onClick={handleOpen}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-semibold hover:bg-muted/30 transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <FolderOpen className="size-3" />}
            {loading ? "Abrindo..." : "Abrir .v4"}
          </button>
        </div>
        <p className="text-[8px] text-muted-foreground/50 leading-relaxed">
          Atalho: <kbd className="font-mono bg-muted/40 px-1 rounded">Ctrl+S</kbd> salva diretamente.
        </p>
      </div>
    </div>
  );
}
