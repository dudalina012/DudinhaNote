const DB_NAME = 'milanote-local';
const DB_VERSION = 1;
const DEFAULT_STAGE_WIDTH = 6000;
const DEFAULT_STAGE_HEIGHT = 4000;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.4;
const MAX_HISTORY_STEPS = 40;

const viewport = document.querySelector('#viewport');
const stageWrap = document.querySelector('#stage-wrap');
const stage = document.querySelector('#stage');
const itemsLayer = document.querySelector('#items-layer');
const connections = document.querySelector('#connections');
const foregroundItems = document.querySelector('#foreground-items');
const foregroundConnections = document.querySelector('#foreground-connections');
const boardList = document.querySelector('#board-list');
const boardTitle = document.querySelector('#board-title');
const breadcrumbHome = document.querySelector('#breadcrumb-home');
const breadcrumbParents = document.querySelector('#breadcrumb-parents');
const selectionTools = document.querySelector('#selection-tools');
const emptyHint = document.querySelector('#empty-hint');
const lineHint = document.querySelector('#line-hint');
const backgroundOptions = document.querySelector('#background-options');
const textFormatOptions = document.querySelector('#text-format-options');
const saveStatus = document.querySelector('.save-status');
const saveLabel = document.querySelector('#save-label');
const zoomLabel = document.querySelector('#zoom-label');
const imageInput = document.querySelector('#image-input');
const toast = document.querySelector('#toast');
const imageViewer = document.querySelector('#image-viewer');
const imageViewerContent = document.querySelector('#image-viewer-content');
const drawingTools = document.querySelector('#drawing-tools');
const eraserButton = document.querySelector('#eraser-tool');
const undoButton = document.querySelector('#undo-action');
const redoButton = document.querySelector('#redo-action');
const CARD_BACKGROUNDS = new Set(['#fffefa', '#f6d365', '#f5c2a0', '#efb5bc', '#c5dfb0', '#a9d6e5', '#c7b6e8', 'transparent']);
const FONT_FAMILIES = new Set(['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Consolas', 'Comic Sans MS', 'Impact']);

let db;
let boards = [];
let activeBoardId;
let elements = [];
let selectedId = null;
let activeTool = null;
let historyPast = [];
let historyFuture = [];
let lastHistoryGroup = null;
let historyBusy = false;
let appClipboard = null;
let pasteAppClipboard = false;
let firstLinePoint = null;
let activeStroke = null;
const drawingSettings = { color: '#f2f2ed', width: 2, eraser: false, layer: 'front' };
let stageWidth = DEFAULT_STAGE_WIDTH;
let stageHeight = DEFAULT_STAGE_HEIGHT;
let zoom = 1;
let spaceDown = false;
let dragState = null;
let toolbarDragState = null;
let toolbarDragGhost = null;
let suppressToolbarClick = false;
let imageDropPosition = null;
let suppressBoardOpen = false;
let panState = null;
const saveTimers = new Map();
const pendingSaves = new Set();
let closeAfterSave = false;
let toastTimer;
let objectUrls = [];

const id = () => crypto.randomUUID();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('boards')) {
        database.createObjectStore('boards', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('elements')) {
        const store = database.createObjectStore('elements', { keyPath: 'id' });
        store.createIndex('boardId', 'boardId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o banco de dados local.'));
  });
}

function renderColumn(element, card, top, kind, remove) {
  const dragHandle = document.createElement('span');
  dragHandle.className = 'column-drag-handle';
  dragHandle.textContent = '⠿';
  dragHandle.setAttribute('aria-hidden', 'true');
  const title = document.createElement('div');
  title.className = 'column-title';
  title.contentEditable = 'true';
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Nome da coluna');
  title.textContent = element.title || 'Nova coluna';
  title.addEventListener('focus', () => selectElement(element.id));
  title.addEventListener('input', () => {
    recordHistory(`text:${element.id}:column`);
    element.title = title.textContent;
    scheduleSaveElement(element);
  });
  top.replaceChildren(dragHandle, title, remove);
  kind.remove();
  card.style.zIndex = '0';

  const content = document.createElement('div');
  content.className = 'column-content';
  content.dataset.columnId = element.id;
  const childElements = elements
    .filter((child) => child.containerId === element.id)
    .sort((a, b) => (a.z ?? a.createdAt ?? 0) - (b.z ?? b.createdAt ?? 0));
  const emptyHint = document.createElement('div');
  emptyHint.className = 'column-empty-hint';
  emptyHint.textContent = 'Arraste itens para organizar aqui';
  emptyHint.hidden = childElements.length > 0;
  content.append(emptyHint);

  const childConnections = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  childConnections.classList.add('connections', 'column-connections');
  childConnections.dataset.parentColumnId = element.id;
  const offset = getColumnContentOffset(element);
  childConnections.setAttribute('viewBox', `0 0 ${Math.max(1, element.width - 16)} ${Math.max(1, element.height - 50)}`);
  childConnections.setAttribute('preserveAspectRatio', 'none');
  content.append(childConnections);
  const childForegroundConnections = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  childForegroundConnections.classList.add('connections', 'column-connections', 'column-foreground-connections');
  childForegroundConnections.dataset.parentColumnId = element.id;
  childForegroundConnections.setAttribute('viewBox', `0 0 ${Math.max(1, element.width - 16)} ${Math.max(1, element.height - 50)}`);
  childForegroundConnections.setAttribute('preserveAspectRatio', 'none');
  const childForegroundItems = document.createElement('div');
  childForegroundItems.className = 'items-layer column-foreground-items';
  for (const child of childElements) {
    if (child.type === 'line') renderLine(child, childConnections, offset);
    else if (child.type === 'drawing') renderDrawing(child, child.layer === 'front' ? childForegroundConnections : childConnections, offset);
    else renderElement(child, child.layer === 'front' ? childForegroundItems : content, element);
  }
  content.append(childForegroundConnections, childForegroundItems);
  card.append(content);
}

function getColumnContentOffset(column) {
  return { x: column.x + 8, y: column.y + 42 };
}

function constrainElementToColumn(element, column) {
  const offset = getColumnContentOffset(column);
  const maxX = Math.max(offset.x, column.x + column.width - 8 - element.width);
  const maxY = Math.max(offset.y, column.y + column.height - 8 - element.height);
  element.x = Math.max(offset.x, Math.min(element.x, maxX));
  element.y = Math.max(offset.y, Math.min(element.y, maxY));
}

function getElementContainer(element) {
  return elements.find((entry) => entry.id === element.containerId && entry.type === 'column') ?? null;
}

function getElementOffset(element) {
  const container = getElementContainer(element);
  return container ? getColumnContentOffset(container) : { x: 0, y: 0 };
}

