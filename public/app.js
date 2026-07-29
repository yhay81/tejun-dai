const storageKey = "tejun-dai-project-v1";
const sessionKey = "tejun-dai-session";
const firstDayKey = "tejun-dai-first-day";
const maximumSteps = 12;
const stepsPerPage = 4;
const maximumPhotoBytes = 420_000;
const maximumImportBytes = 5_000_000;
const paperScroll = document.querySelector(".paper-scroll");
const firstPaper = document.querySelector("[data-manual-paper]");
const paperTemplate = firstPaper?.cloneNode(true);
const stepTemplate = document.querySelector("#step-editor-template");
const importInput = document.querySelector("[data-import-input]");
let zoom = 0.72;
let saveTimer = 0;

const makeStep = (overrides = {}) => ({
  body: "",
  flag: "none",
  focusX: 50,
  focusY: 50,
  id: crypto.randomUUID(),
  note: "",
  photo: "",
  title: "",
  ...overrides,
});

const blankProject = () => ({
  audience: "",
  completion: "",
  duration: "",
  savedAt: new Date().toISOString(),
  steps: [makeStep()],
  title: "",
  tools: "",
  version: 1,
});

const sampleProject = () => ({
  audience: "閉店担当",
  completion: "表示が「精算済」になり、現金を封筒へ入れたら完了",
  duration: "約 8分",
  savedAt: new Date().toISOString(),
  steps: [
    makeStep({
      body: "未処理の伝票がないことを画面と受け皿で確認します。",
      flag: "check",
      note: "返品伝票も忘れずに確認",
      title: "伝票をそろえる",
    }),
    makeStep({
      body: "画面の「日計」から本日の集計票を1部印刷します。",
      flag: "none",
      title: "日計を印刷する",
    }),
    makeStep({
      body: "レジ内の現金を券種ごとに数え、集計票へ記入します。",
      flag: "caution",
      note: "数え直すまで確定を押さない",
      title: "現金を数える",
    }),
    makeStep({
      body: "集計票と画面の差額が0円なら精算を確定します。",
      flag: "stop",
      note: "差額がある場合は責任者へ連絡",
      title: "差額を確認する",
    }),
  ],
  title: "閉店後のレジ締め",
  tools: "集計票、電卓、入金用封筒、金庫の鍵",
  version: 1,
});

const normalizeText = (value, maximum) =>
  typeof value === "string" ? value.replaceAll("\u0000", "").slice(0, maximum) : "";

const validPhoto = (value) =>
  typeof value === "string" &&
  value.length <= maximumPhotoBytes * 1.5 &&
  /^data:image\/(?:jpeg|png|webp);base64,/u.test(value)
    ? value
    : "";

const normalizeProject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_project");
  }
  const source = value;
  if (source.version !== 1 || !Array.isArray(source.steps)) {
    throw new Error("invalid_project");
  }
  const steps = source.steps.slice(0, maximumSteps).map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return makeStep();
    const flags = new Set(["none", "check", "caution", "stop"]);
    return makeStep({
      body: normalizeText(step.body, 220),
      flag: flags.has(step.flag) ? step.flag : "none",
      focusX: Number.isFinite(step.focusX) ? Math.max(0, Math.min(100, step.focusX)) : 50,
      focusY: Number.isFinite(step.focusY) ? Math.max(0, Math.min(100, step.focusY)) : 50,
      id: typeof step.id === "string" && step.id.length <= 80 ? step.id : crypto.randomUUID(),
      note: normalizeText(step.note, 100),
      photo: validPhoto(step.photo),
      title: normalizeText(step.title, 48),
    });
  });
  return {
    audience: normalizeText(source.audience, 40),
    completion: normalizeText(source.completion, 180),
    duration: normalizeText(source.duration, 24),
    savedAt: new Date().toISOString(),
    steps: steps.length > 0 ? steps : [makeStep()],
    title: normalizeText(source.title, 64),
    tools: normalizeText(source.tools, 120),
    version: 1,
  };
};

