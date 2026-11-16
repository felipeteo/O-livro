const DB_NAME = "nosso-livro";
const STORE_NAME = "memories";
const DB_VERSION = 1;
const COVER_INDEX = -1;
const MAX_PHOTO_SIZE = 40 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const MEMORY_ORDER_KEY = "nosso-livro-memory-order";
const LOGIN_USER = "b+f";
const LOGIN_PASSWORD = "2015";
const LOGIN_SESSION_KEY = "nosso-livro-authenticated";
const CLOUD_SESSION_KEY = "nosso-livro-supabase-session";
const supabaseConfig = window.BOOK_SUPABASE ?? {};
const supabaseUrl = String(supabaseConfig.url ?? "").replace(/\/+$/, "");
const supabaseAnonKey = String(supabaseConfig.anonKey ?? "");
const supabaseEditorEmail = String(supabaseConfig.editorEmail ?? "");
const cloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const appShell = document.querySelector("#app-shell");
const book = document.querySelector("#book");
const leftPage = document.querySelector("#left-page");
const rightPage = document.querySelector("#right-page");
const cover = document.createElement("button");
cover.type = "button";
cover.className = "cover-page";
cover.setAttribute("aria-label", "Abrir o livro");
cover.innerHTML = `
  <span class="cover-frame" aria-hidden="true"></span>
  <span class="cover-content">
    <span class="cover-flower" aria-hidden="true">✿</span>
    <span class="cover-kicker">AS NOSSAS MEMÓRIAS</span>
    <span class="cover-title">O nosso<br>livro</span>
    <span class="cover-subtitle">de amor e de vida</span>
    <span class="cover-rule" aria-hidden="true"></span>
  </span>
  <span class="cover-open-hint">ABRA PARA COMEÇAR&nbsp; →</span>`;
book.append(cover);

const pageTurn = document.querySelector("#page-turn");
const turnFront = pageTurn.querySelector(".turn-front");
const turnBack = pageTurn.querySelector(".turn-back");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const pageCounter = document.querySelector("#page-counter");
const dialog = document.querySelector("#memory-dialog");
const form = document.querySelector("#memory-form");
const photoInput = document.querySelector("#memory-photo");
const uploadLabel = document.querySelector("#upload-label");
const storageInfo = document.querySelector("#storage-info");
const formError = document.querySelector("#form-error");
const toast = document.querySelector("#toast");
const syncTools = document.querySelector("#sync-tools");
const syncStatus = document.querySelector("#sync-status");
const importLocalButton = document.querySelector("#import-local");
const exportLocalButton = document.querySelector("#export-local");
const orderTools = document.querySelector("#order-tools");
const memoryOrderList = document.querySelector("#memory-order-list");

let database;
let memories = [];
let currentIndex = COVER_INDEX;
let isTurning = false;
let toastTimer;
let preparedPhoto = "";
let photoPreparation = Promise.resolve(true);
let appStarted = false;
let isEditor = false;
let cloudSession;

try {
  cloudSession = JSON.parse(sessionStorage.getItem(CLOUD_SESSION_KEY) || "null");
  isEditor = cloudEnabled
    ? Boolean(cloudSession?.access_token)
    : sessionStorage.getItem(LOGIN_SESSION_KEY) === "true";
} catch (error) {
  console.warn("Não foi possível consultar a sessão de edição:", error);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        if (database === request.result) database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("Não foi possível abrir o armazenamento."));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("O livro está aberto em outra aba que bloqueia o armazenamento. Feche as outras abas do livro e atualize esta página."));
    };
  });
}

function readMemories() {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível carregar as lembranças."));
  });
}

function saveLocalMemory(memory) {
  return new Promise((resolve, reject) => {
    if (!database) {
      reject(new Error("O banco de dados não está disponível. Atualize a página para tentar novamente."));
      return;
    }
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(memory);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Não foi possível guardar a lembrança."));
    transaction.onabort = () => reject(transaction.error ?? new Error("O armazenamento foi interrompido."));
  });
}