function updateColumnConnections(column, card) {
  const content = [...card.children].find((child) => child.classList.contains('column-content'));
  content?.querySelectorAll(':scope > .column-connections').forEach((svg) => {
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, column.width - 16)} ${Math.max(1, column.height - 50)}`);
  });
}

function findColumnAtPosition(point, excludedId = null) {
  return elements
    .filter((element) => element.type === 'column' && element.id !== excludedId)
    .filter((column) => {
      const offset = getColumnContentOffset(column);
      return point.x >= offset.x
        && point.x <= column.x + column.width - 8
        && point.y >= offset.y
        && point.y <= column.y + column.height - 8;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
}

function updateLineVisual(element) {
  const path = [...stage.querySelectorAll('.connection-path')]
    .find((entry) => entry.dataset.id === element.id);
  if (!path) return;
  const layer = path.closest('svg');
  const offset = getElementOffset(element);
  path.setAttribute('d', linePathData(element, offset));
  renderLineHandles(element, layer, offset);
}

function updateDrawingVisual(element) {
  const path = [...stage.querySelectorAll('.drawing-path')]
    .find((entry) => entry.dataset.id === element.id);
  if (!path) return;
  const offset = getElementOffset(element);
  path.setAttribute('d', drawingPathData(element.points.map((point) => ({
    x: point.x - offset.x,
    y: point.y - offset.y,
  }))));
}

function translateColumnContents(columnId, deltaX, deltaY, visited = new Set()) {
  if (visited.has(columnId)) return;
  visited.add(columnId);
  for (const child of elements.filter((entry) => entry.containerId === columnId)) {
    if (child.type === 'line') {
      child.x1 += deltaX;
      child.y1 += deltaY;
      child.x2 += deltaX;
      child.y2 += deltaY;
      if (Number.isFinite(child.controlX)) child.controlX += deltaX;
      if (Number.isFinite(child.controlY)) child.controlY += deltaY;
      updateLineVisual(child);
    } else if (child.type === 'drawing') {
      child.points.forEach((point) => {
        point.x += deltaX;
        point.y += deltaY;
      });
      updateDrawingVisual(child);
    } else {
      child.x += deltaX;
      child.y += deltaY;
      if (child.type === 'column') translateColumnContents(child.id, deltaX, deltaY, visited);
    }
    scheduleSaveElement(child);
  }
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao ler os dados locais.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao salvar os dados locais.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A gravação local foi cancelada.'));
  });
}

async function storeValue(storeName, method, value) {
  const transaction = db.transaction(storeName, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(storeName)[method](value);
  await completion;
}

async function loadAll(storeName) {
  return requestValue(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function getBoardElements(boardId) {
  return requestValue(
    db.transaction('elements', 'readonly').objectStore('elements').index('boardId').getAll(boardId),
  );
}

function cloneElements(source = elements) {
  return structuredClone(source);
}

function updateHistoryButtons() {
  undoButton.disabled = historyBusy || historyPast.length === 0;
  redoButton.disabled = historyBusy || historyFuture.length === 0;
}

function recordHistory(groupKey = null) {
  if (
    groupKey &&
    lastHistoryGroup?.key === groupKey &&
    (groupKey.startsWith('erase:') || Date.now() - lastHistoryGroup.time < 900)
  ) {
    lastHistoryGroup.time = Date.now();
    return;
  }
  historyPast.push({
    boardId: activeBoardId,
    elements: cloneElements(),
    selectedId,
  });
  if (historyPast.length > MAX_HISTORY_STEPS) historyPast.shift();
  historyFuture = [];
  lastHistoryGroup = groupKey ? { key: groupKey, time: Date.now() } : null;
  updateHistoryButtons();
}

function clearElementSaveTimers() {
  elements.forEach((element) => {
    const timer = saveTimers.get(element.id);
    if (timer) window.clearTimeout(timer);
    saveTimers.delete(element.id);
    pendingSaves.delete(element.id);
  });
}

async function replaceBoardElements(boardId, nextElements) {
  const transaction = db.transaction('elements', 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore('elements');
  const cursorRequest = store.index('boardId').openCursor(IDBKeyRange.only(boardId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
      return;
    }
    nextElements.forEach((element) => store.put(element));
  };
  await completion;
}

async function travelHistory(direction) {
  if (historyBusy) return;
  historyBusy = true;
  updateHistoryButtons();
  const from = direction === 'undo' ? historyPast : historyFuture;
  const to = direction === 'undo' ? historyFuture : historyPast;
  const snapshot = from.pop();
  if (!snapshot || snapshot.boardId !== activeBoardId) {
    historyBusy = false;
    updateHistoryButtons();
    return;
  }
  const current = { boardId: activeBoardId, elements: cloneElements(), selectedId };
  let addedFutureSnapshot = false;
  try {
    await flushPendingSaves();
    to.push(current);
    addedFutureSnapshot = true;
    clearElementSaveTimers();
    elements = cloneElements(snapshot.elements);
    selectedId = elements.some((element) => element.id === snapshot.selectedId) ? snapshot.selectedId : null;
    lastHistoryGroup = null;
    await replaceBoardElements(activeBoardId, elements);
    if (pendingSaves.size === 0) markSaved();
    renderAll();
    updateSelectionTools();
    updateHistoryButtons();
  } catch (error) {
    if (addedFutureSnapshot) to.pop();
    from.push(snapshot);
    elements = current.elements;
    selectedId = current.selectedId;
    renderAll();
    updateSelectionTools();
    reportStorageError(error);
  } finally {
    historyBusy = false;
    updateHistoryButtons();
  }
}

function undoAction() {
  void travelHistory('undo');
}

function redoAction() {
  void travelHistory('redo');
}

function copySelectedElement() {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element) return false;
  appClipboard = cloneElements([element])[0];
  showToast('Item copiado. Use Ctrl+V para colar uma cópia.');
  return true;
}

function pasteCopiedElement() {
  if (!appClipboard) return false;
  const element = cloneElements([appClipboard])[0];
  element.id = id();
  element.boardId = activeBoardId;
  element.createdAt = Date.now();
  if (element.type === 'line') {
    element.x1 = Math.min(stageWidth, element.x1 + 28);
    element.y1 = Math.min(stageHeight, element.y1 + 28);
    element.x2 = Math.min(stageWidth, element.x2 + 28);
    element.y2 = Math.min(stageHeight, element.y2 + 28);
    if (Number.isFinite(element.controlX)) element.controlX += 28;
    if (Number.isFinite(element.controlY)) element.controlY += 28;
  } else if (element.type === 'drawing') {
    element.points = element.points.map((point) => ({
      x: Math.min(stageWidth, point.x + 28),
      y: Math.min(stageHeight, point.y + 28),
    }));
  } else {
    element.x = Math.min(stageWidth - element.width, element.x + 28);
    element.y = Math.min(stageHeight - element.height, element.y + 28);
  }
  recordHistory();
  elements.push(element);
  selectedId = element.id;
  renderAll();
  animateNewElement(element.id);
  updateSelectionTools();
  scheduleSaveElement(element);
  showToast('Cópia adicionada ao quadro.');
  return true;
}

async function deleteBoardData(boardIds) {
  const transaction = db.transaction(['boards', 'elements'], 'readwrite');
  const completion = transactionDone(transaction);
  const removedIds = new Set(boardIds);
  const boardStore = transaction.objectStore('boards');
  removedIds.forEach((boardId) => boardStore.delete(boardId));
  const elementStore = transaction.objectStore('elements');
  const cursorRequest = elementStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      const element = cursor.value;
      if (removedIds.has(element.boardId) || (element.type === 'board' && removedIds.has(element.targetBoardId))) {
        cursor.delete();
      }
      cursor.continue();
    }
  };
  await completion;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function reportStorageError(error) {
  console.error('Erro ao persistir o quadro local:', error);
  saveStatus.classList.remove('saving');
  saveStatus.classList.add('error');
  saveLabel.textContent = 'Erro ao salvar';
  showToast('Não foi possível salvar no computador. Verifique o espaço disponível.');
}

function markSaving() {
  saveStatus.classList.remove('error');
  saveStatus.classList.add('saving');
  saveLabel.textContent = 'Salvando…';
}

function markSaved() {
  saveStatus.classList.remove('saving', 'error');
  saveLabel.textContent = 'Salvo neste PC';
}

async function persistElementNow(element) {
  const timer = saveTimers.get(element.id);
  if (timer) window.clearTimeout(timer);
  saveTimers.delete(element.id);
  if (!pendingSaves.has(element.id)) return;
  try {
    await storeValue('elements', 'put', element);
    pendingSaves.delete(element.id);
    if (pendingSaves.size === 0) markSaved();
  } catch (error) {
    reportStorageError(error);
    throw error;
  }
}

async function flushPendingSaves() {
  const pending = [...pendingSaves]
    .map((elementId) => elements.find((element) => element.id === elementId))
    .filter(Boolean);
  await Promise.all(pending.map(persistElementNow));
}

function scheduleSaveElement(element) {
  const existingTimer = saveTimers.get(element.id);
  if (existingTimer) window.clearTimeout(existingTimer);
  pendingSaves.add(element.id);
  markSaving();
  const timer = window.setTimeout(async () => {
    try { await persistElementNow(element); }
    catch { /* The save error has already been reported. */ }
  }, 180);
  saveTimers.set(element.id, timer);
}

async function saveBoard(board) {
  markSaving();
  try {
    await storeValue('boards', 'put', board);
    markSaved();
  } catch (error) {
    reportStorageError(error);
  }
}

function createBoardObject(name) {
  return {
    id: id(),
    name,
    canvasWidth: DEFAULT_STAGE_WIDTH,
    canvasHeight: DEFAULT_STAGE_HEIGHT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getBoardPath(boardId) {
  const path = [];
  const visited = new Set();
  let board = boards.find((entry) => entry.id === boardId);
  while (board && !visited.has(board.id)) {
    visited.add(board.id);
    path.unshift(board);
    board = boards.find((entry) => entry.id === board.parentBoardId);
  }
  return path;
}

function renderBreadcrumbs() {
  const path = getBoardPath(activeBoardId);
  breadcrumbParents.replaceChildren();
  breadcrumbHome.onclick = () => {
    if (path[0]) void switchBoard(path[0].id);
  };
  path.slice(1, -1).forEach((board) => {
    const part = document.createElement('span');
    part.className = 'breadcrumb-parent-part';
    const divider = document.createElement('span');
    divider.className = 'breadcrumb-divider';
    divider.textContent = '/';
    const button = document.createElement('button');
    button.className = 'breadcrumb-parent';
    button.type = 'button';
    button.textContent = board.name;
    button.addEventListener('click', () => void switchBoard(board.id));
    part.append(divider, button);
    breadcrumbParents.append(part);
  });
}

function renderBoardList() {
  boardList.replaceChildren();
  const orderedBoards = [];
  const visited = new Set();
  function appendChildren(parentBoardId) {
    boards
      .filter((board) => (board.parentBoardId ?? null) === parentBoardId)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .forEach((board) => {
        if (visited.has(board.id)) return;
        visited.add(board.id);
        orderedBoards.push(board);
        appendChildren(board.id);
      });
  }
  appendChildren(null);
  boards.forEach((board) => {
    if (!visited.has(board.id)) orderedBoards.push(board);
  });
  for (const board of orderedBoards) {
    const row = document.createElement('div');
    row.className = `board-row${board.id === activeBoardId ? ' active' : ''}`;
    row.style.paddingLeft = `${Math.min(getBoardPath(board.id).length - 1, 8) * 13}px`;

    const button = document.createElement('button');
    button.className = 'board-row-button';
    button.type = 'button';
    const symbol = document.createElement('span');
    symbol.className = 'board-symbol';
    symbol.textContent = '▣';
    const name = document.createElement('span');
    name.textContent = board.name;
    button.append(symbol, name);
    button.addEventListener('click', () => switchBoard(board.id));

    const remove = document.createElement('button');
    remove.className = 'board-delete';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Excluir quadro';
    remove.setAttribute('aria-label', `Excluir quadro ${board.name}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void removeBoard(board.id);
    });

    row.append(button, remove);
    boardList.append(row);
  }
}

async function switchBoard(boardId) {
  if (activeBoardId === boardId) return;
  activeBoardId = boardId;
  historyPast = [];
  historyFuture = [];
  lastHistoryGroup = null;
  appClipboard = null;
  pasteAppClipboard = false;
  updateHistoryButtons();
  selectedId = null;
  activeTool = null;
  firstLinePoint = null;
  clearObjectUrls();
  try {
    elements = await getBoardElements(boardId);
    const board = boards.find((entry) => entry.id === boardId);
    setCanvasSize(board?.canvasWidth, board?.canvasHeight);
    boardTitle.value = board?.name ?? 'Meu quadro';
    if (board) {
      board.lastOpenedAt = Date.now();
      void saveBoard(board);
    }
    renderBreadcrumbs();
    renderBoardList();
    renderAll();
    updateSelectionTools();
    window.requestAnimationFrame(scrollToCanvasCenter);
  } catch (error) {
    reportStorageError(error);
  }
}

async function removeBoard(boardId) {
  if (boards.length <= 1) {
    showToast('Mantenha pelo menos um quadro no seu espaço.');
    return;
  }
  const board = boards.find((entry) => entry.id === boardId);
  if (!board || !window.confirm(`Excluir o quadro “${board.name}” e todo o seu conteúdo?`)) return;
  try {
    const removedIds = new Set([boardId]);
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      boards.forEach((entry) => {
        if (removedIds.has(entry.parentBoardId) && !removedIds.has(entry.id)) {
          removedIds.add(entry.id);
          foundChild = true;
        }
      });
    }
    if (boards.length - removedIds.size < 1) {
      showToast('Mantenha pelo menos um quadro no seu espaço.');
      return;
    }
    const deletedElementIds = elements
      .filter((entry) => removedIds.has(entry.boardId) || (entry.type === 'board' && removedIds.has(entry.targetBoardId)))
      .map((entry) => entry.id);
    deletedElementIds.forEach((elementId) => {
      const timer = saveTimers.get(elementId);
      if (timer) window.clearTimeout(timer);
      saveTimers.delete(elementId);
      pendingSaves.delete(elementId);
    });
    if (pendingSaves.size === 0) markSaved();
    const activeBoardRemoved = removedIds.has(activeBoardId);
    await deleteBoardData(removedIds);
    boards = boards.filter((entry) => !removedIds.has(entry.id));
    if (activeBoardRemoved) {
      activeBoardId = '';
      await switchBoard(boards.find((entry) => !entry.parentBoardId)?.id ?? boards[0].id);
    } else {
      elements = elements.filter((entry) => !(entry.type === 'board' && removedIds.has(entry.targetBoardId)));
      if (!elements.some((entry) => entry.id === selectedId)) selectedId = null;
      renderAll();
      updateSelectionTools();
      renderBreadcrumbs();
      renderBoardList();
    }
  } catch (error) {
    reportStorageError(error);
  }
}