const loadProject = () => {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? normalizeProject(JSON.parse(stored)) : blankProject();
  } catch {
    localStorage.removeItem(storageKey);
    return blankProject();
  }
};

let project = loadProject();

const getSession = () => {
  let session = localStorage.getItem(sessionKey);
  if (!session) {
    session = crypto.randomUUID();
    localStorage.setItem(sessionKey, session);
  }
  return session;
};

const dayInJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const automatedQa =
  new URLSearchParams(location.search).get("qa") === "1" || navigator.webdriver === true;

const sendEvent = async (name) => {
  try {
    await fetch("/api/events", {
      body: JSON.stringify({ name }),
      headers: {
        "content-type": "application/json",
        "x-tejun-qa": automatedQa ? "1" : "0",
        "x-tejun-session": getSession(),
      },
      method: "POST",
    });
  } catch {
    // Product work continues when anonymous telemetry is unavailable.
  }
};

const sendEventOnce = (name) => {
  const marker = `tejun-dai-event-${name}-${dayInJst()}`;
  if (sessionStorage.getItem(marker)) return;
  sessionStorage.setItem(marker, "1");
  void sendEvent(name);
};

const showState = (text, tone = "saved") => {
  const state = document.querySelector("[data-save-state]");
  if (!(state instanceof HTMLElement)) return;
  state.dataset.tone = tone;
  const label = state.querySelector("span");
  if (label) label.textContent = text;
};

const saveNow = () => {
  try {
    project.savedAt = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify(project));
    showState("端末内に保存済み");
  } catch {
    showState("保存容量が足りません。編集用保存を実行してください", "error");
  }
};

const scheduleSave = () => {
  showState("保存中…", "saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 350);
};

const textOr = (value, fallback) => (value.trim() ? value : fallback);

const setText = (root, selector, value) => {
  const node = root.querySelector(selector);
  if (node) node.textContent = value;
};

const flagLabels = {
  caution: "注意",
  check: "確認",
  none: "",
  stop: "禁止",
};

const previewStep = (step, index) => {
  const article = document.createElement("article");
  article.className = "manual-step";
  const visual = document.createElement("div");
  visual.className = step.photo ? "manual-photo" : "manual-photo empty";
  if (step.photo) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = step.photo;
    image.style.objectPosition = `${step.focusX}% ${step.focusY}%`;
    visual.append(image);
    const focus = document.createElement("i");
    focus.className = "preview-focus";
    focus.style.left = `${step.focusX}%`;
    focus.style.top = `${step.focusY}%`;
    visual.append(focus);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = "PHOTO";
    visual.append(placeholder);
  }
  const number = document.createElement("b");
  number.className = "manual-step-number";
  number.textContent = String(index + 1).padStart(2, "0");
  visual.append(number);

  const copy = document.createElement("div");
  copy.className = "manual-step-copy";
  const heading = document.createElement("h3");
  heading.textContent = textOr(step.title, `手順 ${index + 1}`);
  const body = document.createElement("p");
  body.textContent = textOr(step.body, "やり方を入力");
  copy.append(heading, body);
  if (step.flag !== "none") {
    const note = document.createElement("div");
    note.className = `manual-flag ${step.flag}`;
    const label = document.createElement("span");
    label.textContent = flagLabels[step.flag];
    const message = document.createElement("p");
    message.textContent = textOr(step.note, "注意内容を入力");
    note.append(label, message);
    copy.append(note);
  }
  article.append(visual, copy);
  return article;
};

