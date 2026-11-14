const DB_NAME = "nosso-livro";
const STORE_NAME = "memories";
const DB_VERSION = 1;
const COVER_INDEX = -1;
const MAX_PHOTO_SIZE = 40 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const LOGIN_USER = "b+f";
const LOGIN_PASSWORD = "2015";
const LOGIN_SESSION_KEY = "nosso-livro-authenticated";

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

let database;
let memories = [];
let currentIndex = COVER_INDEX;
let isTurning = false;
let toastTimer;
let preparedPhoto = "";
let photoPreparation = Promise.resolve(true);
let appStarted = false;
let isEditor = false;

try {
  isEditor = sessionStorage.getItem(LOGIN_SESSION_KEY) === "true";
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

function saveMemory(memory) {
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
  const photo = memory.photo
    ? `<div class="memory-photo-wrap">
        <img class="memory-photo" src="${memory.photo}" alt="${escapeHtml(title)}">
        ${isEditor ? `<button class="remove-photo" type="button" data-memory-id="${escapeHtml(memory.id)}" aria-label="Remover foto de ${escapeHtml(title)}">Remover foto</button>` : ""}
      </div>`
    : `<div class="photo-placeholder" aria-hidden="true">♡</div>`;

  return `<div class="page-content">
    ${photo}
    ${caption ? `<p class="image-caption">${escapeHtml(caption)}</p>` : ""}
    <p class="page-date">${escapeHtml(formatDate(memory.date))}</p>
    <h2 class="page-title">${escapeHtml(title)}</h2>
    <p class="page-text">${escapeHtml(text)}</p>
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
}

function updateEditorControls() {
  document.querySelector("#edit-login").hidden = isEditor;
  document.querySelector("#open-form").hidden = !isEditor;
  document.querySelector("#logout").hidden = !isEditor;
  appShell.classList.toggle("is-editor", isEditor);
  renderBook();
}

async function removePhoto(memoryId) {
  const memory = memories.find((item) => item.id === memoryId);
  if (!isEditor || !memory?.photo) return;
  if (!window.confirm(`Remover a foto de "${memory.title}"? O texto da lembrança será mantido.`)) return;

  const updatedMemory = { ...memory, photo: "" };
  try {
    await saveMemory(updatedMemory);
    memories = memories.map((item) => item.id === memoryId ? updatedMemory : item);
    renderBook();
    showToast("Foto removida. O texto foi mantido.");
  } catch (error) {
    console.error("Erro ao remover foto:", error);
    showToast(error.message || "Não foi possível remover a foto.");
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
  updateStorageInfo();
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
rightPage.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-photo");
  if (removeButton) removePhoto(removeButton.dataset.memoryId);
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
  } catch (error) {
    console.warn("Não foi possível limpar a sessão de edição:", error);
  }
  updateEditorControls();
  showToast("Modo de edição encerrado.");
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
    await updateStorageInfo(photo.length * 2);
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
    const estimatedPhotoBytes = photo.length * 2;
    const estimate = await updateStorageInfo(estimatedPhotoBytes);
    if (estimate && estimatedPhotoBytes + 64 * 1024 > estimate.available) {
      formError.textContent = "O espaço disponível parece insuficiente para esta foto. Libere espaço no navegador e tente novamente.";
      return;
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
    await saveMemory(memory);
    memories.push(memory);
    memories.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    currentIndex = memories.indexOf(memory);
    renderBook();
    dialog.close();
    form.reset();
    uploadLabel.textContent = "Escolher uma foto";
    preparedPhoto = "";
    photoPreparation = Promise.resolve(true);
    showToast("Lembrança guardada no livro ♡");
    updateStorageInfo();
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
    memories = await readMemories();
    memories.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    renderBook();
  } catch (error) {
    console.error("Erro ao iniciar o livro:", error);
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
  if (username !== LOGIN_USER || password !== LOGIN_PASSWORD) {
    loginError.textContent = "Login ou senha incorretos. Tente novamente.";
    document.querySelector("#login-password").focus();
    return;
  }
  loginError.textContent = "";
  isEditor = true;
  try {
    sessionStorage.setItem(LOGIN_SESSION_KEY, "true");
  } catch (error) {
    console.warn("Não foi possível manter a sessão de edição:", error);
  }
  loginScreen.hidden = true;
  updateEditorControls();
  showToast("Modo de edição ativado.");
});

updateEditorControls();
start();
window.addEventListener("pagehide", () => database?.close());