async function addBoard() {
  const board = createBoardObject('Novo quadro');
  try {
    await storeValue('boards', 'put', board);
    boards.push(board);
    await switchBoard(board.id);
    boardTitle.focus();
    boardTitle.select();
  } catch (error) {
    reportStorageError(error);
  }
}

async function addNestedBoard(position) {
  const board = createBoardObject('Novo quadro');
  board.parentBoardId = activeBoardId;
  try {
    await storeValue('boards', 'put', board);
    boards.push(board);
    createElement('board', position, { targetBoardId: board.id });
    renderBoardList();
  } catch (error) {
    reportStorageError(error);
  }
}

function clearObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function setCanvasSize(width, height) {
  stageWidth = Number.isFinite(width) && width >= DEFAULT_STAGE_WIDTH ? width : DEFAULT_STAGE_WIDTH;
  stageHeight = Number.isFinite(height) && height >= DEFAULT_STAGE_HEIGHT ? height : DEFAULT_STAGE_HEIGHT;
  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  stageWrap.style.width = `${stageWidth * zoom}px`;
  stageWrap.style.height = `${stageHeight * zoom}px`;
  for (const svg of [connections, foregroundConnections]) {
    svg.style.width = `${stageWidth}px`;
    svg.style.height = `${stageHeight}px`;
    svg.setAttribute('viewBox', `0 0 ${stageWidth} ${stageHeight}`);
  }
}

function renderAll() {
  clearObjectUrls();
  itemsLayer.replaceChildren();
  foregroundItems.replaceChildren();
  connections.replaceChildren();
  foregroundConnections.replaceChildren();
  setCanvasSize(stageWidth, stageHeight);
  for (const element of elements) {
    if (element.containerId) continue;
    if (element.type === 'line') renderLine(element);
    else if (element.type === 'drawing') renderDrawing(element, element.layer === 'front' ? foregroundConnections : connections);
    else renderElement(element, element.layer === 'front' ? foregroundItems : itemsLayer);
  }
  emptyHint.hidden = elements.length > 0;
}

function renderElement(element, layer = itemsLayer, parentColumn = null) {
  const card = document.createElement('article');
  card.className = `board-item${selectedId === element.id ? ' selected' : ''}${element.customSize ? ' custom-size' : ''}${element.type === 'image' ? ' image-item' : ''}${element.type === 'column' ? ' column-item' : ''}${element.type === 'board' ? ' board-card' : ''}`;
  card.dataset.id = element.id;
  card.dataset.type = element.type;
  const offset = parentColumn ? getColumnContentOffset(parentColumn) : { x: 0, y: 0 };
  card.style.left = `${element.x - offset.x}px`;
  card.style.top = `${element.y - offset.y}px`;
  card.style.width = `${element.width}px`;
  card.style.height = ['image', 'column', 'board'].includes(element.type) || element.customSize ? `${element.height}px` : 'auto';
  if (element.type !== 'image') card.style.minHeight = element.customSize ? '40px' : `${{ note: 105, checklist: 125, link: 125, column: 150, board: 0 }[element.type]}px`;
  card.style.zIndex = String(parentColumn
    ? (element.layer === 'front' ? 1 : 0)
    : (element.layer === 'back' ? 0 : (element.z ?? 1)));
  if (['note', 'checklist', 'link', 'column'].includes(element.type)) {
    const background = CARD_BACKGROUNDS.has(element.background)
      ? element.background
      : (element.noteBackground ?? (element.type === 'column' ? '#f7f6f2' : '#fffefa'));
    card.dataset.background = background;
    if (background !== 'transparent') card.style.backgroundColor = background;
    if (element.type === 'column') card.style.borderColor = background === 'transparent' ? 'transparent' : background;
  }

  const top = document.createElement('div');
  top.className = 'item-topline';
  const kind = document.createElement('span');
  kind.className = 'item-kind';
  kind.textContent = { note: 'ANOTAÇÃO', checklist: 'CHECKLIST', link: 'LINK', image: 'IMAGEM', column: 'COLUNA', board: 'QUADRO' }[element.type];
  const remove = document.createElement('button');
  remove.className = 'item-delete';
  remove.type = 'button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Excluir item');
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    void deleteElement(element.id);
  });
  top.append(kind, remove);
  top.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button,[contenteditable="true"]')) return;
    startDrag(event, element, card);
  });
  card.append(top);

  if (element.type === 'note') renderNote(element, card);
  if (element.type === 'checklist') renderChecklist(element, card);
  if (element.type === 'link') renderLink(element, card);
  if (element.type === 'image') renderImage(element, card);
  if (element.type === 'column') renderColumn(element, card, top, kind, remove);
  if (element.type === 'board') renderBoardCard(element, card);
  applyTextStyle(element, card);
  const resize = document.createElement('span');
  resize.className = 'resize-handle';
  resize.setAttribute('role', 'button');
  resize.setAttribute('aria-label', `Redimensionar ${element.type}`);
  resize.addEventListener('pointerdown', (event) => startResize(event, element, card));
  card.append(resize);

  card.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button,input,[contenteditable="true"],a')) return;
    selectElement(element.id);
  });
  card.addEventListener('click', (event) => {
    if (activeTool === 'draw') return;
    if (event.target.closest('button,input,[contenteditable="true"],a')) return;
    if (element.type === 'board') {
      if (suppressBoardOpen) return;
      const childBoard = boards.find((board) => board.id === element.targetBoardId);
      if (!childBoard) {
        showToast('Este quadro não está mais disponível.');
        return;
      }
      void switchBoard(childBoard.id);
      return;
    }
    selectElement(element.id);
  });
  layer.append(card);
}

function renderBoardCard(element, card) {
  const board = boards.find((entry) => entry.id === element.targetBoardId);
  const cover = document.createElement('div');
  cover.className = 'board-card-cover';
  cover.setAttribute('role', 'group');
  cover.setAttribute('aria-label', `Capa do quadro ${board?.name ?? 'indisponível'}`);
  cover.tabIndex = 0;
  if (board?.coverBlob instanceof Blob) {
    const image = document.createElement('img');
    const objectUrl = URL.createObjectURL(board.coverBlob);
    objectUrls.push(objectUrl);
    image.src = objectUrl;
    image.alt = `Capa do quadro ${board.name}`;
    image.draggable = false;
    cover.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'board-card-placeholder';
    const icon = document.createElement('span');
    icon.className = 'board-icon-large';
    icon.textContent = '▣';
    const prompt = document.createElement('span');
    prompt.textContent = board ? 'Adicionar ou colar foto' : 'Quadro indisponível';
    placeholder.append(icon, prompt);
    cover.append(placeholder);
  }

  if (board) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.setAttribute('aria-label', 'Escolher foto para o quadro');
    const chooseCover = document.createElement('button');
    chooseCover.className = 'board-cover-button';
    chooseCover.type = 'button';
    chooseCover.textContent = board.coverBlob ? 'Trocar foto' : 'Adicionar foto';
    chooseCover.title = 'Escolher uma foto do computador';
    chooseCover.addEventListener('click', (event) => {
      event.stopPropagation();
      input.click();
    });
    input.addEventListener('change', async () => {
      const image = parseImageFiles(input.files)[0];
      if (!image) {
        input.value = '';
        return;
      }
      await updateBoardCover(board, image);
    });
    const pasteCover = document.createElement('button');
    pasteCover.className = 'board-cover-button';
    pasteCover.type = 'button';
    pasteCover.textContent = 'Colar foto';
    pasteCover.title = 'Usar a imagem da área de transferência';
    pasteCover.addEventListener('click', (event) => {
      event.stopPropagation();
      void pasteBoardCover(board);
    });
    const coverControls = document.createElement('div');
    coverControls.className = 'board-cover-controls';
    coverControls.append(chooseCover, pasteCover);
    cover.append(coverControls, input);
  }
  cover.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button,input')) return;
    startDrag(event, element, card);
  });
  cover.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (board) void switchBoard(board.id);
  });

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.contentEditable = board ? 'true' : 'false';
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Título do quadro');
  title.textContent = board?.name ?? 'Quadro indisponível';
  title.addEventListener('focus', () => selectElement(element.id));
  title.addEventListener('input', () => {
    if (!board) return;
    board.name = title.textContent.trim() || 'Novo quadro';
    board.updatedAt = Date.now();
    void saveBoard(board);
  });
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      title.blur();
    }
  });
  title.addEventListener('blur', () => {
    if (!board) return;
    title.textContent = board.name;
    renderBoardList();
  });
  card.append(cover, title);
}

async function updateBoardCover(board, image) {
  if (!(image instanceof Blob) || !image.type.startsWith('image/')) return;
  board.coverBlob = image;
  board.updatedAt = Date.now();
  await saveBoard(board);
  renderAll();
  updateSelectionTools();
}

async function pasteBoardCover(board) {
  try {
    const [image] = await readImageFilesFromClipboard();
    if (!image) {
      showToast('A área de transferência não contém uma imagem.');
      return;
    }
    await updateBoardCover(board, image);
  } catch (error) {
    console.error('Falha ao colar a capa do quadro:', error);
    showToast('Não foi possível ler a imagem da área de transferência. Use Adicionar foto.');
  }
}

function renderNote(element, card) {
  const body = document.createElement('div');
  body.className = `note-body${element.quote ? ' quoted' : ''}`;
  body.contentEditable = 'true';
  body.setAttribute('role', 'textbox');
  body.setAttribute('aria-label', 'Texto da anotação');
  body.dataset.placeholder = 'Escreva uma ideia…';
  body.spellcheck = true;
  body.textContent = element.text ?? '';
  body.style.color = element.color ?? (element.noteBackground === 'transparent' ? '#e4e6e8' : '#343b45');
  body.addEventListener('input', () => {
    recordHistory(`text:${element.id}:note`);
    element.text = body.textContent;
    scheduleSaveElement(element);
  });
  body.addEventListener('focus', () => selectElement(element.id));
  card.append(body);
}