function deleteLocalMemory(memoryId) {
  return new Promise((resolve, reject) => {
    if (!database) {
      reject(new Error("O banco de dados não está disponível. Atualize a página para tentar novamente."));
      return;
    }
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(memoryId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Não foi possível remover a lembrança."));
    transaction.onabort = () => reject(transaction.error ?? new Error("A remoção da lembrança foi interrompida."));
  });
}

function isConfiguredSupabase() {
  return cloudEnabled && !supabaseUrl.includes("SEU-PROJETO") && !supabaseAnonKey.includes("SUA_CHAVE");
}

function publicPhotoUrl(path) {
  return `${supabaseUrl}/storage/v1/object/public/book-photos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function getCloudSession() {
  if (!cloudSession?.access_token) throw new Error("Entre no modo de edição para continuar.");
  if (cloudSession.expires_at && Date.now() < (cloudSession.expires_at - 60) * 1000) {
    return cloudSession.access_token;
  }
  if (!cloudSession.refresh_token) {
    cloudSession = undefined;
    throw new Error("Sua sessão de edição expirou. Entre novamente.");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: cloudSession.refresh_token })
  });
  const result = await response.json();
  if (!response.ok) {
    cloudSession = undefined;
    sessionStorage.removeItem(CLOUD_SESSION_KEY);
    throw new Error(result.msg || result.message || "A sessão expirou. Entre novamente.");
  }
  cloudSession = {
    ...result,
    expires_at: Math.floor(Date.now() / 1000) + result.expires_in
  };
  sessionStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(cloudSession));
  return cloudSession.access_token;
}

async function supabaseRequest(path, options = {}) {
  if (!isConfiguredSupabase()) {
    throw new Error("O Supabase ainda não foi configurado. Preencha supabase-config.js e publique o site novamente.");
  }
  const accessToken = options.authenticated ? await getCloudSession() : supabaseAnonKey;
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    ...options.headers
  };
  if (options.body && !(options.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${supabaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body instanceof Blob ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const error = JSON.parse(body);
      message = error.message || error.msg || error.error_description || error.error || body;
    } catch {
      // Keep the response body as the diagnostic when the server does not return JSON.
    }
    throw new Error(`Supabase (${response.status}): ${message || response.statusText}`);
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function readCloudMemories() {
  const rows = await supabaseRequest("/rest/v1/memories?select=id,title,date,caption,text,photo_path&order=date.asc.nullslast,created_at.asc");
  return rows.map((row) => ({
    ...row,
    caption: row.caption ?? "",
    text: row.text ?? "",
    photo: row.photo_path ? publicPhotoUrl(row.photo_path) : ""
  }));
}

async function uploadCloudPhoto(memoryId, photo) {
  const blob = await (await fetch(photo)).blob();
  if (blob.type !== "image/webp") {
    throw new Error("A foto preparada não está no formato WebP esperado. Escolha-a novamente.");
  }
  if (blob.size > MAX_CLOUD_PHOTO_SIZE) {
    throw new Error("A foto otimizada ainda ultrapassa o limite online de 10 MB. Escolha uma imagem menor.");
  }
  const path = `${memoryId}.webp`;
  await supabaseRequest(`/storage/v1/object/book-photos/${encodeURIComponent(path)}`, {
    method: "POST",
    authenticated: true,
    headers: { "Content-Type": "image/webp", "x-upsert": "true" },
    body: blob
  });
  return path;
}

async function deleteCloudPhoto(path) {
  if (!path) return;
  await supabaseRequest("/storage/v1/object/book-photos", {
    method: "DELETE",
    authenticated: true,
    headers: { "Content-Type": "application/json" },
    body: { prefixes: [path] }
  });
}

async function deleteCloudMemory(memoryId) {
  await supabaseRequest(`/rest/v1/memories?id=eq.${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
    authenticated: true
  });
}

async function saveMemory(memory) {
  let photoPath = memory.photo_path || null;
  let uploadedPath = "";
  if (memory.photo?.startsWith("data:image/")) {
    uploadedPath = await uploadCloudPhoto(memory.id, memory.photo);
    photoPath = uploadedPath;
  } else if (!memory.photo) {
    photoPath = null;
  }

  if (cloudEnabled) {
    try {
      await supabaseRequest("/rest/v1/memories?on_conflict=id", {
        method: "POST",
        authenticated: true,
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          id: memory.id,
          title: memory.title,
          date: memory.date || null,
          caption: memory.caption ?? "",
          text: memory.text ?? "",
          photo_path: photoPath
        }
      });
    } catch (error) {
      if (uploadedPath) {
        try {
          await deleteCloudPhoto(uploadedPath);
        } catch (cleanupError) {
          console.error("Não foi possível limpar a foto após falha ao salvar a lembrança:", cleanupError);
        }
      }
      throw error;
    }
  }

  const savedMemory = {
    ...memory,
    photo_path: photoPath,
    photo: photoPath && memory.photo?.startsWith("data:image/")
      ? publicPhotoUrl(photoPath)
      : memory.photo
  };
  try {
    await saveLocalMemory({ ...memory, photo_path: photoPath });
  } catch (error) {
    if (!cloudEnabled) throw error;
    console.error("A lembrança foi sincronizada, mas não foi possível atualizar o cache local:", error);
  }
  return savedMemory;
}

