interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function gDriveGetEmail(token: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google: ${res.status}`);
  const data = (await res.json()) as { email?: string };
  return data.email ?? "";
}

export async function gDriveFindOrCreateFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string> {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!searchRes.ok) {
    const errData = (await searchRes.json()) as { error?: { message?: string } };
    throw new Error(errData.error?.message ?? `Drive busca pasta: ${searchRes.status}`);
  }
  const searchData = (await searchRes.json()) as { files?: { id: string }[] };
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  if (!createRes.ok) {
    const errData = (await createRes.json()) as { error?: { message?: string } };
    throw new Error(errData.error?.message ?? `Drive criar pasta: ${createRes.status}`);
  }
  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

export async function gDriveListFolders(token: string, parentId: string): Promise<DriveFile[]> {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive listar pastas: ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function gDriveListFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and name contains '.v4' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive listar arquivos: ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function gDriveSaveJson(
  token: string,
  folderId: string,
  fileName: string,
  content: string,
  existingId?: string,
): Promise<string> {
  const blob = new Blob([content], { type: "application/json" });
  if (existingId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: blob,
      },
    );
    if (!res.ok) {
      const errData = (await res.json()) as { error?: { message?: string } };
      throw new Error(errData.error?.message ?? `Drive atualizar: ${res.status}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }));
  form.append("file", blob);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  if (!res.ok) {
    const errData = (await res.json()) as { error?: { message?: string } };
    throw new Error(errData.error?.message ?? `Drive salvar: ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function gDriveLoadJson(token: string, fileId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await res.text();
}