function renderChecklist(element, card) {
  const list = document.createElement('div');
  list.className = 'checklist-items';
  element.tasks ??= [{ text: '', done: false }];
  const isComplete = () => element.tasks.length > 0 && element.tasks.every((task) => task.done);
  element.tasks.forEach((task, index) => {
    const row = document.createElement('div');
    row.className = `checklist-row${task.done ? ' done' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', 'Marcar tarefa como concluída');
    checkbox.addEventListener('focus', () => selectElement(element.id));
    checkbox.addEventListener('change', () => {
      recordHistory();
      selectElement(element.id);
      task.done = checkbox.checked;
      row.classList.toggle('done', task.done);
      add.hidden = isComplete();
      scheduleSaveElement(element);
    });
    const text = document.createElement('div');
    text.contentEditable = 'true';
    text.textContent = task.text;
    text.style.color = element.color ?? '#343b45';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', 'Tarefa');
    text.addEventListener('focus', () => selectElement(element.id));
    text.addEventListener('input', () => {
      recordHistory(`text:${element.id}:task:${index}`);
      task.text = text.textContent;
      scheduleSaveElement(element);
    });
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        recordHistory();
        element.tasks.splice(index + 1, 0, { text: '', done: false });
        renderAll();
        const newText = stage.querySelector(`[data-id="${element.id}"] .checklist-row:nth-child(${index + 2}) [contenteditable="true"]`);
        newText?.focus();
        selectElement(element.id);
      }
      if (event.key === 'Backspace' && !text.textContent && element.tasks.length > 1) {
        event.preventDefault();
        recordHistory();
        element.tasks.splice(index, 1);
        renderAll();
        selectElement(element.id);
      }
    });
    row.append(checkbox, text);
    list.append(row);
  });
  const add = document.createElement('div');
  add.className = 'checklist-add';
  add.hidden = isComplete();
  add.contentEditable = 'true';
  add.setAttribute('role', 'textbox');
  add.setAttribute('aria-label', 'Adicionar tarefa');
  add.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = add.textContent.trim();
    if (!text) return;
    recordHistory();
    element.tasks.push({ text, done: false });
    renderAll();
    selectElement(element.id);
    stage.querySelector(`[data-id="${element.id}"] .checklist-add`)?.focus();
  });
  card.append(list, add);
}

function renderLink(element, card) {
  const content = document.createElement('div');
  content.className = 'link-card';
  const title = document.createElement('div');
  title.className = 'link-title';
  title.contentEditable = 'true';
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Título do link');
  title.textContent = element.title || 'Novo link';
  title.addEventListener('focus', () => selectElement(element.id));
  title.addEventListener('input', () => {
    recordHistory(`text:${element.id}:link-title`);
    element.title = title.textContent;
    scheduleSaveElement(element);
  });
  const url = document.createElement('div');
  url.className = 'link-url';
  url.contentEditable = 'true';
  url.setAttribute('role', 'textbox');
  url.setAttribute('aria-label', 'Endereço do link');
  url.textContent = element.url || 'Cole ou digite uma URL';
  url.addEventListener('focus', () => selectElement(element.id));
  url.addEventListener('input', () => {
    recordHistory(`text:${element.id}:link-url`);
    element.url = url.textContent;
    const externalUrl = safeExternalUrl(element.url);
    open.href = externalUrl ?? '#';
    open.hidden = !externalUrl;
    scheduleSaveElement(element);
  });
  const open = document.createElement('a');
  open.className = 'link-open';
  open.href = safeExternalUrl(element.url) ?? '#';
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.textContent = 'Abrir link ↗';
  open.hidden = !safeExternalUrl(element.url);
  content.append(title, url, open);
  card.append(content);
}

function renderImage(element, card) {
  if (!(element.blob instanceof Blob)) return;
  const image = document.createElement('img');
  const objectUrl = URL.createObjectURL(element.blob);
  objectUrls.push(objectUrl);
  image.draggable = false;
  image.src = objectUrl;
  image.alt = element.name || 'Imagem colada no quadro';
  image.title = 'Clique duas vezes para abrir a imagem';
  card.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    imageViewerContent.src = image.src;
    imageViewerContent.alt = image.alt;
    imageViewer.showModal();
  });
  image.addEventListener('load', () => {
    if (element.customSize || !image.naturalWidth || !image.naturalHeight) return;
    const previousHeight = element.height;
    const height = element.width * image.naturalHeight / image.naturalWidth;
    if (Math.abs(element.height - height) < 1) return;
    element.height = height;
    element.y = Math.max(0, element.y + (previousHeight - height) / 2);
    card.style.top = `${element.y - getElementOffset(element).y}px`;
    card.style.height = `${height}px`;
    scheduleSaveElement(element);
  }, { once: true });
  image.addEventListener('pointerdown', (event) => startDrag(event, element, card));
  image.addEventListener('dragstart', (event) => event.preventDefault());
  card.append(image);
}

function applyTextStyle(element, card) {
  const family = FONT_FAMILIES.has(element.fontFamily) ? element.fontFamily : 'Segoe UI';
  const defaultSize = { note: 16, checklist: 14, link: 14, column: 13 }[element.type] ?? 16;
  const size = Math.max(6, Math.min(300, Number(element.fontSize) || defaultSize));
  card.querySelector('.note-body')?.classList.toggle('quoted', Boolean(element.quote));
  const textNodes = card.querySelectorAll('.note-body,.checklist-row [contenteditable="true"],.checklist-add,.link-title,.link-url,.link-open,.column-title');
  textNodes.forEach((node) => {
    node.style.fontFamily = `"${family}", sans-serif`;
    node.style.fontWeight = element.bold ? '700' : (node.classList.contains('link-title') || node.classList.contains('column-title') ? '600' : '400');
    node.style.fontStyle = element.italic || (element.type === 'note' && element.quote) ? 'italic' : 'normal';
    if (node.classList.contains('link-url')) node.style.fontSize = `${Math.max(8, Math.round(size * 0.8))}px`;
    else node.style.fontSize = `${size}px`;
    node.style.color = element.color ?? (element.background === 'transparent' || element.noteBackground === 'transparent' ? '#e4e6e8' : '#343b45');
  });
}

function lineControlPoint(element) {
  return {
    x: element.controlX ?? (element.x1 + element.x2) / 2,
    y: element.controlY ?? (element.y1 + element.y2) / 2,
  };
}

function linePointAtHalf(element) {
  const control = lineControlPoint(element);
  return {
    x: (element.x1 + 2 * control.x + element.x2) / 4,
    y: (element.y1 + 2 * control.y + element.y2) / 4,
  };
}

function linePathData(element, offset) {
  const control = lineControlPoint(element);
  return `M ${element.x1 - offset.x} ${element.y1 - offset.y} Q ${control.x - offset.x} ${control.y - offset.y} ${element.x2 - offset.x} ${element.y2 - offset.y}`;
}

function ensureArrowhead(layer) {
  if (layer.querySelector('defs')) return layer.dataset.arrowMarkerId;
  const markerId = layer.dataset.parentColumnId
    ? `arrowhead-${layer.dataset.parentColumnId}`
    : 'arrowhead';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.id = markerId;
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrow.setAttribute('fill', '#8998a2');
  marker.append(arrow);
  defs.append(marker);
  layer.append(defs);
  layer.dataset.arrowMarkerId = markerId;
  return markerId;
}

function renderLineHandles(element, layer, offset) {
  layer.querySelector(`.line-handles[data-id="${element.id}"]`)?.remove();
  if (selectedId !== element.id) return;
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'line-handles');
  group.dataset.id = element.id;
  const handles = [
    { mode: 'line-start', point: { x: element.x1, y: element.y1 }, className: 'line-endpoint-handle' },
    { mode: 'line-bend', point: linePointAtHalf(element), className: 'line-bend-handle' },
    { mode: 'line-end', point: { x: element.x2, y: element.y2 }, className: 'line-endpoint-handle' },
  ];
  for (const handle of handles) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', `line-handle ${handle.className}`);
    circle.setAttribute('cx', String(handle.point.x - offset.x));
    circle.setAttribute('cy', String(handle.point.y - offset.y));
    circle.setAttribute('r', '6');
    circle.dataset.mode = handle.mode;
    circle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      startLineDrag(event, element, handle.mode, layer);
    });
    group.append(circle);
  }
  layer.append(group);
}

function renderLine(element, layer = connections, offset = { x: 0, y: 0 }) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', linePathData(element, offset));
  path.setAttribute('class', `connection-path${selectedId === element.id ? ' selected' : ''}`);
  path.setAttribute('marker-end', `url(#${ensureArrowhead(layer)})`);
  path.dataset.id = element.id;
  path.addEventListener('pointerdown', (event) => {
    selectElement(element.id);
    startLineDrag(event, element, 'line-move', layer);
  });
  path.addEventListener('click', (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  layer.append(path);
  renderLineHandles(element, layer, offset);
}

function drawingPathData(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function renderDrawing(element, layer = connections, offset = { x: 0, y: 0 }) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', drawingPathData(element.points.map((point) => ({
    x: point.x - offset.x,
    y: point.y - offset.y,
  }))));
  path.setAttribute('class', `drawing-path${selectedId === element.id ? ' selected' : ''}`);
  path.setAttribute('stroke', element.color);
  path.setAttribute('stroke-width', String(element.width));
  path.dataset.id = element.id;
  path.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  path.addEventListener('click', (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  layer.append(path);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function selectElement(elementId) {
  selectedId = elementId;
  stage.querySelectorAll('.board-item').forEach((card) => {
    card.classList.toggle('selected', card.dataset.id === elementId);
  });
  stage.querySelectorAll('.connection-path,.drawing-path').forEach((path) => {
    path.classList.toggle('selected', path.dataset.id === elementId);
  });
  stage.querySelectorAll('.line-handles').forEach((handles) => {
    if (handles.dataset.id !== elementId) handles.remove();
  });
  const element = elements.find((entry) => entry.id === elementId);
  if (element?.type === 'line') {
    const path = [...stage.querySelectorAll('.connection-path')]
      .find((entry) => entry.dataset.id === elementId);
    if (path) renderLineHandles(element, path.closest('svg'), getElementOffset(element));
  }
  updateSelectionTools();
}

function updateSelectionTools() {
  const element = elements.find((entry) => entry.id === selectedId);
  const textElement = element && ['note', 'checklist', 'link', 'column'].includes(element.type);
  selectionTools.hidden = !element || element.type === 'line' || activeTool === 'draw';
  document.querySelector('#element-layer-options').hidden = element?.type === 'line';
  backgroundOptions.hidden = !textElement;
  textFormatOptions.hidden = !textElement;
  document.querySelector('#quote-text').hidden = element?.type !== 'note';
  document.querySelector('#text-color-label').hidden = !textElement;
  document.querySelector('.color-options[aria-label="Cor do texto"]').hidden = !textElement;
  document.querySelector('#font-smaller').hidden = !textElement;
  document.querySelector('#font-larger').hidden = !textElement;
  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.classList.toggle('selected', swatch.dataset.color === (element?.color ?? '#343b45'));
  });
  const background = element?.background ?? element?.noteBackground ?? (element?.type === 'column' ? '#f7f6f2' : '#fffefa');
  document.querySelectorAll('.background-swatch').forEach((swatch) => {
    swatch.classList.toggle('selected', swatch.dataset.background === background);
  });
  const fontFamily = document.querySelector('#font-family');
  if (element && FONT_FAMILIES.has(element.fontFamily)) fontFamily.value = element.fontFamily;
  else fontFamily.value = 'Segoe UI';
  document.querySelector('#font-size-input').value = element && element.type !== 'image'
    ? String(element.fontSize ?? { note: 16, checklist: 14, link: 14, column: 13 }[element.type] ?? 16)
    : '';
  document.querySelector('#bold-text').setAttribute('aria-pressed', String(Boolean(element?.bold)));
  document.querySelector('#italic-text').setAttribute('aria-pressed', String(Boolean(element?.italic)));
  document.querySelector('#quote-text').setAttribute('aria-pressed', String(Boolean(element?.quote)));
  const elementLayer = document.querySelector('#element-layer');
  elementLayer.querySelector('option[value="default"]').hidden = element?.type === 'drawing';
  elementLayer.value = ['front', 'back'].includes(element?.layer)
    ? element.layer
    : (element?.type === 'drawing' ? 'back' : 'default');
  document.querySelector('#element-width').value = element && element.type !== 'line' ? String(Math.round(element.width ?? 0)) : '';
  const selectedCard = element && element.type !== 'line' ? stage.querySelector(`.board-item[data-id="${element.id}"]`) : null;
  const displayedHeight = selectedCard && !element.customSize && element.type !== 'image'
    ? selectedCard.getBoundingClientRect().height / zoom
    : element?.height;
  document.querySelector('#element-height').value = element && element.type !== 'line' ? String(Math.round(displayedHeight ?? 0)) : '';
  document.querySelectorAll('.format-toggle').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('aria-pressed') === 'true');
  });
  document.querySelectorAll('.tool-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === activeTool);
  });
  drawingTools.hidden = activeTool !== 'draw';
  updateHistoryButtons();
  viewport.classList.toggle('drawing', activeTool === 'draw');
  eraserButton.setAttribute('aria-pressed', String(drawingSettings.eraser));
  document.querySelectorAll('.draw-color-swatch').forEach((button) => {
    button.classList.toggle('selected', button.dataset.drawColor === drawingSettings.color);
  });
  document.querySelectorAll('.draw-size-button').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.drawSize) === drawingSettings.width);
  });
  document.querySelector('#drawing-layer').addEventListener('change', (event) => {
    drawingSettings.layer = event.currentTarget.value;
  });
  lineHint.hidden = activeTool !== 'line';
}