function getBundledPhotoMemories(localOverrides = []) {
  const overridesById = new Map(localOverrides.map((memory) => [memory.id, memory]));
  return (window.BOOK_PHOTOS ?? []).map((photo) => {
    const id = photo.id || `project-photo-${photo.file}`;
    const bundledMemory = {
      id,
      title: photo.title,
      date: photo.date ?? "",
      caption: photo.caption ?? "",
      text: photo.text ?? "",
      file: photo.file,
      photo: new URL(`fotos/${encodeURIComponent(photo.file)}`, document.baseURI).href,
      bundled: true
    };
    return {
      ...bundledMemory,
      ...overridesById.get(id),
      ...(photo.showPhoto === false ? { photo: "" } : {}),
      file: photo.file,
      bundled: true
    };
  }).filter((memory) => !memory.deleted && Boolean(memory.photo));
}

async function signInEditor(username, password) {
  if (username !== LOGIN_USER) {
    throw new Error("Login incorreto.");
  }
  if (!cloudEnabled) {
    if (password !== "2015") throw new Error("Login ou senha incorretos. Tente novamente.");
    return null;
  }
  const result = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
    body: { email: supabaseEditorEmail, password }
  });
  cloudSession = {
    ...result,
    expires_at: Math.floor(Date.now() / 1000) + result.expires_in
  };
  sessionStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(cloudSession));
  return cloudSession;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
    return { available: Math.max(0, quota - usage) };
  } catch (error) {
    console.warn("Não foi possível consultar o espaço de armazenamento:", error);
    return null;
  }
}

async function updateStorageInfo(photoStorageBytes = 0) {
  const estimate = await getStorageEstimate();
  storageInfo.classList.remove("is-low");
  if (!estimate) {
    storageInfo.textContent = photoStorageBytes
      ? `Foto otimizada (${formatBytes(photoStorageBytes)} estimados no armazenamento). Não foi possível consultar o espaço disponível neste navegador.`
      : "Não foi possível consultar o espaço disponível neste navegador.";
    return estimate;
  }

  const requiredBytes = photoStorageBytes + 64 * 1024;
  const availableText = `Espaço estimado disponível: ${formatBytes(estimate.available)}.`;
  if (photoStorageBytes && requiredBytes > estimate.available) {
    storageInfo.textContent = `A foto otimizada pode ocupar ${formatBytes(photoStorageBytes)}. ${availableText} Libere espaço antes de salvar.`;
    storageInfo.classList.add("is-low");
  } else {
    storageInfo.textContent = photoStorageBytes
      ? `Foto otimizada: aproximadamente ${formatBytes(photoStorageBytes)} no armazenamento. ${availableText}`
      : availableText;
  }
  return estimate;
}

async function preparePhoto(file) {
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error("A foto original ultrapassa o limite de 40 MB. Escolha uma imagem menor.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Não foi possível preparar a foto neste navegador.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const compressedPhoto = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível compactar a foto. Escolha outro arquivo."));
    }, "image/webp", 0.8);
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler a foto preparada."));
    reader.readAsDataURL(compressedPhoto);
  });
}