const renderPaper = (paper, steps, pageIndex, pageCount, startIndex) => {
  setText(paper, "[data-preview-audience]", textOr(project.audience, "対象を入力"));
  setText(paper, "[data-preview-title]", textOr(project.title, "手順書名を入力"));
  setText(paper, "[data-preview-duration]", textOr(project.duration, "—"));
  setText(paper, "[data-preview-tools]", textOr(project.tools, "必要な道具を入力"));
  setText(paper, "[data-preview-completion]", textOr(project.completion, "完了条件を入力"));
  const date = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
  }).format(new Date(project.savedAt));
  setText(paper, "[data-preview-date]", `${date} · ${pageIndex + 1}/${pageCount}`);
  const code = paper.querySelector(".manual-code b");
  if (code) code.textContent = String(pageIndex + 1).padStart(2, "0");
  const stepsRoot = paper.querySelector("[data-preview-steps]");
  if (stepsRoot) {
    stepsRoot.replaceChildren(...steps.map((step, index) => previewStep(step, startIndex + index)));
  }
  const completion = paper.querySelector(".manual-completion");
  if (completion instanceof HTMLElement) {
    completion.classList.toggle("continued", pageIndex !== pageCount - 1);
    if (pageIndex !== pageCount - 1) {
      setText(completion, "small", "次ページへ");
      setText(completion, "p", "手順は次のページへ続きます");
      setText(completion, ".complete-seal", "続");
    }
  }
  paper.style.setProperty("--paper-zoom", String(zoom));
};

const renderPreview = () => {
  if (!(paperScroll instanceof HTMLElement) || !(paperTemplate instanceof HTMLElement)) return;
  const pages = [];
  for (let index = 0; index < project.steps.length; index += stepsPerPage) {
    pages.push(project.steps.slice(index, index + stepsPerPage));
  }
  paperScroll.replaceChildren();
  pages.forEach((steps, pageIndex) => {
    const paper = paperTemplate.cloneNode(true);
    if (!(paper instanceof HTMLElement)) return;
    renderPaper(paper, steps, pageIndex, pages.length, pageIndex * stepsPerPage);
    paperScroll.append(paper);
  });
  const label = document.querySelector("[data-zoom-label]");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
};

const mutateStep = (index, field, value) => {
  const step = project.steps[index];
  if (!step) return;
  step[field] = value;
  if (
    (field === "title" || field === "body") &&
    String(value).trim() &&
    !sessionStorage.getItem("tejun-dai-started")
  ) {
    sessionStorage.setItem("tejun-dai-started", "1");
    sendEventOnce("manual_started");
  }
  if (index > 0 && (field === "title" || field === "body") && String(value).trim()) {
    sendEventOnce("step_edited");
  }
  scheduleSave();
  renderPreview();
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read_failed")),
    );
    reader.addEventListener("error", () => reject(new Error("read_failed")));
    reader.readAsDataURL(blob);
  });

const canvasBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))),
      "image/jpeg",
      quality,
    );
  });

const compressPhoto = async (file) => {
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 15_000_000) {
    throw new Error("invalid_photo");
  }
  const bitmap = await createImageBitmap(file);
  try {
    let maximumSide = 1280;
    let quality = 0.82;
    let blob;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const ratio = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, quality);
      if (blob.size <= maximumPhotoBytes) break;
      maximumSide = Math.round(maximumSide * 0.82);
      quality = Math.max(0.58, quality - 0.06);
    }
    if (!blob || blob.size > maximumPhotoBytes) throw new Error("photo_too_complex");
    return blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
};

const handlePhoto = async (index, file) => {
  showState("写真を端末内で縮小中…", "saving");
  try {
    const photo = await compressPhoto(file);
    mutateStep(index, "photo", photo);
    sendEventOnce("photo_added");
    renderEditors();
    showState("写真を端末内に保存済み");
  } catch {
    showState("JPEG・PNG・WebPを15MB以下で選んでください", "error");
  }
};

const moveStep = (index, direction) => {
  const target = index + direction;
  if (target < 0 || target >= project.steps.length) return;
  const [step] = project.steps.splice(index, 1);
  project.steps.splice(target, 0, step);
  scheduleSave();
  renderAll();
};

const duplicateStep = (index) => {
  if (project.steps.length >= maximumSteps) {
    showState("手順は12個までです", "error");
    return;
  }
  const source = project.steps[index];
  if (!source) return;
  project.steps.splice(index + 1, 0, { ...source, id: crypto.randomUUID() });
  scheduleSave();
  renderAll();
};