function canvasCoordinates(clientX, clientY) {
  const bounds = stage.getBoundingClientRect();
  return { x: (clientX - bounds.left) / zoom, y: (clientY - bounds.top) / zoom };
}

function viewportCenter() {
  const bounds = viewport.getBoundingClientRect();
  return canvasCoordinates(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
}

function createElement(type, position, extra = {}, { focus = true } = {}) {
  const container = findColumnAtPosition(position);
  const dimensions = {
    note: { width: 245, height: 170 },
    checklist: { width: 245, height: 185 },
    link: { width: 270, height: 135 },
    image: { width: 280, height: 220 },
    column: { width: 310, height: 440 },
    board: { width: 190, height: 232 },
  }[type];
  const element = {
    id: id(),
    boardId: activeBoardId,
    type,
    x: Math.max(0, position.x - dimensions.width / 2),
    y: Math.max(0, position.y - dimensions.height / 2),
    ...dimensions,
    z: type === 'column' ? 0 : Date.now(),
    createdAt: Date.now(),
    ...(type !== 'image' ? {
      background: type === 'column' ? '#f7f6f2' : '#fffefa',
      fontFamily: 'Segoe UI',
      autoContrastText: true,
    } : {}),
    ...extra,
    ...(container ? { containerId: container.id } : {}),
  };
  if (container) constrainElementToColumn(element, container);
  recordHistory();
  elements.push(element);
  selectedId = element.id;
  renderAll();
  const renderedCard = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (renderedCard && ['note', 'checklist', 'link'].includes(type) && !element.customSize) {
    element.y = Math.max(0, position.y - renderedCard.offsetHeight / 2);
    renderedCard.style.top = `${element.y - getElementOffset(element).y}px`;
  }
  animateNewElement(element.id);
  updateSelectionTools();
  scheduleSaveElement(element);
  if (focus && type === 'note') {
    const editor = stage.querySelector(`[data-id="${element.id}"] .note-body`);
    editor?.focus();
  }
  return element;
}

async function addImage(blob, position = viewportCenter(), name = 'Imagem') {
  if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) return;
  createElement('image', position, { blob, name, width: 280, height: 220 });
  showToast('Imagem salva localmente no quadro.');
}

async function deleteElement(elementId, historyGroup = null) {
  const removedElement = elements.find((entry) => entry.id === elementId);
  if (!removedElement) return;
  const pendingTimer = saveTimers.get(elementId);
  if (pendingTimer) window.clearTimeout(pendingTimer);
  saveTimers.delete(elementId);
  pendingSaves.delete(elementId);
  recordHistory(historyGroup);
  if (removedElement.type === 'column') {
    elements
      .filter((entry) => entry.containerId === removedElement.id)
      .forEach((entry) => { delete entry.containerId; });
  }
  elements = elements.filter((entry) => entry.id !== elementId);
  if (selectedId === elementId) selectedId = null;
  renderAll();
  updateSelectionTools();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('elements', 'readwrite');
      const completion = transactionDone(transaction);
      transaction.objectStore('elements').delete(elementId);
      completion.then(resolve, reject);
    });
    if (pendingSaves.size === 0) markSaved();
  } catch (error) {
    reportStorageError(error);
  }
}

function startDrag(event, element, card) {
  if (event.button !== 0) return;
  if (!['image', 'board'].includes(element.type)) event.preventDefault();
  event.stopPropagation();
  selectElement(element.id);
  dragState = {
    mode: 'move',
    id: element.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: element.x,
    originY: element.y,
    moved: false,
    card,
  };
  card.setPointerCapture(event.pointerId);
  card.addEventListener('pointermove', movePointer);
  card.addEventListener('pointerup', endPointer, { once: true });
  card.addEventListener('pointercancel', endPointer, { once: true });
}

function startLineDrag(event, element, mode, layer) {
  if (event.button !== 0 || dragState) return;
  event.preventDefault();
  event.stopPropagation();
  firstLinePoint = null;
  selectElement(element.id);
  dragState = {
    mode,
    id: element.id,
    startX: event.clientX,
    startY: event.clientY,
    origin: {
      x1: element.x1,
      y1: element.y1,
      x2: element.x2,
      y2: element.y2,
      ...lineControlPoint(element),
    },
    moved: false,
    card: layer,
  };
  layer.setPointerCapture(event.pointerId);
  layer.addEventListener('pointermove', movePointer);
  layer.addEventListener('pointerup', endPointer, { once: true });
  layer.addEventListener('pointercancel', endPointer, { once: true });
}

function startResize(event, element, card) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectElement(element.id);
  dragState = {
    mode: 'resize',
    id: element.id,
    startX: event.clientX,
    startY: event.clientY,
    originWidth: card.getBoundingClientRect().width / zoom,
    originHeight: card.getBoundingClientRect().height / zoom,
    card,
  };
  card.setPointerCapture(event.pointerId);
  card.addEventListener('pointermove', movePointer);
  card.addEventListener('pointerup', endPointer, { once: true });
  card.addEventListener('pointercancel', endPointer, { once: true });
}

function movePointer(event) {
  if (!dragState) return;
  const element = elements.find((entry) => entry.id === dragState.id);
  if (!element) return;
  if (dragState.mode.startsWith('line-')) {
    event.preventDefault();
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance <= 4 && !dragState.moved) return;
    if (!dragState.moved) recordHistory();
    dragState.moved = true;
    const point = canvasCoordinates(event.clientX, event.clientY);
    let dx = (event.clientX - dragState.startX) / zoom;
    let dy = (event.clientY - dragState.startY) / zoom;
    if (dragState.mode === 'line-move') {
      dx = Math.max(-Math.min(dragState.origin.x1, dragState.origin.x2), Math.min(dx, stageWidth - Math.max(dragState.origin.x1, dragState.origin.x2)));
      dy = Math.max(-Math.min(dragState.origin.y1, dragState.origin.y2), Math.min(dy, stageHeight - Math.max(dragState.origin.y1, dragState.origin.y2)));
      element.x1 = dragState.origin.x1 + dx;
      element.y1 = dragState.origin.y1 + dy;
      element.x2 = dragState.origin.x2 + dx;
      element.y2 = dragState.origin.y2 + dy;
      element.controlX = dragState.origin.x + dx;
      element.controlY = dragState.origin.y + dy;
    } else if (dragState.mode === 'line-start') {
      element.x1 = Math.max(0, Math.min(stageWidth, point.x));
      element.y1 = Math.max(0, Math.min(stageHeight, point.y));
      if (Number.isFinite(element.controlX)) element.controlX += element.x1 - point.x;
      if (Number.isFinite(element.controlY)) element.controlY += element.y1 - point.y;
    } else if (dragState.mode === 'line-end') {
      element.x2 = Math.max(0, Math.min(stageWidth, point.x));
      element.y2 = Math.max(0, Math.min(stageHeight, point.y));
      if (Number.isFinite(element.controlX)) element.controlX += element.x2 - point.x;
      if (Number.isFinite(element.controlY)) element.controlY += element.y2 - point.y;
    } else {
      element.controlX = Math.max(0, Math.min(stageWidth, 2 * point.x - (element.x1 + element.x2) / 2));
      element.controlY = Math.max(0, Math.min(stageHeight, 2 * point.y - (element.y1 + element.y2) / 2));
    }
    updateLineVisual(element);
    return;
  }
  if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 4) {
    if (!dragState.moved) recordHistory();
    dragState.moved = true;
  }
  if (dragState.mode === 'move') {
    const previousX = element.x;
    const previousY = element.y;
    element.x = Math.max(0, dragState.originX + (event.clientX - dragState.startX) / zoom);
    element.y = Math.max(0, dragState.originY + (event.clientY - dragState.startY) / zoom);
    const parentColumn = getElementContainer(element);
    const offset = parentColumn ? getColumnContentOffset(parentColumn) : { x: 0, y: 0 };
    dragState.card.style.left = `${element.x - offset.x}px`;
    dragState.card.style.top = `${element.y - offset.y}px`;
    if (element.type === 'column') {
      translateColumnContents(element.id, element.x - previousX, element.y - previousY);
    }
    const dropTarget = element.type === 'column'
      ? null
      : findColumnAtPosition(canvasCoordinates(event.clientX, event.clientY), element.id);
    stage.querySelectorAll('.column-item').forEach((columnCard) => {
      columnCard.classList.toggle('drop-target', columnCard.dataset.id === dropTarget?.id);
    });
  } else {
    const widthChange = (event.clientX - dragState.startX) / zoom;
    const heightChange = (event.clientY - dragState.startY) / zoom;
    if (element.type === 'image') {
      const scale = Math.max(
        40 / dragState.originWidth,
        40 / dragState.originHeight,
        1 + widthChange / dragState.originWidth,
        1 + heightChange / dragState.originHeight,
      );
      element.width = dragState.originWidth * scale;
      element.height = dragState.originHeight * scale;
    } else {
      element.width = Math.max(40, dragState.originWidth + widthChange);
      element.height = Math.max(40, dragState.originHeight + heightChange);
    }
    element.customSize = true;
    dragState.card.classList.add('custom-size');
    dragState.card.style.width = `${element.width}px`;
    dragState.card.style.height = `${element.height}px`;
    if (element.type !== 'image') dragState.card.style.minHeight = '40px';
    if (element.type === 'column') updateColumnConnections(element, dragState.card);
  }
}