function formatDate(value) {
  if (!value) return "Uma lembrança para sempre";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderMemory(memory, index) {
  const title = String(memory.title ?? "").trim();
  const caption = String(memory.caption ?? "").trim();
  const text = String(memory.text ?? "").trim();
  const date = memory.date ? `<p class="page-date">${escapeHtml(formatDate(memory.date))}</p>` : "";
  const photo = memory.photo
    ? `<div class="memory-photo-wrap">
        <img class="memory-photo" src="${memory.photo}" alt="${escapeHtml(title)}">
    ${isEditor ? `<button class="remove-memory" type="button" data-memory-id="${escapeHtml(memory.id)}" aria-label="Remover lembrança ${escapeHtml(title)}">Remover lembrança</button>` : ""}
      </div>`
    : `<div class="photo-placeholder" aria-hidden="true">♡</div>`;

  return `<div class="page-content">
    ${photo}
    <div class="memory-copy">
      ${caption ? `<p class="image-caption">${escapeHtml(caption)}</p>` : ""}
      ${date}
      <h2 class="page-title">${escapeHtml(title)}</h2>
      ${text ? `<p class="page-text">${escapeHtml(text)}</p>` : ""}
    </div>
    <p class="page-number">${String(index + 1).padStart(2, "0")}</p>
  </div>`;
}

function renderEmpty() {
  return `<div class="page-content centered">
    <span class="empty-heart" aria-hidden="true">♡</span>
    <p class="page-title">Tudo começa com vocês</p>
    <p class="empty-message">Adicione a primeira lembrança e comece a contar a história de vocês, desde o começo.</p>
    <p class="page-number">01</p>
  </div>`;
}

function renderLeftPage() {
  if (currentIndex <= 0) {
    leftPage.innerHTML = `<div class="page-content centered">
      <p class="left-note">“As melhores histórias<br>são aquelas que<br>escrevemos juntos.”</p>
      <span class="left-note-heart" aria-hidden="true">♡</span>
      <p class="page-number">COM AMOR</p>
    </div>`;
    return;
  }
  const previousMemory = memories[currentIndex - 1];
  leftPage.innerHTML = `<div class="page-content centered">
    <p class="page-date">MAIS UM CAPÍTULO</p>
    <p class="left-note">E foi assim que a nossa história continuou...</p>
    <p class="left-prev-title">${escapeHtml(previousMemory.title)}</p>
    <p class="page-number">${String(currentIndex).padStart(2, "0")}</p>
  </div>`;
}

function renderBook() {
  const isBackCover = memories.length > 0 && currentIndex === memories.length;
  book.classList.toggle("is-back-cover", isBackCover);
  renderLeftPage();
  if (isBackCover) {
    rightPage.innerHTML = "";
    pageCounter.textContent = "Contracapa";
  } else if (currentIndex === COVER_INDEX) {
    rightPage.innerHTML = `<div class="page-content centered">
      <span class="empty-heart" aria-hidden="true">♡</span>
      <p class="page-title">Para a minha pessoa favorita</p>
      <p class="empty-message">Um livro feito de todos os dias, sorrisos e aventuras que são nossos.</p>
    </div>`;
    cover.classList.remove("is-open");
    pageCounter.textContent = "Capa";
  } else {
    rightPage.innerHTML = memories.length ? renderMemory(memories[currentIndex], currentIndex) : renderEmpty();
    cover.classList.add("is-open");
    pageCounter.textContent = `${String(currentIndex + 1).padStart(2, "0")} / ${String(Math.max(memories.length, 1)).padStart(2, "0")}`;
  }
  previousButton.disabled = isTurning || currentIndex === COVER_INDEX;
  nextButton.disabled = isTurning || isBackCover || (currentIndex !== COVER_INDEX && currentIndex >= memories.length);
  renderMemoryOrder();
}

function updateEditorControls() {
  document.querySelector("#edit-login").hidden = isEditor;
  document.querySelector("#open-form").hidden = !isEditor;
  document.querySelector("#logout").hidden = !isEditor;
  appShell.classList.toggle("is-editor", isEditor);
  syncTools.hidden = !isEditor;
  importLocalButton.disabled = !isEditor || !cloudEnabled;
  if (isEditor && !cloudEnabled) {
    syncStatus.textContent = "Supabase não configurado: novas lembranças ficam apenas neste navegador.";
  } else if (isEditor) {
    syncStatus.textContent = "Lembranças novas serão sincronizadas com o álbum online.";
  }
  renderBook();
}

function sortMemories() {
  memories.sort((a, b) => {
    if (Boolean(a.bundled) !== Boolean(b.bundled)) return a.bundled ? 1 : -1;
    if (a.bundled) return 0;
    return (a.date || "9999").localeCompare(b.date || "9999");
  });
  try {
    const savedOrder = JSON.parse(localStorage.getItem(MEMORY_ORDER_KEY) || "[]");
    if (!Array.isArray(savedOrder)) throw new Error("A ordem salva não é válida.");
    const remaining = new Map(memories.map((memory) => [memory.id, memory]));
    const orderedMemories = [];
    for (const id of savedOrder) {
      if (typeof id !== "string") continue;
      const memory = remaining.get(id);
      if (!memory) continue;
      orderedMemories.push(memory);
      remaining.delete(id);
    }
    memories = [...orderedMemories, ...remaining.values()];
  } catch (error) {
    console.warn("Não foi possível aplicar a ordem salva das lembranças:", error);
  }
}

function renderMemoryOrder() {
  orderTools.hidden = !isEditor;
  if (!isEditor) return;

  memoryOrderList.innerHTML = memories.map((memory, index) => {
    const id = escapeHtml(String(memory.id));
    const title = escapeHtml(String(memory.title ?? ""));
    return `<li class="memory-order-item">
      <span class="memory-order-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="memory-order-title">${title}</span>
      <span class="memory-order-actions">
        <button type="button" data-memory-id="${id}" data-direction="-1" aria-label="Mover ${title} para cima" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-memory-id="${id}" data-direction="1" aria-label="Mover ${title} para baixo" ${index === memories.length - 1 ? "disabled" : ""}>↓</button>
      </span>
    </li>`;
  }).join("");
}

async function removeMemory(memoryId) {
  const memory = memories.find((item) => item.id === memoryId);
  if (!isEditor || !memory) return;
  if (!window.confirm(`Remover a lembrança "${memory.title}"? A foto e a página serão removidas do álbum.`)) return;

  let cloudPhotoCleanupFailed = false;
  try {
    if (memory.bundled) {
      await saveLocalMemory({ ...memory, photo: "", photo_path: null, deleted: true });
    } else {
      await deleteLocalMemory(memory.id);
    }

    if (!memory.bundled && cloudEnabled) {
      try {
        await deleteCloudMemory(memory.id);
      } catch (error) {
        try {
          await saveLocalMemory(memory);
        } catch (restoreError) {
          console.error("Não foi possível restaurar a lembrança local após falha ao removê-la online:", restoreError);
        }
        throw error;
      }
      if (memory.photo_path) {
        try {
          await deleteCloudPhoto(memory.photo_path);
        } catch (error) {
          cloudPhotoCleanupFailed = true;
          console.error("A lembrança foi removida, mas não foi possível limpar a foto online:", error);
        }
      }
    }

    memories = memories.filter((item) => item.id !== memoryId);
    if (!memories.length) currentIndex = COVER_INDEX;
    else if (currentIndex > memories.length) currentIndex = memories.length;
    renderBook();
    if (memory.bundled) {
      syncStatus.textContent = "Lembrança removida neste navegador. Baixe o livro para incluir a alteração no projeto.";
    }
    showToast(cloudPhotoCleanupFailed
      ? "Lembrança removida, mas não foi possível limpar a foto online."
      : "Lembrança e página removidas do álbum.");
  } catch (error) {
    console.error("Erro ao remover lembrança:", error);
    showToast(error.message || "Não foi possível remover a lembrança.");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function pageContents(memory, index) {
  return memory ? renderMemory(memory, index) : renderEmpty();
}

function turnPage(direction) {
  if (isTurning) return;
  if (direction === 1 && currentIndex === COVER_INDEX) {
    if (!memories.length) {
      currentIndex = 0;
      renderBook();
      return;
    }
    // The cover has its own hinge animation; the first memory appears beneath it.
    rightPage.innerHTML = pageContents(memories[0], 0);
    cover.classList.add("is-open");
    currentIndex = 0;
    renderBook();
    return;
  }

  const targetIndex = currentIndex + direction;
  if (targetIndex < COVER_INDEX || targetIndex > memories.length) return;

  isTurning = true;
  renderBook();
  pageTurn.classList.toggle("is-closing", targetIndex === memories.length);
  turnFront.innerHTML = rightPage.innerHTML;
  if (targetIndex === memories.length) {
    const backCoverContent = document.querySelector("#back-cover").cloneNode(true);
    backCoverContent.querySelector("#restart-book").remove();
    turnBack.innerHTML = backCoverContent.innerHTML;
  } else {
    turnBack.innerHTML = targetIndex >= 0 ? pageContents(memories[targetIndex], targetIndex) : "";
  }
  pageTurn.classList.remove("is-turning");
  pageTurn.classList.remove("is-closing");
  void pageTurn.offsetWidth;
  pageTurn.classList.add("is-turning");

  const finishTurn = () => {
    pageTurn.classList.remove("is-turning");
    currentIndex = targetIndex;
    isTurning = false;
    turnFront.innerHTML = "";
    turnBack.innerHTML = "";
    renderBook();
  };
  pageTurn.addEventListener("animationend", finishTurn, { once: true });
  window.setTimeout(() => {
    if (isTurning) finishTurn();
  }, 900);
}

document.querySelector("#open-form").addEventListener("click", () => {
  formError.textContent = "";
  if (cloudEnabled) {
    storageInfo.classList.remove("is-low");
    storageInfo.textContent = "As fotos serão enviadas ao álbum online. Limite por foto: 10 MB.";
  } else {
    updateStorageInfo();
  }
  dialog.showModal();
  document.querySelector("#memory-title").focus();
});

document.querySelector("#edit-login").addEventListener("click", () => {
  loginError.textContent = "";
  loginForm.reset();
  loginScreen.hidden = false;
  document.querySelector("#login-user").focus();
});
document.querySelector("#close-login").addEventListener("click", () => {
  loginScreen.hidden = true;
});
loginScreen.addEventListener("click", (event) => {
  if (event.target === loginScreen) loginScreen.hidden = true;
});
book.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains("memory-photo")) return;

  const photoWrap = image.closest(".memory-photo-wrap");
  if (!photoWrap) return;

  const placeholder = document.createElement("div");
  placeholder.className = "photo-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.textContent = "♡";
  photoWrap.replaceWith(placeholder);
}, true);
rightPage.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-memory");
  if (removeButton) removeMemory(removeButton.dataset.memoryId);
});