const removeStep = (index) => {
  if (project.steps.length === 1) {
    project.steps[0] = makeStep();
  } else {
    project.steps.splice(index, 1);
  }
  scheduleSave();
  renderAll();
};

const renderEditors = () => {
  const list = document.querySelector("[data-step-list]");
  if (!(list instanceof HTMLElement) || !(stepTemplate instanceof HTMLTemplateElement)) return;
  list.replaceChildren();
  project.steps.forEach((step, index) => {
    const fragment = stepTemplate.content.cloneNode(true);
    const editor = fragment.querySelector(".step-editor");
    if (!(editor instanceof HTMLElement)) return;
    setText(editor, "[data-step-number]", `STEP ${String(index + 1).padStart(2, "0")}`);
    editor.dataset.index = String(index);

    for (const field of ["title", "body", "flag", "note"]) {
      const input = editor.querySelector(`[data-step-field="${field}"]`);
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.value = step[field];
        input.addEventListener("input", () => mutateStep(index, field, input.value));
      } else if (input instanceof HTMLSelectElement) {
        input.value = step[field];
        input.addEventListener("change", () => {
          mutateStep(index, field, input.value);
          renderEditors();
        });
      }
    }
    const noteLabel = editor.querySelector("[data-note-label]");
    if (noteLabel instanceof HTMLElement) noteLabel.hidden = step.flag === "none";

    const photoInput = editor.querySelector('[data-step-field="photo"]');
    if (photoInput instanceof HTMLInputElement) {
      photoInput.addEventListener("change", () => {
        const file = photoInput.files?.[0];
        if (file) void handlePhoto(index, file);
      });
    }
    const drop = editor.querySelector(".photo-drop");
    const photo = editor.querySelector("[data-step-photo]");
    const placeholder = editor.querySelector(".photo-placeholder");
    const focus = editor.querySelector("[data-focus-dot]");
    if (photo instanceof HTMLImageElement) {
      photo.src = step.photo;
      photo.hidden = !step.photo;
      photo.style.objectPosition = `${step.focusX}% ${step.focusY}%`;
    }
    if (placeholder instanceof HTMLElement) placeholder.hidden = Boolean(step.photo);
    if (focus instanceof HTMLElement) {
      focus.hidden = !step.photo;
      focus.style.left = `${step.focusX}%`;
      focus.style.top = `${step.focusY}%`;
    }
    if (drop instanceof HTMLElement) {
      drop.classList.toggle("has-photo", Boolean(step.photo));
      drop.addEventListener("dragover", (event) => {
        event.preventDefault();
        drop.classList.add("dragging");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("dragging");
        const file = event.dataTransfer?.files[0];
        if (file) void handlePhoto(index, file);
      });
      drop.addEventListener("click", (event) => {
        if (!step.photo || event.target instanceof HTMLInputElement) return;
        const bounds = drop.getBoundingClientRect();
        const focusX = Math.round(((event.clientX - bounds.left) / bounds.width) * 100);
        const focusY = Math.round(((event.clientY - bounds.top) / bounds.height) * 100);
        step.focusX = Math.max(0, Math.min(100, focusX));
        step.focusY = Math.max(0, Math.min(100, focusY));
        scheduleSave();
        renderEditors();
        renderPreview();
      });
    }

    editor
      .querySelector('[data-step-action="up"]')
      ?.addEventListener("click", () => moveStep(index, -1));
    editor
      .querySelector('[data-step-action="down"]')
      ?.addEventListener("click", () => moveStep(index, 1));
    editor
      .querySelector('[data-step-action="duplicate"]')
      ?.addEventListener("click", () => duplicateStep(index));
    editor
      .querySelector('[data-step-action="remove"]')
      ?.addEventListener("click", () => removeStep(index));
    list.append(fragment);
  });
  const count = document.querySelector("[data-step-count]");
  if (count) count.textContent = `${project.steps.length} / ${maximumSteps}`;
  const add = document.querySelector('[data-action="add-step"]');
  if (add instanceof HTMLButtonElement) add.disabled = project.steps.length >= maximumSteps;
};