function endPointer(event) {
  const state = dragState;
  if (!state) return;
  state.card.removeEventListener('pointermove', movePointer);
  state.card.removeEventListener('pointerup', endPointer);
  state.card.removeEventListener('pointercancel', endPointer);
  const element = elements.find((entry) => entry.id === state.id);
  let shouldRender = false;
  if (element?.type === 'line') {
    if (state.moved) {
      if (state.mode === 'line-move') {
        const midpoint = linePointAtHalf(element);
        const targetColumn = findColumnAtPosition(midpoint, element.id);
        if (element.containerId !== targetColumn?.id) {
          if (targetColumn) element.containerId = targetColumn.id;
          else delete element.containerId;
        }
      }
      scheduleSaveElement(element);
      shouldRender = true;
    }
  } else if (element) {
    if (state.mode === 'move' && element.type !== 'column' && state.moved) {
      const point = canvasCoordinates(event.clientX, event.clientY);
      const targetColumn = findColumnAtPosition(point, element.id);
      const nextContainerId = targetColumn?.id;
      if (element.containerId !== nextContainerId) {
        if (nextContainerId) element.containerId = nextContainerId;
        else delete element.containerId;
        if (targetColumn && element.type !== 'line' && element.type !== 'drawing') {
          constrainElementToColumn(element, targetColumn);
        }
        shouldRender = true;
      }
    }
    scheduleSaveElement(element);
  }
  stage.querySelectorAll('.column-item.drop-target').forEach((columnCard) => {
    columnCard.classList.remove('drop-target');
  });
  if (state.moved && element?.type === 'board') {
    suppressBoardOpen = true;
    window.setTimeout(() => { suppressBoardOpen = false; }, 250);
  }
  dragState = null;
  if (event.pointerId !== undefined && state.card.hasPointerCapture(event.pointerId)) {
    state.card.releasePointerCapture(event.pointerId);
  }
  if (shouldRender) {
    renderAll();
    updateSelectionTools();
  }
}