document.querySelector("#close-form").addEventListener("click", () => dialog.close());
cover.addEventListener("click", () => turnPage(1));
previousButton.addEventListener("click", () => turnPage(-1));
nextButton.addEventListener("click", () => turnPage(1));
document.querySelector("#restart-book").addEventListener("click", () => {
  currentIndex = COVER_INDEX;
  renderBook();
});

document.querySelector("#logout").addEventListener("click", () => {
  isEditor = false;
  try {
    sessionStorage.removeItem(LOGIN_SESSION_KEY);
    sessionStorage.removeItem(CLOUD_SESSION_KEY);
  } catch (error) {
    console.warn("Não foi possível limpar a sessão de edição:", error);
  }
  updateEditorControls();
  showToast("Modo de edição encerrado.");
});

memoryOrderList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-memory-id]");
  if (!button || !isEditor) return;

  const fromIndex = memories.findIndex((memory) => memory.id === button.dataset.memoryId);
  const toIndex = fromIndex + Number(button.dataset.direction);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= memories.length) return;

  const currentMemory = memories[currentIndex];
  const reorderedMemories = [...memories];
  [reorderedMemories[fromIndex], reorderedMemories[toIndex]] = [reorderedMemories[toIndex], reorderedMemories[fromIndex]];
  try {
    localStorage.setItem(MEMORY_ORDER_KEY, JSON.stringify(reorderedMemories.map((memory) => memory.id)));
  } catch (error) {
    console.error("Não foi possível salvar a nova ordem das lembranças:", error);
    syncStatus.textContent = `Não foi possível salvar a ordem neste navegador. ${error.message}`;
    return;
  }

  memories = reorderedMemories;
  if (currentMemory) currentIndex = memories.indexOf(currentMemory);
  renderBook();
  syncStatus.textContent = "Ordem atualizada e salva neste navegador. Baixe o livro para levar a ordem ao projeto.";
});