const renderMeta = () => {
  for (const field of ["title", "audience", "duration", "tools", "completion"]) {
    const input = document.querySelector(`[data-field="${field}"]`);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = project[field];
    }
  }
};

const renderAll = () => {
  renderMeta();
  renderEditors();
  renderPreview();
};

const addStep = () => {
  if (project.steps.length >= maximumSteps) return;
  project.steps.push(makeStep());
  sendEventOnce("step_edited");
  scheduleSave();
  renderAll();
  document.querySelector("[data-step-list]")?.lastElementChild?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

const exportProject = () => {
  saveNow();
  const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  const link = document.createElement("a");
  const fileName =
    project.title
      .normalize("NFKC")
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 40) || "tejun";
  link.href = URL.createObjectURL(blob);
  link.download = `${fileName}.tejundai`;
  link.click();
  URL.revokeObjectURL(link.href);
  sendEventOnce("project_exported");
  showState("編集用ファイルを保存しました");
};

const importProject = async (file) => {
  if (!(file instanceof File) || file.size > maximumImportBytes) {
    showState("5MB以下の .tejundai ファイルを選んでください", "error");
    return;
  }
  try {
    project = normalizeProject(JSON.parse(await file.text()));
    saveNow();
    renderAll();
    sendEventOnce("project_imported");
    showState("編集用ファイルを読み込みました");
  } catch {
    showState("この編集用ファイルは読み込めません", "error");
  }
};

const resetProject = () => {
  if (!confirm("端末内の手順書を白紙に戻しますか？")) return;
  project = blankProject();
  localStorage.removeItem(storageKey);
  renderAll();
  showState("白紙に戻しました");
};

document.querySelectorAll("[data-field]").forEach((input) => {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
  input.addEventListener("input", () => {
    const field = input.dataset.field;
    if (!field) return;
    project[field] = input.value;
    if (input.value.trim()) sendEventOnce("manual_started");
    scheduleSave();
    renderPreview();
  });
});

document.querySelector('[data-action="add-step"]')?.addEventListener("click", addStep);
document.querySelector('[data-action="export"]')?.addEventListener("click", exportProject);
document.querySelector('[data-action="import"]')?.addEventListener("click", () => {
  if (importInput instanceof HTMLInputElement) importInput.click();
});
importInput?.addEventListener("change", () => {
  if (importInput instanceof HTMLInputElement) {
    const file = importInput.files?.[0];
    if (file) void importProject(file);
    importInput.value = "";
  }
});
document.querySelector('[data-action="sample"]')?.addEventListener("click", () => {
  if (
    project.title.trim() &&
    !confirm("現在の内容を見本に置き換えますか？ 編集用保存を先に行うこともできます。")
  ) {
    return;
  }
  project = sampleProject();
  scheduleSave();
  renderAll();
  showState("見本を読み込みました。自由に書き換えられます");
});
document.querySelector('[data-action="reset"]')?.addEventListener("click", resetProject);
document.querySelector('[data-action="print"]')?.addEventListener("click", () => {
  saveNow();
  renderPreview();
  sendEventOnce("printed");
  window.print();
});
document.querySelector('[data-action="zoom-out"]')?.addEventListener("click", () => {
  zoom = Math.max(0.5, Math.round((zoom - 0.06) * 100) / 100);
  renderPreview();
});
document.querySelector('[data-action="zoom-in"]')?.addEventListener("click", () => {
  zoom = Math.min(1, Math.round((zoom + 0.06) * 100) / 100);
  renderPreview();
});

const today = dayInJst();
const firstDay = localStorage.getItem(firstDayKey);
if (!firstDay) {
  localStorage.setItem(firstDayKey, today);
} else if (firstDay !== today) {
  sendEventOnce("returned");
}
sendEventOnce("visited");
renderAll();