function setZoom(value) {
  const centerBefore = viewportCenter();
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  stage.style.transform = `scale(${zoom})`;
  stageWrap.style.width = `${stageWidth * zoom}px`;
  stageWrap.style.height = `${stageHeight * zoom}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  const centerAfter = viewportCenter();
  viewport.scrollLeft += (centerBefore.x - centerAfter.x) * zoom;
  viewport.scrollTop += (centerBefore.y - centerAfter.y) * zoom;
}

function scrollToCanvasCenter() {
  viewport.scrollLeft = Math.max(0, stageWidth * zoom / 2 - viewport.clientWidth / 2);
  viewport.scrollTop = Math.max(0, stageHeight * zoom / 2 - viewport.clientHeight / 2);
}

function createLine(start, end) {
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const container = findColumnAtPosition(midpoint);
  const line = {
    id: id(),
    boardId: activeBoardId,
    type: 'line',
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    ...(container ? { containerId: container.id } : {}),
  };
  recordHistory();
  elements.push(line);
  selectedId = line.id;
  firstLinePoint = null;
  renderAll();
  connections.querySelector(`[data-id="${line.id}"]`)?.classList.add('item-arriving');
  updateSelectionTools();
  scheduleSaveElement(line);
}

function createDrawingPath(element) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const container = getElementContainer(element);
  const layer = container
    ? stage.querySelector(`.${element.layer === 'front' ? 'column-foreground-connections' : 'column-connections'}[data-parent-column-id="${container.id}"]`)
    : (element.layer === 'front' ? foregroundConnections : connections);
  const offset = getElementOffset(element);
  path.setAttribute('class', 'drawing-path');
  path.setAttribute('stroke', element.color);
  path.setAttribute('stroke-width', String(element.width));
  path.setAttribute('d', drawingPathData(element.points.map((point) => ({
    x: point.x - offset.x,
    y: point.y - offset.y,
  }))));
  path.dataset.id = element.id;
  path.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  path.addEventListener('click', (event) => {
    event.stopPropagation();
    selectElement(element.id);
  });
  layer.append(path);
  return path;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + fraction * dx), point.y - (start.y + fraction * dy));
}

function eraseDrawingAt(point) {
  const radius = drawingSettings.width / 2;
  const erased = elements
    .filter((element) => element.type === 'drawing')
    .filter((element) => {
      const points = element.points;
      if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= radius + element.width / 2;
      return points.slice(1).some((end, index) => pointToSegmentDistance(point, points[index], end) <= radius + element.width / 2);
    })
    .map((element) => element.id);
  erased.forEach((elementId) => void deleteElement(elementId, activeStroke?.historyGroup));
}

function startFreehand(event) {
  if (activeTool !== 'draw' || event.button !== 0 || event.target.closest('.tool-dock,.drawing-tools,.selection-tools')) return;
  event.preventDefault();
  event.stopPropagation();
  const point = canvasCoordinates(event.clientX, event.clientY);
  if (drawingSettings.eraser) {
    activeStroke = { pointerId: event.pointerId, erasing: true, previousPoint: point, historyGroup: `erase:${id()}` };
    eraseDrawingAt(point);
  } else {
    const container = findColumnAtPosition(point);
    const stroke = {
      id: id(),
      boardId: activeBoardId,
      type: 'drawing',
      color: drawingSettings.color,
      width: drawingSettings.width,
      layer: drawingSettings.layer,
      points: [point],
      createdAt: Date.now(),
      ...(container ? { containerId: container.id } : {}),
    };
    recordHistory();
    elements.push(stroke);
    const path = createDrawingPath(stroke);
    activeStroke = { pointerId: event.pointerId, element: stroke, path };
  }
  viewport.setPointerCapture(event.pointerId);
  viewport.addEventListener('pointermove', continueFreehand);
  window.addEventListener('pointerup', finishFreehand, { once: true });
  window.addEventListener('pointercancel', finishFreehand, { once: true });
}

function continueFreehand(event) {
  const stroke = activeStroke;
  if (!stroke || stroke.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = canvasCoordinates(event.clientX, event.clientY);
  if (stroke.erasing) {
    const distance = Math.hypot(point.x - stroke.previousPoint.x, point.y - stroke.previousPoint.y);
    const steps = Math.min(100, Math.ceil(distance / Math.max(1, drawingSettings.width / 2)));
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      eraseDrawingAt({
        x: stroke.previousPoint.x + (point.x - stroke.previousPoint.x) * fraction,
        y: stroke.previousPoint.y + (point.y - stroke.previousPoint.y) * fraction,
      });
    }
    stroke.previousPoint = point;
    return;
  }
  const previous = stroke.element.points.at(-1);
  if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
  stroke.element.points.push(point);
  const offset = getElementOffset(stroke.element);
  stroke.path.setAttribute('d', drawingPathData(stroke.element.points.map((entry) => ({
    x: entry.x - offset.x,
    y: entry.y - offset.y,
  }))));
}

function finishFreehand(event) {
  const stroke = activeStroke;
  if (!stroke || stroke.pointerId !== event.pointerId) return;
  viewport.removeEventListener('pointermove', continueFreehand);
  if (!stroke.erasing) scheduleSaveElement(stroke.element);
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  activeStroke = null;
}

function animateNewElement(elementId) {
  const card = stage.querySelector(`.board-item[data-id="${elementId}"]`);
  if (!card) return;
  card.classList.add('item-arriving');
  window.setTimeout(() => card.classList.remove('item-arriving'), 260);
}

function pointerIsInsideViewport(clientX, clientY) {
  const bounds = viewport.getBoundingClientRect();
  return clientX >= bounds.left && clientX <= bounds.right
    && clientY >= bounds.top && clientY <= bounds.bottom;
}

function startToolbarDrag(event, button, action) {
  if (event.button !== 0 || toolbarDragState) return;
  toolbarDragState = {
    button,
    action,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragged: false,
  };
  button.setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', moveToolbarDrag);
  window.addEventListener('pointerup', finishToolbarDrag);
  window.addEventListener('pointercancel', cancelToolbarDrag);
}

function moveToolbarDrag(event) {
  const state = toolbarDragState;
  if (!state || event.pointerId !== state.pointerId) return;
  if (!state.dragged && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 8) return;
  event.preventDefault();
  if (!state.dragged) {
    state.dragged = true;
    activeTool = null;
    firstLinePoint = null;
    const ghost = document.createElement('div');
    ghost.className = 'tool-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const icon = state.button.querySelector('.tool-icon')?.cloneNode(true);
    const label = document.createElement('span');
    label.textContent = state.button.querySelector('span:last-child')?.textContent.trim() ?? 'Mover';
    if (icon) ghost.append(icon);
    ghost.append(label);
    document.body.append(ghost);
    toolbarDragGhost = ghost;
    updateSelectionTools();
  }
  toolbarDragGhost.style.left = `${event.clientX}px`;
  toolbarDragGhost.style.top = `${event.clientY}px`;
  toolbarDragGhost.classList.toggle('tool-drag-invalid', !pointerIsInsideViewport(event.clientX, event.clientY));
}

function finishToolbarDrag(event) {
  const state = toolbarDragState;
  if (!state || event.pointerId !== state.pointerId) return;
  window.removeEventListener('pointermove', moveToolbarDrag);
  window.removeEventListener('pointerup', finishToolbarDrag);
  window.removeEventListener('pointercancel', cancelToolbarDrag);
  if (state.dragged) {
    suppressToolbarClick = true;
    window.setTimeout(() => { suppressToolbarClick = false; }, 400);
    if (pointerIsInsideViewport(event.clientX, event.clientY)) {
      const position = canvasCoordinates(event.clientX, event.clientY);
      if (state.action.type === 'tool' && state.action.tool === 'line') {
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        const length = Math.hypot(dx, dy) || 1;
        const direction = { x: dx / length, y: dy / length };
        createLine(
          { x: position.x - direction.x * 90, y: position.y - direction.y * 90 },
          position,
        );
      } else if (state.action.type === 'tool') {
        createAtPosition(state.action.tool, position, { focus: false });
      } else if (state.action.type === 'image') {
        imageDropPosition = position;
        imageInput.click();
      } else if (state.action.type === 'paste') {
        void pasteImageFromClipboard(position);
      }
    }
  }
  toolbarDragGhost?.remove();
  toolbarDragGhost = null;
  toolbarDragState = null;
  if (state.button.hasPointerCapture(event.pointerId)) state.button.releasePointerCapture(event.pointerId);
}

function cancelToolbarDrag(event) {
  if (!toolbarDragState || event.pointerId !== toolbarDragState.pointerId) return;
  window.removeEventListener('pointermove', moveToolbarDrag);
  window.removeEventListener('pointerup', finishToolbarDrag);
  window.removeEventListener('pointercancel', cancelToolbarDrag);
  toolbarDragGhost?.remove();
  toolbarDragGhost = null;
  toolbarDragState = null;
}

function suppressToolbarClickIfNeeded(event) {
  if (!suppressToolbarClick) return false;
  suppressToolbarClick = false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function activateTool(tool) {
  activeTool = activeTool === tool ? null : tool;
  firstLinePoint = null;
  drawingSettings.eraser = false;
  updateSelectionTools();
  if (activeTool === 'draw') showToast('Arraste na área do quadro para desenhar. Escolha uma cor, espessura ou borracha.');
}

function createAtPosition(tool, position, { focus = true } = {}) {
  if (tool === 'note') createElement('note', position, { text: '', color: '#343b45', fontSize: 16 }, { focus });
  if (tool === 'checklist') {
    const element = createElement('checklist', position, { tasks: [{ text: '', done: false }], color: '#343b45', fontSize: 14 });
    if (focus) stage.querySelector(`[data-id="${element.id}"] [contenteditable="true"]`)?.focus();
  }
  if (tool === 'link') {
    const element = createElement('link', position, { title: 'Novo link', url: '' });
    if (focus) stage.querySelector(`[data-id="${element.id}"] .link-url`)?.focus();
  }
  if (tool === 'column') createElement('column', position, { title: 'Nova coluna', z: 0 });
  if (tool === 'board') void addNestedBoard(position);
}

function parseImageFiles(fileList) {
  return [...fileList].filter((file) => file.type.startsWith('image/'));
}

async function readImageFilesFromClipboard() {
  if (typeof window.localClipboard?.readImage === 'function') {
    const image = await window.localClipboard.readImage();
    if (image?.data?.length) {
      const bytes = new Uint8Array(image.data);
      return [new File([bytes], 'imagem-colada.png', { type: image.type || 'image/png' })];
    }
    return [];
  }

  if (typeof navigator.clipboard?.read !== 'function') {
    throw new Error('Este contexto não oferece acesso à leitura de imagens da área de transferência.');
  }

  const clipboardItems = await navigator.clipboard.read();
  const imageFiles = [];
  for (const item of clipboardItems) {
    for (const type of item.types.filter((mimeType) => mimeType.startsWith('image/'))) {
      const blob = await item.getType(type);
      imageFiles.push(new File([blob], `imagem-colada.${type.split('/')[1] || 'png'}`, { type }));
    }
  }
  return imageFiles;
}

async function pasteImageFromClipboard(position = viewportCenter()) {
  try {
    const images = await readImageFilesFromClipboard();
    if (images.length === 0) {
      showToast('A área de transferência não contém uma imagem.');
      return;
    }
    for (const [index, image] of images.entries()) {
      await addImage(image, { x: position.x + index * 28, y: position.y + index * 28 }, image.name);
    }
  } catch (error) {
    console.error('Falha ao ler uma imagem da área de transferência:', error);
    showToast('Não foi possível acessar a imagem. Tente Ctrl+V ou use Imagem para selecionar um arquivo.');
  }
}

function addTextOrLink(text, position) {
  const value = text.trim();
  if (!value) return;
  const url = safeExternalUrl(value);
  if (url) {
    const title = new URL(url).hostname.replace(/^www\./, '');
    createElement('link', position, { title, url });
    return;
  }
  createElement('note', position, { text: value, color: '#343b45', fontSize: 16, noteBackground: '#fffefa', autoContrastText: true });
}

function bindEvents() {
  undoButton.addEventListener('click', undoAction);
  redoButton.addEventListener('click', redoAction);
  document.querySelectorAll('.tool-button[data-tool]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => startToolbarDrag(event, button, { type: 'tool', tool: button.dataset.tool }));
    button.addEventListener('click', (event) => {
      if (suppressToolbarClickIfNeeded(event)) return;
      activateTool(button.dataset.tool);
    });
  });
  document.querySelector('#new-board').addEventListener('click', () => void addBoard());
  document.querySelectorAll('.draw-color-swatch').forEach((button) => {
    button.addEventListener('click', () => {
      drawingSettings.color = button.dataset.drawColor;
      drawingSettings.eraser = false;
      updateSelectionTools();
    });
  });
  document.querySelectorAll('.draw-size-button').forEach((button) => {
    button.addEventListener('click', () => {
      drawingSettings.width = Number(button.dataset.drawSize);
      updateSelectionTools();
    });
  });
  eraserButton.addEventListener('click', () => {
    drawingSettings.eraser = !drawingSettings.eraser;
    updateSelectionTools();
  });
  const imageButton = document.querySelector('#image-button');
  imageButton.addEventListener('pointerdown', (event) => startToolbarDrag(event, imageButton, { type: 'image' }));
  imageButton.addEventListener('click', (event) => {
    if (suppressToolbarClickIfNeeded(event)) return;
    imageDropPosition = null;
    imageInput.click();
  });
  imageInput.addEventListener('change', async () => {
    const center = imageDropPosition ?? viewportCenter();
    imageDropPosition = null;
    for (const [index, file] of parseImageFiles(imageInput.files).entries()) {
      await addImage(file, { x: center.x + index * 28, y: center.y + index * 28 }, file.name);
    }
    imageInput.value = '';
  });
  imageInput.addEventListener('cancel', () => { imageDropPosition = null; });
  const pasteImageButton = document.querySelector('#paste-image-button');
  pasteImageButton.addEventListener('pointerdown', (event) => startToolbarDrag(event, pasteImageButton, { type: 'paste' }));
  pasteImageButton.addEventListener('click', (event) => {
    if (suppressToolbarClickIfNeeded(event)) return;
    void pasteImageFromClipboard();
  });

  boardTitle.addEventListener('change', () => {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board) return;
    board.name = boardTitle.value.trim() || 'Meu quadro';
    boardTitle.value = board.name;
    board.updatedAt = Date.now();
    renderBreadcrumbs();
    renderBoardList();
    void saveBoard(board);
  });

  document.querySelector('#zoom-in').addEventListener('click', () => setZoom(zoom + 0.1));
  document.querySelector('#zoom-out').addEventListener('click', () => setZoom(zoom - 0.1));
  document.querySelector('#expand-board').addEventListener('click', () => {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board) return;
    board.canvasWidth = stageWidth + 2000;
    board.canvasHeight = stageHeight + 1000;
    board.updatedAt = Date.now();
    setCanvasSize(board.canvasWidth, board.canvasHeight);
    void saveBoard(board);
    showToast(`Quadro ampliado para ${board.canvasWidth} × ${board.canvasHeight} px.`);
  });
  document.querySelector('#font-smaller').addEventListener('click', () => changeFontSize(-2));
  document.querySelector('#font-larger').addEventListener('click', () => changeFontSize(2));
  document.querySelector('#delete-selected').addEventListener('click', () => {
    if (selectedId) void deleteElement(selectedId);
  });
  document.querySelectorAll('.color-swatch').forEach((button) => {
    button.addEventListener('click', () => changeSelectedColor(button.dataset.color));
  });
  document.querySelectorAll('.background-swatch').forEach((button) => {
    button.addEventListener('click', () => changeSelectedBackground(button.dataset.background));
  });
  document.querySelector('#font-family').addEventListener('change', (event) => updateSelectedTextStyle('fontFamily', event.target.value));
  document.querySelector('#font-size-input').addEventListener('change', (event) => {
    const size = Number(event.target.value);
    if (Number.isFinite(size)) updateSelectedTextStyle('fontSize', Math.max(6, Math.min(300, Math.round(size))));
  });
  document.querySelectorAll('.format-preset').forEach((button) => {
    button.addEventListener('click', () => updateSelectedTextStyle('fontSize', Number(button.dataset.fontSize)));
  });
  document.querySelector('#bold-text').addEventListener('click', () => toggleTextStyle('bold'));
  document.querySelector('#italic-text').addEventListener('click', () => toggleTextStyle('italic'));
  document.querySelector('#quote-text').addEventListener('click', () => toggleTextStyle('quote'));
  document.querySelector('#element-layer').addEventListener('change', (event) => changeSelectedLayer(event.currentTarget.value));
  document.querySelectorAll('#element-width,#element-height').forEach((input) => {
    input.addEventListener('change', updateSelectedDimensions);
  });
  document.querySelector('#image-viewer-close').addEventListener('click', () => imageViewer.close());
  imageViewer.addEventListener('click', (event) => {
    if (event.target === imageViewer) imageViewer.close();
  });
  imageViewer.addEventListener('close', () => {
    imageViewerContent.removeAttribute('src');
    imageViewerContent.alt = '';
  });

  viewport.addEventListener('pointerdown', startFreehand, true);
  viewport.addEventListener('click', (event) => {
    if (activeTool === 'draw') return;
    if (event.target.closest('.connection-path,.line-handle')) return;
    const targetItem = event.target.closest('.board-item');
    const columnDropArea = activeTool && targetItem?.dataset.type === 'column'
      && event.target.closest('.column-content');
    if ((targetItem && !columnDropArea) || event.target.closest('.tool-dock') || event.target.closest('.selection-tools')) return;
    const position = canvasCoordinates(event.clientX, event.clientY);
    if (activeTool === 'line') {
      if (!firstLinePoint) {
        firstLinePoint = position;
        showToast('Agora clique onde a linha deve terminar.');
      } else {
        createLine(firstLinePoint, position);
      }
      return;
    }
    if (activeTool) {
      createAtPosition(activeTool, position);
      activeTool = null;
      updateSelectionTools();
      return;
    }
    selectedId = null;
    renderAll();
    updateSelectionTools();
  });

  document.addEventListener('paste', async (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    let images = parseImageFiles(clipboard.files);
    const imageItems = [...clipboard.items].filter((item) => item.type.startsWith('image/'));
    const editor = event.target.closest('[contenteditable="true"]');
    const pasteCopiedItem = pasteAppClipboard && !editor;
    pasteAppClipboard = false;
    const owner = editor?.closest('.board-item');
    const ownerElement = elements.find((element) => element.id === owner?.dataset.id);
    const position = ownerElement
      ? { x: ownerElement.x + ownerElement.width + 160, y: ownerElement.y + ownerElement.height / 2 }
      : viewportCenter();
    if (pasteCopiedItem) event.preventDefault();
    if (images.length === 0 && imageItems.length) {
      images = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    }
    if (pasteCopiedItem && images.length === 0) {
      if (!clipboard.types.includes('text/plain') && !clipboard.types.includes('text/html')) {
        try {
          images = await readImageFilesFromClipboard();
        } catch (error) {
          console.error('Falha ao verificar uma imagem colada:', error);
        }
      }
      if (!images.length) {
        pasteCopiedElement();
        return;
      }
    }
    if (
      images.length === 0 &&
      (typeof window.localClipboard?.readImage === 'function' ||
        (!clipboard.types.includes('text/plain') && !clipboard.types.includes('text/html')))
    ) {
      try {
        images = await readImageFilesFromClipboard();
      } catch (error) {
        console.error('Falha ao ler uma imagem colada da área de transferência:', error);
        if (typeof window.localClipboard?.readImage === 'function') {
          showToast('Não foi possível ler a imagem da área de transferência. Use o botão Colar foto.');
          return;
        }
      }
    }
    if (images.length) {
      event.preventDefault();
      if (ownerElement?.type === 'board') {
        const childBoard = boards.find((board) => board.id === ownerElement.targetBoardId);
        if (childBoard) {
          await updateBoardCover(childBoard, images[0]);
          return;
        }
      }
      for (const [index, image] of images.entries()) {
        await addImage(image, { x: position.x + index * 28, y: position.y + index * 28 }, image.name || 'Imagem colada');
      }
      return;
    }
    if (editor) return;
    const clipboardHasText = clipboard.types.includes('text/plain');
    if (!clipboardHasText && typeof navigator.clipboard?.read === 'function') {
      event.preventDefault();
      try {
        const clipboardImages = await readImageFilesFromClipboard();
        if (clipboardImages.length === 0) {
          showToast('A área de transferência não contém uma imagem.');
          return;
        }
        for (const [index, image] of clipboardImages.entries()) {
          await addImage(image, { x: position.x + index * 28, y: position.y + index * 28 }, image.name);
        }
      } catch (error) {
        console.error('Falha ao ler uma imagem colada:', error);
        showToast('Não foi possível ler a imagem da área de transferência. Use o botão Colar foto.');
      }
      return;
    }
    const text = clipboard.getData('text/plain');
    if (text) {
      event.preventDefault();
      addTextOrLink(text, position);
    }
  });

  viewport.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  viewport.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    const position = canvasCoordinates(event.clientX, event.clientY);
    for (const [index, file] of parseImageFiles(event.dataTransfer.files).entries()) {
      await addImage(file, { x: position.x + index * 28, y: position.y + index * 28 }, file.name);
    }
  });

  document.addEventListener('keydown', (event) => {
    const commandKey = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const target = event.target instanceof Element ? event.target : document.body;
    const editingTarget = target.closest('[contenteditable="true"],input,textarea');
    if (commandKey && key === 'z' && !editingTarget) {
      event.preventDefault();
      if (event.shiftKey) redoAction();
      else undoAction();
      return;
    }
    if (commandKey && key === 'y' && !editingTarget) {
      event.preventDefault();
      redoAction();
      return;
    }
    if (commandKey && key === 'c' && selectedId) {
      const selection = window.getSelection();
      const inputHasSelection = target.matches('input,textarea')
        && target.selectionStart !== target.selectionEnd;
      if (
        !editingTarget ||
        (target.isContentEditable && !selection?.toString() && !inputHasSelection)
      ) {
        if (copySelectedElement()) event.preventDefault();
      }
    }
    if (commandKey && key === 'v' && !editingTarget && appClipboard) {
      pasteAppClipboard = true;
      window.setTimeout(() => { pasteAppClipboard = false; }, 0);
    }
    if (event.code === 'Space' && !editingTarget) {
      spaceDown = true;
      viewport.classList.add('panning');
      event.preventDefault();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !editingTarget) {
      void deleteElement(selectedId);
    }
    if (event.key === 'Escape') {
      activeTool = null;
      firstLinePoint = null;
      updateSelectionTools();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      spaceDown = false;
      viewport.classList.remove('panning');
    }
  });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button === 2 && !event.target.closest('[contenteditable="true"],input,textarea,button,a')) {
      event.preventDefault();
      panState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      viewport.classList.add('right-panning');
      viewport.setPointerCapture(event.pointerId);
      return;
    }
    if (!spaceDown || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const scrollLeft = viewport.scrollLeft;
    const scrollTop = viewport.scrollTop;
    const move = (moveEvent) => {
      viewport.scrollLeft = scrollLeft - (moveEvent.clientX - startX);
      viewport.scrollTop = scrollTop - (moveEvent.clientY - startY);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    viewport.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  });
  const endRightPan = (event) => {
    if (!panState || (event.pointerId !== undefined && event.pointerId !== panState.pointerId)) return;
    const pointerId = panState.pointerId;
    panState = null;
    viewport.classList.remove('right-panning');
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  };
  viewport.addEventListener('pointerup', endRightPan);
  viewport.addEventListener('pointercancel', endRightPan);
  viewport.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('[contenteditable="true"],input,textarea,button,a')) event.preventDefault();
  });
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
  window.addEventListener('beforeunload', (event) => {
    if (closeAfterSave || pendingSaves.size === 0) {
      clearObjectUrls();
      return;
    }
    event.preventDefault();
    void flushPendingSaves().then(() => {
      closeAfterSave = true;
      window.close();
    }).catch(() => {});
  });
}

function changeFontSize(delta) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || !['note', 'checklist', 'link', 'column'].includes(element.type)) return;
  const defaultSize = { note: 16, checklist: 14, link: 14, column: 13 }[element.type];
  updateSelectedTextStyle('fontSize', Math.max(6, Math.min(300, (element.fontSize ?? defaultSize) + delta)));
}

function changeSelectedColor(color) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || !['note', 'checklist', 'link', 'column'].includes(element.type)) return;
  recordHistory();
  element.color = color;
  element.autoContrastText = false;
  const card = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (card) applyTextStyle(element, card);
  updateSelectionTools();
  scheduleSaveElement(element);
}

function changeSelectedBackground(background) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || !['note', 'checklist', 'link', 'column'].includes(element.type) || !CARD_BACKGROUNDS.has(background)) return;
  recordHistory();
  element.background = background;
  const autoContrastText = element.autoContrastText === true
    || (element.autoContrastText === undefined && (!element.color || element.color === '#343b45'));
  if (autoContrastText) {
    element.color = background === 'transparent' ? '#e4e6e8' : '#343b45';
    element.autoContrastText = true;
  }
  const card = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (card) {
    card.dataset.background = background;
    card.style.backgroundColor = background === 'transparent' ? 'transparent' : background;
    if (element.type === 'column') card.style.borderColor = background === 'transparent' ? 'transparent' : background;
    applyTextStyle(element, card);
  }
  updateSelectionTools();
  scheduleSaveElement(element);
}

function updateSelectedTextStyle(property, value) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || !['note', 'checklist', 'link', 'column'].includes(element.type)) return;
  if (property === 'fontFamily' && !FONT_FAMILIES.has(value)) return;
  if (property === 'fontSize' && (!Number.isFinite(value) || value < 6 || value > 300)) return;
  if (element[property] === value) return;
  recordHistory();
  element[property] = value;
  const card = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (card) applyTextStyle(element, card);
  updateSelectionTools();
  scheduleSaveElement(element);
}

function toggleTextStyle(property) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || !['note', 'checklist', 'link', 'column'].includes(element.type)) return;
  if (property === 'quote' && element.type !== 'note') return;
  recordHistory();
  element[property] = !element[property];
  const card = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (card) applyTextStyle(element, card);
  updateSelectionTools();
  scheduleSaveElement(element);
}

function changeSelectedLayer(layer) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || element.type === 'line' || !['default', 'front', 'back'].includes(layer)) return;
  if ((element.layer ?? (element.type === 'drawing' ? 'back' : 'default')) === layer) return;
  recordHistory();
  if (layer === 'default') delete element.layer;
  else element.layer = layer;
  renderAll();
  updateSelectionTools();
  scheduleSaveElement(element);
}

function updateSelectedDimensions(event) {
  const element = elements.find((entry) => entry.id === selectedId);
  if (!element || element.type === 'line') return;
  const input = event.currentTarget;
  const value = Number(input.value);
  const isWidth = input.id === 'element-width';
  const maximum = isWidth ? stageWidth : stageHeight;
  if (!Number.isFinite(value) || value < 40 || value > maximum) {
    input.value = String(Math.round(isWidth ? element.width : element.height));
    return;
  }
  const currentValue = isWidth ? element.width : element.height;
  if (Math.round(currentValue) === Math.round(value) && element.customSize) return;
  recordHistory();
  const card = stage.querySelector(`.board-item[data-id="${element.id}"]`);
  if (!element.customSize && card) {
    element.width = card.getBoundingClientRect().width / zoom;
    element.height = card.getBoundingClientRect().height / zoom;
  }
  element[isWidth ? 'width' : 'height'] = Math.round(value);
  element.customSize = true;
  if (card) {
    card.classList.add('custom-size');
    card.style.width = `${element.width}px`;
    card.style.height = `${element.height}px`;
    if (element.type !== 'image') card.style.minHeight = '40px';
    if (element.type === 'column') updateColumnConnections(element, card);
  }
  updateSelectionTools();
  scheduleSaveElement(element);
}

async function initialise() {
  bindEvents();
  try {
    db = await openDatabase();
    boards = await loadAll('boards');
    if (!boards.length) {
      const firstBoard = createBoardObject('Meu quadro');
      await storeValue('boards', 'put', firstBoard);
      boards = [firstBoard];
    }
    boards.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    activeBoardId = boards[0].id;
    setCanvasSize(boards[0].canvasWidth, boards[0].canvasHeight);
    boards[0].lastOpenedAt = Date.now();
    void saveBoard(boards[0]);
    boardTitle.value = boards[0].name;
    renderBreadcrumbs();
    renderBoardList();
    elements = await getBoardElements(activeBoardId);
    renderAll();
    updateSelectionTools();
    window.requestAnimationFrame(scrollToCanvasCenter);
  } catch (error) {
    console.error('Não foi possível inicializar o espaço local:', error);
    saveStatus.classList.add('error');
    saveLabel.textContent = 'Erro ao iniciar';
    showToast('O armazenamento local não pôde ser aberto. Reinicie o app e tente novamente.');
  }
}

void initialise();