importLocalButton.addEventListener("click", async () => {
  if (!isEditor || !cloudEnabled) return;
  importLocalButton.disabled = true;
  syncStatus.textContent = "Lendo as lembranças salvas neste dispositivo...";
  try {
    const localMemories = await readMemories();
    const pendingMemories = localMemories.filter((memory) => !memory.bundled);
    let imported = 0;
    for (const memory of pendingMemories) {
      syncStatus.textContent = `Importando lembrança ${imported + 1} de ${pendingMemories.length}...`;
      const savedMemory = await saveMemory(memory);
      const existingIndex = memories.findIndex((item) => item.id === savedMemory.id);
      if (existingIndex < 0) memories.push(savedMemory);
      else memories[existingIndex] = savedMemory;
      imported += 1;
    }
    sortMemories();
    renderBook();
    syncStatus.textContent = imported
      ? `${imported} lembrança(s) deste dispositivo agora está(ão) no álbum online. Os dados locais foram mantidos.`
      : "Não há lembranças locais para importar neste navegador.";
  } catch (error) {
    console.error("Erro ao importar lembranças locais:", error);
    syncStatus.textContent = `Importação interrompida. ${error.message} As lembranças locais foram mantidas; tente novamente.`;
  } finally {
    importLocalButton.disabled = !cloudEnabled;
  }
});

exportLocalButton.addEventListener("click", async () => {
  if (!isEditor) return;
  exportLocalButton.disabled = true;
  syncStatus.textContent = "Preparando o livro na ordem atual...";
  try {
    const localMemories = await readMemories();
    const removedBundled = localMemories
      .filter((memory) => memory.bundled && (memory.deleted || !memory.photo))
      .map(({ id, title, file }) => ({ id, title, file }));
    const exportMemories = memories.map(({ id, title, date, caption, text, photo, bundled, file }) => ({
      id,
      title,
      date,
      caption: caption ?? "",
      text: text ?? "",
      photo: photo ?? "",
      bundled: Boolean(bundled),
      file: file ?? "",
      showPhoto: Boolean(photo)
    }));

    if (!exportMemories.length && !removedBundled.length) {
      syncStatus.textContent = "Não há lembranças para exportar neste navegador.";
      return;
    }

    const file = new Blob([JSON.stringify({ version: 3, memories: exportMemories, removedBundled }, null, 2)], {
      type: "application/json"
    });
    const downloadUrl = URL.createObjectURL(file);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = "lembrancas-locais.json";
    downloadLink.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    syncStatus.textContent = `${exportMemories.length} lembrança(s) exportada(s) na ordem atual e ${removedBundled.length} remoção(ões) de fotos do projeto.`;
  } catch (error) {
    console.error("Erro ao exportar as lembranças locais:", error);
    syncStatus.textContent = `Não foi possível exportar as lembranças. ${error.message}`;
  } finally {
    exportLocalButton.disabled = false;
  }
});

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  preparedPhoto = "";
  formError.textContent = "";
  if (!file) {
    uploadLabel.textContent = "Escolher uma foto";
    photoPreparation = Promise.resolve(true);
    updateStorageInfo();
    return;
  }

  uploadLabel.textContent = `${file.name} — preparando...`;
  storageInfo.textContent = "Reduzindo a foto para economizar espaço...";
  photoPreparation = preparePhoto(file).then(async (photo) => {
    if (photoInput.files?.[0] !== file) return false;
    preparedPhoto = photo;
    uploadLabel.textContent = `${file.name} — otimizada`;
    if (cloudEnabled) {
      storageInfo.textContent = `Foto otimizada (${formatBytes(Math.ceil(photo.length * 3 / 4))}); será enviada ao álbum online.`;
    } else {
      await updateStorageInfo(photo.length * 2);
    }
    return true;
  }).catch((error) => {
    console.error("Erro ao preparar foto:", error);
    if (photoInput.files?.[0] === file) {
      uploadLabel.textContent = file.name;
      storageInfo.textContent = error.message || "Não foi possível preparar a foto.";
      storageInfo.classList.add("is-low");
      formError.textContent = error.message || "Não foi possível preparar a foto. Tente outro arquivo.";
    }
    return false;
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  const data = new FormData(form);
  const file = photoInput.files?.[0];
  if (file && !file.type.startsWith("image/")) {
    formError.textContent = "Escolha um arquivo de imagem válido.";
    return;
  }

  let photo = "";
  if (file) {
    if (!await photoPreparation || photoInput.files?.[0] !== file || !preparedPhoto) {
      if (!formError.textContent) formError.textContent = "A foto ainda não está pronta. Escolha a imagem novamente.";
      return;
    }
    photo = preparedPhoto;
    if (!cloudEnabled) {
      const estimatedPhotoBytes = photo.length * 2;
      const estimate = await updateStorageInfo(estimatedPhotoBytes);
      if (estimate && estimatedPhotoBytes + 64 * 1024 > estimate.available) {
        formError.textContent = "O espaço disponível parece insuficiente para esta foto. Libere espaço no navegador e tente novamente.";
        return;
      }
    }
  }

  const memory = {
    id: crypto.randomUUID(),
    title: String(data.get("title")).trim(),
    date: String(data.get("date")),
    caption: String(data.get("caption")).trim(),
    text: String(data.get("text")).trim(),
    photo
  };
  if (!memory.title || !memory.text) {
    formError.textContent = "Preencha o nome e a história desta lembrança.";
    return;
  }

  try {
    const savedMemory = await saveMemory(memory);
    memories.push(savedMemory);
    sortMemories();
    currentIndex = memories.indexOf(savedMemory);
    renderBook();
    dialog.close();
    form.reset();
    uploadLabel.textContent = "Escolher uma foto";
    preparedPhoto = "";
    photoPreparation = Promise.resolve(true);
    showToast(cloudEnabled ? "Lembrança sincronizada no álbum online ♡" : "Lembrança guardada neste navegador ♡");
    if (cloudEnabled) {
      storageInfo.textContent = "Foto enviada ao álbum online.";
    } else {
      updateStorageInfo();
    }
  } catch (error) {
    console.error("Erro ao guardar lembrança:", error);
    const estimate = await getStorageEstimate();
    if (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED") {
      formError.textContent = estimate
        ? `O navegador ficou sem espaço para salvar. Restam aproximadamente ${formatBytes(estimate.available)}. Libere espaço e tente novamente.`
        : "O navegador ficou sem espaço para salvar. Libere espaço neste navegador e tente novamente.";
      storageInfo.classList.add("is-low");
    } else {
      formError.textContent = error.message || "Não foi possível salvar a lembrança. Tente novamente.";
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (dialog.open || !loginScreen.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowRight") turnPage(1);
  if (event.key === "ArrowLeft") turnPage(-1);
});

async function start() {
  if (appStarted) return;
  appStarted = true;
  try {
    database = await openDatabase();
    const localMemories = await readMemories();
    const localBundledOverrides = localMemories.filter((memory) => memory.bundled);
    const bundledMemories = getBundledPhotoMemories(localBundledOverrides);
    const bundledIds = new Set([
      ...localBundledOverrides.map((memory) => memory.id),
      ...bundledMemories.map((memory) => memory.id)
    ]);
    memories = localMemories.filter((memory) => !memory.bundled && !bundledIds.has(memory.id));
    if (cloudEnabled) {
      try {
        const cloudMemories = await readCloudMemories();
        const byId = new Map(memories.map((memory) => [memory.id, memory]));
        for (const memory of cloudMemories) {
          if (!bundledIds.has(memory.id)) byId.set(memory.id, memory);
        }
        memories = [...byId.values()];
        document.querySelector("#public-sync-status").textContent = "Álbum online conectado: lembranças e fotos ficam disponíveis nos dispositivos.";
        if (isEditor) syncStatus.textContent = "Álbum online conectado. Suas alterações serão compartilhadas.";
      } catch (error) {
        console.error("Erro ao carregar o álbum online:", error);
        document.querySelector("#public-sync-status").textContent = `Não foi possível carregar o álbum online. ${error.message} As fotos incluídas no projeto continuam disponíveis.`;
        if (isEditor) syncStatus.textContent = `Falha ao conectar com Supabase: ${error.message}`;
      }
    } else {
      document.querySelector("#public-sync-status").textContent = "As fotos incluídas na pasta fotos aparecem para todos. Lembranças novas ficam neste navegador até configurar o Supabase.";
    }
    memories.push(...bundledMemories);
    sortMemories();
    renderBook();
  } catch (error) {
    console.error("Erro ao iniciar o livro:", error);
    memories = getBundledPhotoMemories();
    renderBook();
    document.querySelector("#public-sync-status").textContent = `Não foi possível abrir o armazenamento local. ${error.message} As fotos do projeto continuam disponíveis.`;
    rightPage.innerHTML = `<div class="page-content centered">
      <p class="page-title">Não foi possível abrir o livro</p>
      <p class="empty-message">${escapeHtml(error.message || "Verifique o espaço e as permissões de armazenamento do navegador e atualize a página.")}</p>
    </div>`;
    document.querySelector("#open-form").disabled = true;
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const username = String(data.get("username")).trim();
  const password = String(data.get("password"));
  signInEditor(username, password).then(() => {
    loginError.textContent = "";
    isEditor = true;
    if (!cloudEnabled) {
      try {
        sessionStorage.setItem(LOGIN_SESSION_KEY, "true");
      } catch (error) {
        console.warn("Não foi possível manter a sessão de edição:", error);
      }
    }
    loginScreen.hidden = true;
    updateEditorControls();
    showToast("Modo de edição ativado.");
  }).catch((error) => {
    console.error("Falha ao autenticar o editor:", error);
    loginError.textContent = error.message || "Não foi possível entrar no modo de edição.";
    document.querySelector("#login-password").focus();
  });
});

updateEditorControls();
start();
window.addEventListener("pagehide", () => database?.close());
