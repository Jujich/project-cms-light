<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight,
  Braces, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2,
  ExternalLink, File, FileCode2, FileImage, FileText, Globe2, History, ImagePlus,
  Layers3, LayoutGrid, Link2, LoaderCircle, Menu, MessageSquare, Monitor, MoreHorizontal,
  MousePointer2, PanelLeftClose, Paperclip, Pencil, Plus, RotateCcw, Search, Send,
  Settings2, ShieldCheck, Smartphone, Sparkles, Square, Trash2, Unplug, Upload,
  WandSparkles, Webhook, X,
} from 'lucide-vue-next';
import type { Attachment, Bootstrap, Integration, Release, SiteContent, SiteSection } from '../shared/types';

type View = 'website' | 'assets' | 'submissions' | 'integrations' | 'history' | 'code';
type Modal = 'content' | 'connect' | 'integration' | 'export' | 'publish' | 'restore' | null;
const state = ref<Bootstrap | null>(null);
const loading = ref(true);
const loadError = ref('');
const view = ref<View>('website');
const mobilePreview = ref(false);
const sidebarOpen = ref(false);
const chatOpen = ref(true);
const selectedSection = ref('');
const modal = ref<Modal>(null);
const busy = ref(false);
const actionError = ref('');
const toast = ref('');
const toastType = ref<'success' | 'error'>('success');
const chatText = ref('');
const attachmentIds = ref<string[]>([]);
const uploading = ref(false);
const imageAttachments = computed(() => project.value?.attachments.filter(file => file.mime.startsWith('image/')) ?? []);
const uploadInput = ref<HTMLInputElement | null>(null);
const libraryInput = ref<HTMLInputElement | null>(null);
const composer = ref<HTMLTextAreaElement | null>(null);
const messagesEl = ref<HTMLElement | null>(null);
const formElement = ref<HTMLElement | null>(null);
const addMenu = ref(false);
const librarySearch = ref('');
const apiKey = ref('');
const model = ref('');
const authTab = ref<'chatgpt' | 'api-key'>('chatgpt');
const oauthWaiting = ref(false);
const oauthUrl = ref('');
const authError = ref('');
const editorContent = ref<SiteContent | null>(null);
const editorSectionId = ref<string | null>(null);
const editorRevision = ref(0);
const editorInitial = ref('');
const integrationDraft = ref<Integration>({ id: '', type: 'webhook', name: '', enabled: true, endpoint: '' });
const integrationSecret = ref('');
const integrationRevision = ref(0);
const codeFile = ref('content.json');
const codeValue = ref('');
const codeInitial = ref('');
const codeRevision = ref(0);
const restoreRelease = ref<Release | null>(null);
let polling: ReturnType<typeof setInterval> | undefined;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;
let pollingBusy = false;

const project = computed(() => state.value?.project);
const content = computed<SiteContent | null>(() => {
  try { return JSON.parse(project.value?.files['content.json'] || 'null'); } catch { return null; }
});
const activeRun = computed(() => project.value?.runs.find(run => run.status === 'running'));
const lastRun = computed(() => project.value?.runs.at(-1));
const pendingAttachments = computed(() => project.value?.attachments.filter(file => attachmentIds.value.includes(file.id)) ?? []);
const filteredAttachments = computed(() => project.value?.attachments.filter(file => file.name.toLowerCase().includes(librarySearch.value.toLowerCase())) ?? []);
const messages = computed(() => project.value?.messages ?? []);
const hasUnpublished = computed(() => project.value?.revision !== project.value?.publishedRevision);
const codeDirty = computed(() => codeValue.value !== codeInitial.value);
const editorDirty = computed(() => !!editorContent.value && JSON.stringify(editorContent.value) !== editorInitial.value);
const draftSection = computed(() => editorContent.value?.sections.find(section => section.id === editorSectionId.value));
const canSend = computed(() => !!chatText.value.trim() && !busy.value && !uploading.value && !activeRun.value);
const fileNames = computed(() => Object.keys(project.value?.files ?? {}));
const viewTitles: Record<View, string> = { website: 'Редактор сайта', assets: 'Материалы', submissions: 'Заявки', integrations: 'Интеграции', history: 'История версий', code: 'Исходный код' };
const sectionNames: Record<SiteSection['type'], string> = { hero: 'Первый экран', services: 'Услуги', text: 'Текстовый блок', form: 'Форма', custom: 'Свой блок' };
const formattedUpdated = computed(() => project.value ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(project.value.updatedAt)) : '');
const previewOrigin = computed(() => { try { return new URL(state.value?.previewUrl || '').origin; } catch { return ''; } });
const showChat = computed(() => chatOpen.value && view.value === 'website');

function newId(): string { return crypto.randomUUID().slice(0, 8); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function notify(message: string, type: 'success' | 'error' = 'success') {
  toast.value = message; toastType.value = type;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.value = ''; }, 5000);
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'; }
async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Forma-Request': 'studio' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data as T;
}
async function bootstrap(initial = false) {
  if (pollingBusy) return;
  pollingBusy = true;
  try {
    const response = await fetch('/api/bootstrap', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Сервер недоступен');
    const previousConnected = state.value?.auth.connected;
    state.value = data;
    loadError.value = '';
    if (oauthWaiting.value && !previousConnected && data.auth.connected) {
      oauthWaiting.value = false; modal.value = null; notify('ИИ подключён. Можно начать диалог.');
    }
    if (!codeDirty.value) syncCode();
  } catch (error) {
    if (initial || !state.value) loadError.value = errorText(error);
  } finally { loading.value = false; pollingBusy = false; }
}
function syncCode() {
  codeValue.value = project.value?.files[codeFile.value] ?? '';
  codeInitial.value = codeValue.value;
  codeRevision.value = project.value?.revision ?? 0;
}
function selectView(next: View) {
  if (view.value === 'code' && next !== 'code' && codeDirty.value && !window.confirm('В коде есть несохранённые изменения. Перейти и оставить их в редакторе?')) return;
  view.value = next; sidebarOpen.value = false; addMenu.value = false;
  if (next === 'code' && !codeDirty.value) syncCode();
}
function selectCodeFile(name: string) {
  if (name === codeFile.value) return;
  if (codeDirty.value && !window.confirm('Отменить несохранённые изменения в этом файле?')) return;
  codeFile.value = name; syncCode();
}
function openModal(next: Modal) { actionError.value = ''; authError.value = ''; modal.value = next; sidebarOpen.value = false; }
function closeModal(force = false) {
  if (busy.value) return;
  if (!force && modal.value === 'content' && editorDirty.value && !window.confirm('Закрыть редактор и отменить несохранённые изменения?')) return;
  modal.value = null; actionError.value = ''; apiKey.value = ''; integrationSecret.value = '';
}
function editContent(sectionId: string | null = null) {
  if (!content.value || !project.value) return;
  editorContent.value = clone(content.value); editorRevision.value = project.value.revision;
  editorSectionId.value = sectionId; editorInitial.value = JSON.stringify(editorContent.value);
  if (sectionId) selectedSection.value = sectionId;
  openModal('content');
}
function addSection(type: SiteSection['type']) {
  if (!content.value || !project.value) return;
  editorContent.value = clone(content.value); editorInitial.value = JSON.stringify(editorContent.value);
  editorRevision.value = project.value.revision;
  const id = `section_${newId()}`;
  const section: SiteSection = { id, type, title: type === 'form' ? 'Обсудим ваш проект' : 'Новая секция', body: '' };
  if (type === 'form') { section.buttonText = 'Отправить заявку'; section.fields = [{ name: 'name', label: 'Ваше имя', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }]; }
  if (type === 'services') section.items = [{ id: newId(), title: 'Новая услуга', text: 'Описание услуги' }];
  if (type === 'custom') section.html = '<div>Ваш новый блок</div>';
  editorContent.value.sections.push(section); editorSectionId.value = id; addMenu.value = false;
  openModal('content');
}
async function saveContent() {
  if (!editorContent.value) return;
  busy.value = true; actionError.value = '';
  try { await api('/api/content', { revision: editorRevision.value, content: editorContent.value }, 'PUT'); await bootstrap(); modal.value = null; notify('Изменения сохранены в черновике'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
function moveDraftSection(direction: number) {
  if (!editorContent.value || !editorSectionId.value) return;
  const list = editorContent.value.sections; const index = list.findIndex(s => s.id === editorSectionId.value);
  if (index + direction < 0 || index + direction >= list.length) return;
  const [section] = list.splice(index, 1); list.splice(index + direction, 0, section);
}
async function deleteDraftSection() {
  if (!editorContent.value || !editorSectionId.value || !window.confirm('Удалить эту секцию из черновика?')) return;
  editorContent.value.sections = editorContent.value.sections.filter(s => s.id !== editorSectionId.value);
  await saveContent();
}
async function saveCode() {
  busy.value = true; actionError.value = '';
  try { await api('/api/files', { revision: codeRevision.value, files: { [codeFile.value]: codeValue.value } }, 'PUT'); codeInitial.value = codeValue.value; await bootstrap(); notify('Файл сохранён. Предпросмотр обновлён.'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
async function uploadFiles(files: FileList | globalThis.File[] | null, attachToChat = true) {
  if (!files?.length || uploading.value) return;
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      if (attachToChat && attachmentIds.value.length >= 5) { notify('К сообщению можно прикрепить до 5 файлов', 'error'); break; }
      if (file.size > 10 * 1024 * 1024) { notify(`Файл «${file.name}» больше 10 МБ`, 'error'); continue; }
      const response = await fetch('/api/attachments', { method: 'POST', headers: { 'X-Forma-Request': 'studio', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось загрузить файл');
      if (attachToChat) attachmentIds.value.push((data as Attachment).id);
    }
    await bootstrap();
    if (!attachToChat) notify('Материалы добавлены в библиотеку');
  } catch (error) { notify(errorText(error), 'error'); }
  finally { uploading.value = false; if (uploadInput.value) uploadInput.value.value = ''; if (libraryInput.value) libraryInput.value.value = ''; }
}
async function deleteAttachment(file: Attachment) {
  if (!window.confirm(`Удалить материал «${file.name}»?`)) return;
  busy.value = true;
  try { await api(`/api/attachments/${file.id}`, {}, 'DELETE'); attachmentIds.value = attachmentIds.value.filter(id => id !== file.id); await bootstrap(); notify('Материал удалён'); }
  catch (error) { notify(errorText(error), 'error'); }
  finally { busy.value = false; }
}
function attachFromLibrary(file: Attachment) {
  if (!attachmentIds.value.includes(file.id)) {
    if (attachmentIds.value.length >= 5) { notify('К сообщению можно прикрепить до 5 файлов', 'error'); return; }
    attachmentIds.value.push(file.id);
  }
  view.value = 'website'; chatOpen.value = true;
}
function fileFromEvent(event: Event) { return (event.target as HTMLInputElement).files; }
function pasteAttachments(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length) { event.preventDefault(); void uploadFiles(files); }
}
function dropAttachments(event: DragEvent) { event.preventDefault(); void uploadFiles(event.dataTransfer?.files ?? null); }
function attachmentUrl(file: Attachment) { return `/api/attachments/${encodeURIComponent(file.id)}/file`; }
function sizeLabel(size: number) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`; }
function dateLabel(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }
function messageAttachments(ids: string[] = []) { return project.value?.attachments.filter(file => ids.includes(file.id)) ?? []; }
function promptSuggestion(text: string) { chatText.value = text; chatOpen.value = true; view.value = 'website'; void nextTick(() => composer.value?.focus()); }
async function sendMessage() {
  if (!canSend.value) return;
  if (!state.value?.auth.connected) { openModal('connect'); return; }
  busy.value = true;
  try {
    await api('/api/chat', { message: chatText.value.trim(), attachmentIds: attachmentIds.value, ...(selectedSection.value ? { sectionId: selectedSection.value } : {}) });
    chatText.value = ''; attachmentIds.value = []; await bootstrap();
  } catch (error) { notify(errorText(error), 'error'); }
  finally { busy.value = false; }
}
async function cancelRun() {
  if (!activeRun.value) return;
  try { await api(`/api/runs/${activeRun.value.id}/cancel`, {}); await bootstrap(); }
  catch (error) { notify(errorText(error), 'error'); }
}
async function addFormTemplate() {
  if (!project.value) return;
  busy.value = true;
  try { await api('/api/templates/form', { revision: project.value.revision }); await bootstrap(); notify('Готовая форма добавлена в черновик'); }
  catch (error) { notify(errorText(error), 'error'); }
  finally { busy.value = false; }
}
async function connectAuth() {
  busy.value = true; authError.value = '';
  try {
    if (authTab.value === 'chatgpt') {
      const result = await api<{ url: string }>('/api/auth/connect', { provider: 'chatgpt' });
      oauthWaiting.value = true; oauthUrl.value = result.url;
      const popup = window.open(result.url, '_blank', 'noopener,noreferrer');
      if (!popup) { /* Some browsers return null with noopener even when the tab opens. */ }
    } else {
      await api('/api/auth/connect', { provider: 'api-key', apiKey: apiKey.value, ...(model.value.trim() ? { model: model.value.trim() } : {}) });
      apiKey.value = ''; await bootstrap(); modal.value = null; notify('API-подключение сохранено');
    }
  } catch (error) { authError.value = errorText(error); }
  finally { busy.value = false; }
}
async function disconnectAuth() {
  busy.value = true; authError.value = '';
  try { await api('/api/auth/disconnect', {}); oauthWaiting.value = false; oauthUrl.value = ''; await bootstrap(); notify('ИИ отключён'); }
  catch (error) { authError.value = errorText(error); }
  finally { busy.value = false; }
}
function editIntegration(integration?: Integration, type: Integration['type'] = 'webhook') {
  integrationDraft.value = integration ? clone(integration) : { id: `integration_${newId()}`, type, name: '', enabled: type === 'webhook', ...(type === 'webhook' ? { endpoint: '' } : { script: '' }) };
  integrationRevision.value = project.value?.revision ?? 0; integrationSecret.value = ''; openModal('integration');
}
async function saveIntegration() {
  busy.value = true; actionError.value = '';
  try { await api('/api/integrations', { revision: integrationRevision.value, integration: integrationDraft.value, ...(integrationSecret.value ? { secret: integrationSecret.value } : {}) }); await bootstrap(); integrationSecret.value = ''; modal.value = null; notify('Интеграция сохранена в черновике'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
async function deleteIntegration() {
  if (!window.confirm('Удалить интеграцию из черновика?')) return;
  busy.value = true; actionError.value = '';
  try { await api(`/api/integrations/${integrationDraft.value.id}`, { revision: integrationRevision.value }, 'DELETE'); await bootstrap(); modal.value = null; notify('Интеграция удалена из черновика'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
async function publish() {
  if (!project.value) return;
  busy.value = true; actionError.value = '';
  try { await api('/api/publish', { revision: project.value.revision }); await bootstrap(); modal.value = null; notify('Сайт опубликован на локальном сервере'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
function openRestore(release: Release) { restoreRelease.value = release; openModal('restore'); }
async function restore() {
  if (!project.value || !restoreRelease.value) return;
  busy.value = true; actionError.value = '';
  try { await api(`/api/releases/${restoreRelease.value.id}/restore`, { revision: project.value.revision }); await bootstrap(); modal.value = null; notify('Версия восстановлена в черновик. Проверьте и опубликуйте её.'); }
  catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
async function exportProject(framework: 'nuxt' | 'next') {
  busy.value = true; actionError.value = '';
  try {
    const response = await fetch(`/api/export?framework=${framework}`);
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Не удалось экспортировать сайт'); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `forma-site-${framework}.zip`; anchor.click(); URL.revokeObjectURL(url);
    notify(`Проект для ${framework === 'nuxt' ? 'Nuxt' : 'Next.js'} скачан`);
  } catch (error) { actionError.value = errorText(error); }
  finally { busy.value = false; }
}
function onPreviewMessage(event: MessageEvent) {
  if (event.origin !== previewOrigin.value || event.data?.type !== 'forma:select' || typeof event.data.sectionId !== 'string') return;
  if (content.value?.sections.some(section => section.id === event.data.sectionId)) editContent(event.data.sectionId);
}
function insertCodeTab(event: KeyboardEvent) {
  const input = event.target as HTMLTextAreaElement;
  const start = input.selectionStart; const end = input.selectionEnd;
  codeValue.value = codeValue.value.slice(0, start) + '  ' + codeValue.value.slice(end);
  void nextTick(() => { input.selectionStart = input.selectionEnd = start + 2; });
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { closeModal(); addMenu.value = false; sidebarOpen.value = false; }
  if (modal.value && event.key === 'Tab' && formElement.value) {
    const focusable = Array.from(formElement.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')).filter(element => element.offsetParent !== null);
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's' && view.value === 'code' && !modal.value) { event.preventDefault(); if (codeDirty.value && !busy.value && !activeRun.value) void saveCode(); }
}
function beforeUnload(event: BeforeUnloadEvent) { if (codeDirty.value || (modal.value === 'content' && editorDirty.value)) { event.preventDefault(); event.returnValue = ''; } }
watch(() => [messages.value.length, activeRun.value?.stage], () => nextTick(() => messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })));
watch(modal, () => nextTick(() => formElement.value?.querySelector<HTMLInputElement>('input, textarea, button')?.focus()));
onMounted(() => { if (window.matchMedia('(max-width: 768px)').matches) chatOpen.value = false; void bootstrap(true); polling = setInterval(() => void bootstrap(), 1800); window.addEventListener('message', onPreviewMessage); window.addEventListener('keydown', keyboard); window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => { clearInterval(polling); clearTimeout(toastTimeout); window.removeEventListener('message', onPreviewMessage); window.removeEventListener('keydown', keyboard); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <div v-if="loading && !state" class="boot-state"><div class="brand-mark large">f<span>·</span></div><LoaderCircle class="spin" :size="20"/><p>Открываем вашу студию…</p></div>
  <div v-else-if="!state" class="boot-state"><div class="brand-mark large">f<span>·</span></div><h1>Студия пока недоступна</h1><p>{{ loadError }}</p><button class="button primary" @click="bootstrap(true)"><RotateCcw :size="16"/> Попробовать снова</button></div>
  <div v-else class="studio-shell" :class="{ 'sidebar-is-open': sidebarOpen }">
    <header class="topbar">
      <button class="icon-button mobile-menu" aria-label="Открыть меню" @click="sidebarOpen = !sidebarOpen"><Menu :size="20"/></button>
      <button class="brand" @click="selectView('website')" aria-label="Forma, редактор сайта"><span class="brand-mark">f<span>·</span></span><span>forma<span class="brand-period">.</span></span><span class="mvp-tag">STUDIO</span></button>
      <div class="breadcrumb"><span class="breadcrumb-slash">/</span><span class="project-avatar">Л</span><span>{{ project?.name || content?.name }}</span><ChevronDown :size="13" class="muted"/></div>
      <div class="topbar-actions"><span class="save-state"><span class="status-dot"/> {{ hasUnpublished ? 'Черновик сохранён' : 'Всё опубликовано' }}<span class="save-time"> · {{ formattedUpdated }}</span></span><a v-if="project?.releases.length" :href="state.publishedUrl" target="_blank" rel="noopener" class="icon-button published-link" title="Открыть опубликованный сайт" aria-label="Открыть опубликованный сайт"><Globe2 :size="17"/></a><button class="icon-button history-button" title="История версий" aria-label="История версий" @click="selectView('history')"><History :size="18"/></button><button class="button publish-button" :disabled="busy || !!activeRun || !state.validation.valid || !hasUnpublished" @click="openModal('publish')"><span>Опубликовать</span><ArrowUpRight :size="16"/></button><span class="user-avatar" title="Локальная рабочая область">Вы</span></div>
    </header>

    <div v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false"/>
    <aside class="sidebar">
      <div class="workspace-label">ВАШ САЙТ <span class="tiny-pill">LOCAL</span></div>
      <nav class="main-nav" aria-label="Разделы студии">
        <button :class="{ active: view === 'website' }" @click="selectView('website')"><LayoutGrid :size="17"/><span>Редактор сайта</span><span v-if="view === 'website'" class="nav-active-dot"/></button>
        <button :class="{ active: view === 'assets' }" @click="selectView('assets')"><ImagePlus :size="17"/><span>Материалы</span><span v-if="project?.attachments.length" class="nav-count">{{ project.attachments.length }}</span></button>
        <button :class="{ active: view === 'submissions' }" @click="selectView('submissions')"><MessageSquare :size="17"/><span>Заявки</span><span v-if="project?.submissions.length" class="nav-count">{{ project.submissions.length }}</span></button>
        <button :class="{ active: view === 'integrations' }" @click="selectView('integrations')"><Link2 :size="17"/><span>Интеграции</span><span v-if="project?.integrations.length" class="nav-count">{{ project.integrations.length }}</span></button>
      </nav>
      <div class="sidebar-rule"/>
      <div class="section-label">СТРАНИЦЫ <span class="muted">1</span></div>
      <button class="page-item" :class="{ selected: view === 'website' }" @click="selectView('website')"><Globe2 :size="15"/><span>Главная</span><span class="page-path">/</span></button>
      <div class="section-tree" v-if="content">
        <button v-for="(section, index) in content.sections" :key="section.id" class="section-item" :class="{ selected: selectedSection === section.id }" @click="editContent(section.id)"><span class="tree-line"/><span class="section-number">{{ String(index + 1).padStart(2, '0') }}</span><span class="section-title">{{ sectionNames[section.type] }}</span><Pencil class="section-edit-icon" :size="12"/></button>
      </div>
      <div class="add-section-wrap"><button class="add-section" :disabled="!!activeRun" @click="addMenu = !addMenu"><Plus :size="15"/> Добавить секцию</button><div v-if="addMenu" class="add-menu"><button @click="addSection('text')"><FileText :size="15"/> Текстовый блок</button><button @click="addSection('services')"><Layers3 :size="15"/> Карточки услуг</button><button @click="addSection('form')"><MessageSquare :size="15"/> Форма заявки</button><button @click="addMenu = false; promptSuggestion('Добавь новую секцию на сайт. ')" class="green-text"><Sparkles :size="15"/> Создать с ИИ</button></div></div>
      <div class="sidebar-bottom">
        <div class="assistant-tip"><span class="tip-icon"><Sparkles :size="15"/></span><p>Есть идея?<br><strong>Расскажите её ассистенту.</strong></p><button aria-label="Открыть ассистента" class="icon-button" @click="view = 'website'; chatOpen = true; composer?.focus()"><ArrowUpRight :size="16"/></button></div>
        <button class="bottom-nav" :class="{ active: view === 'code' }" @click="selectView('code')"><Code2 :size="16"/> Исходный код <span class="tiny-pill">DEV</span></button>
        <button class="bottom-nav" @click="editContent()"><Settings2 :size="16"/> Настройки сайта</button>
        <button class="ai-account" @click="openModal('connect')"><span class="account-icon"><Sparkles :size="15"/></span><span><strong>{{ state.auth.connected ? 'ИИ подключён' : 'Подключить ИИ' }}</strong><small>{{ state.auth.connected ? (state.auth.provider === 'chatgpt' ? 'ChatGPT' : 'OpenAI API') : 'Ваш аккаунт ChatGPT' }}</small></span><span v-if="state.auth.connected" class="status-dot"/><ArrowUpRight v-else :size="15"/></button>
      </div>
    </aside>

    <main class="main-area" :class="{ 'with-chat': showChat }">
      <template v-if="view === 'website'">
        <div v-if="!state.validation.valid" class="validation-strip"><CircleHelp :size="15"/><span>В черновике есть ошибки. Исправьте их перед публикацией.</span><button @click="selectView('code')">Открыть код <ArrowRight :size="12"/></button></div>
        <div class="editor-toolbar"><div class="editor-title"><span class="page-icon"><Globe2 :size="15"/></span><span>Главная</span><ChevronRight :size="13"/><span class="muted">Предпросмотр</span></div><div class="device-switch" aria-label="Размер предпросмотра"><button :class="{ active: !mobilePreview }" aria-label="Компьютер" :aria-pressed="!mobilePreview" @click="mobilePreview = false"><Monitor :size="16"/></button><button :class="{ active: mobilePreview }" aria-label="Телефон" :aria-pressed="mobilePreview" @click="mobilePreview = true"><Smartphone :size="16"/></button></div><div class="editor-tools"><button class="icon-button" title="Настройки страницы" aria-label="Настройки страницы" @click="editContent()"><Settings2 :size="16"/></button><a :href="state.previewUrl" target="_blank" rel="noopener" class="icon-button" title="Открыть предпросмотр" aria-label="Открыть предпросмотр"><ExternalLink :size="16"/></a><button v-if="!chatOpen" class="button small" @click="chatOpen = true"><Sparkles :size="15"/> Ассистент</button></div></div>
        <div class="canvas-area" :class="{ 'mobile-canvas': mobilePreview }"><div class="canvas-info"><span><span class="draft-dot"/> ЧЕРНОВИК</span><span>Нажмите на секцию, чтобы изменить её <MousePointer2 :size="12"/></span></div><div class="site-frame"><div class="browser-bar"><div class="browser-dots"><i/><i/><i/></div><div class="browser-address"><ShieldCheck :size="12"/><span>{{ content?.name || 'Ваш сайт' }}</span><span class="address-divider">/</span><span class="muted">preview</span></div><span class="preview-version">v{{ project?.revision }}</span></div><iframe :src="state.previewUrl" title="Предпросмотр сайта" sandbox="allow-scripts allow-forms allow-same-origin" referrerpolicy="no-referrer"/></div><div class="canvas-footer"><span><ShieldCheck :size="13"/> Изменения видны только вам до публикации</span><button @click="openModal('export')">Экспорт проекта <ArrowUpRight :size="13"/></button></div></div>
      </template>

      <div v-else class="content-page" :class="{ 'code-page': view === 'code' }">
        <div class="content-page-header"><div><div class="eyebrow">РАБОЧАЯ ОБЛАСТЬ</div><h1>{{ viewTitles[view] }}</h1><p v-if="view === 'assets'">Фотографии, документы и референсы для вашего сайта.</p><p v-if="view === 'submissions'">Обращения из форм опубликованного сайта.</p><p v-if="view === 'integrations'">Свяжите сайт с вашими сервисами и добавьте новые возможности.</p><p v-if="view === 'history'">Каждая публикация — версия, к которой можно вернуться.</p><p v-if="view === 'code'">Контент, стили и поведение сайта. Изменения сохраняются в черновик.</p></div><button v-if="view === 'assets'" class="button primary" :disabled="uploading" @click="libraryInput?.click()"><LoaderCircle v-if="uploading" :size="16" class="spin"/><Upload v-else :size="16"/> Загрузить файлы</button><button v-if="view === 'integrations'" class="button primary" @click="editIntegration()"><Plus :size="16"/> Интеграция</button><button v-if="view === 'code'" class="button" @click="openModal('export')"><ArrowDownToLine :size="16"/> Экспорт</button></div>

        <template v-if="view === 'assets'"><input ref="libraryInput" type="file" multiple class="visually-hidden" accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.md,.csv,.json" @change="uploadFiles(fileFromEvent($event), false)"/><div class="library-toolbar"><div class="search-input"><Search :size="16"/><input v-model="librarySearch" placeholder="Найти материал…" aria-label="Поиск материалов"/></div><span class="muted">{{ filteredAttachments.length }} файлов</span></div><div v-if="!project?.attachments.length" class="empty-state upload-empty" @dragover.prevent @drop.prevent="uploadFiles($event.dataTransfer?.files || null, false)"><span class="empty-icon"><ImagePlus :size="28"/></span><h2>Все материалы — в одном месте</h2><p>Перетащите сюда фотографии, PDF, тексты или прайс-лист.<br>Затем прикрепите их к сообщению ассистенту.</p><button class="button" @click="libraryInput?.click()"><Plus :size="15"/> Выбрать файлы</button><small>До 10 МБ на файл · изображения, PDF, текст и CSV</small></div><div v-else-if="!filteredAttachments.length" class="empty-state"><Search :size="24"/><h2>Ничего не найдено</h2><p>Попробуйте другое название файла.</p></div><div v-else class="asset-grid"><article v-for="file in filteredAttachments" :key="file.id" class="asset-card"><a :href="attachmentUrl(file)" target="_blank" rel="noopener" class="asset-preview"><img v-if="file.mime.startsWith('image/')" :src="attachmentUrl(file)" :alt="file.name" loading="lazy"/><FileText v-else :size="36"/></a><div class="asset-details"><strong :title="file.name">{{ file.name }}</strong><span>{{ sizeLabel(file.size) }} · {{ dateLabel(file.createdAt) }}</span><div class="asset-actions"><button class="text-button" @click="attachFromLibrary(file)"><Paperclip :size="13"/> В диалог</button><button class="icon-button" :disabled="busy || !!activeRun" aria-label="Удалить материал" title="Удалить материал" @click="deleteAttachment(file)"><Trash2 :size="13"/></button></div></div></article></div></template>

        <template v-if="view === 'submissions'"><div class="summary-strip"><span class="stat-icon"><MessageSquare :size="20"/></span><div><strong>{{ project?.submissions.length || 0 }}</strong><span>Всего заявок</span></div><div class="summary-note">Формы в предпросмотре не отправляют заявки.</div></div><div v-if="!project?.submissions.length" class="empty-state"><span class="empty-icon"><MessageSquare :size="27"/></span><h2>Здесь появятся ваши клиенты</h2><p>Добавьте форму на сайт и опубликуйте изменения.<br>Новые обращения будут сохраняться здесь.</p><button class="button" :disabled="busy || !!activeRun" @click="addFormTemplate"><Plus :size="15"/> Добавить готовую форму</button><button class="text-button" @click="promptSuggestion('Добавь на сайт форму заявки с именем, телефоном и описанием проекта.')"><Sparkles :size="14"/> Создать форму с ИИ</button></div><div v-else class="submission-list"><article v-for="submission in [...(project?.submissions || [])].reverse()" :key="submission.id" class="submission-card"><header><span><span class="status-dot"/> Новое обращение</span><time>{{ dateLabel(submission.createdAt) }}</time></header><dl><div v-for="(value, key) in submission.data" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl><div class="submission-footer"><span>Форма: {{ submission.formId }}</span><span v-for="delivery in submission.deliveries" :key="delivery.integrationId">{{ project?.integrations.find(i => i.id === delivery.integrationId)?.name || 'Webhook' }} · {{ delivery.status }}</span></div></article></div></template>

        <template v-if="view === 'integrations'"><div class="integration-intro"><div class="integration-intro-icon"><Webhook :size="25"/></div><div><h2>Ваш сайт умеет больше</h2><p>Принимайте заявки в CRM, подключайте аналитику и добавляйте виджеты. Ассистент поможет подготовить код.</p></div><button class="button" @click="promptSuggestion('Помоги добавить интеграцию на сайт. ')" ><Sparkles :size="15"/> Попросить ИИ</button></div><div class="integration-grid"><article v-for="integration in project?.integrations" :key="integration.id" class="integration-card"><div class="integration-card-top"><span class="integration-icon"><Webhook v-if="integration.type === 'webhook'" :size="23"/><Braces v-else :size="23"/></span><span class="status-badge" :class="integration.enabled ? 'enabled' : 'disabled'"><span/>{{ integration.enabled ? 'Включена' : 'Выключена' }}</span></div><h3>{{ integration.name }}</h3><p>{{ integration.type === 'webhook' ? 'Отправка заявок на ваш сервер или в CRM' : 'Аналитика, виджеты и внешние скрипты' }}</p><div class="integration-endpoint">{{ integration.type === 'webhook' ? integration.endpoint : 'Выполняется на опубликованном сайте' }}</div><button class="button full-width" @click="editIntegration(integration)"><Settings2 :size="14"/> Настроить</button></article><button class="integration-add" @click="editIntegration(undefined, 'webhook')"><span class="empty-icon"><Plus :size="22"/></span><strong>Новая интеграция</strong><span>Webhook или скрипт</span></button></div><div class="info-note"><ShieldCheck :size="17"/><p>Секреты webhook хранятся на сервере. Внешние скрипты запускаются после публикации, только если вы их включили.</p></div></template>

        <template v-if="view === 'history'"><div class="current-draft"><div class="draft-icon"><Pencil :size="19"/></div><div><h3>Текущий черновик <span class="version-label">v{{ project?.revision }}</span></h3><p>{{ hasUnpublished ? 'Есть изменения, которые ещё не опубликованы' : 'Совпадает с опубликованной версией' }}</p></div><button class="button" @click="selectView('website')">Открыть <ArrowRight :size="14"/></button></div><div v-if="!project?.releases.length" class="empty-state"><span class="empty-icon"><History :size="27"/></span><h2>История начинается с публикации</h2><p>Опубликуйте сайт, чтобы сохранить его первую версию.<br>Вы сможете восстановить её в любой момент.</p></div><div v-else class="release-timeline"><article v-for="(release, index) in [...(project?.releases || [])].reverse()" :key="release.id" class="release-item"><span class="timeline-marker" :class="{ current: index === 0 }"><Check v-if="index === 0" :size="13"/><Clock3 v-else :size="13"/></span><div class="release-info"><div><h3>{{ release.label || `Версия ${release.revision}` }}</h3><span v-if="index === 0" class="status-badge enabled">На сайте</span><span class="version-label">v{{ release.revision }}</span></div><p>{{ dateLabel(release.createdAt) }}</p></div><button class="button small" :disabled="busy || !!activeRun" @click="openRestore(release)"><RotateCcw :size="14"/> Восстановить</button></article></div></template>

        <template v-if="view === 'code'"><div class="code-workspace"><div class="code-tabs"><button v-for="name in fileNames" :key="name" :class="{ active: codeFile === name }" @click="selectCodeFile(name)"><FileCode2 :size="14"/>{{ name }}<span v-if="codeFile === name && codeDirty" class="unsaved-dot"/></button></div><div class="code-info"><span><Braces :size="13"/> {{ codeFile.endsWith('.json') ? 'JSON' : codeFile.endsWith('.css') ? 'CSS' : 'JavaScript' }}</span><span v-if="codeDirty && project?.revision !== codeRevision" class="warning-text">Черновик изменился. Сохранение проверит конфликт версий.</span><span v-else>Версия {{ codeRevision }}</span></div><textarea v-model="codeValue" class="source-editor" spellcheck="false" :aria-label="`Код ${codeFile}`" @keydown.tab.prevent="insertCodeTab"/><div class="code-footer"><span><ShieldCheck :size="13"/> Код проверяется при сохранении</span><div><button class="button" :disabled="!codeDirty || busy" @click="syncCode">Отменить</button><button class="button primary" :disabled="!codeDirty || busy || !!activeRun" @click="saveCode"><LoaderCircle v-if="busy" class="spin" :size="15"/><Check v-else :size="15"/> Сохранить</button></div></div></div><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div><div v-if="state.validation.errors.length" class="error-banner" role="alert"><p v-for="error in state.validation.errors" :key="error">{{ error }}</p></div><div v-if="state.validation.warnings.length" class="info-note"><CircleHelp :size="17"/><div><p v-for="warning in state.validation.warnings" :key="warning">{{ warning }}</p></div></div></template>
      </div>
    </main>

    <aside v-if="showChat" class="chat-panel" aria-label="ИИ-ассистент">
      <div class="chat-heading"><span class="chat-heading-icon"><Sparkles :size="17"/></span><div><h2>Ассистент сайта</h2><span><span class="status-dot" :class="{ offline: !state.auth.connected }"/>{{ activeRun ? 'Работает над изменениями' : state.auth.connected ? 'Готов к вашим идеям' : 'Готов к подключению' }}</span></div><button class="icon-button" title="Подключение ИИ" aria-label="Подключение ИИ" @click="openModal('connect')"><Settings2 :size="16"/></button><button class="icon-button chat-close" aria-label="Закрыть ассистента" @click="chatOpen = false"><X :size="17"/></button></div>
      <div ref="messagesEl" class="chat-messages">
        <div v-if="!messages.length" class="chat-welcome"><div class="welcome-orbit"><span class="orbit-dot one"/><span class="orbit-dot two"/><div class="welcome-spark"><Sparkles :size="28" :stroke-width="1.5"/></div></div><span class="eyebrow green-text">ОТ ИДЕИ К РЕЗУЛЬТАТУ</span><h2>Что изменим<br>на вашем сайте?</h2><p>Опишите задачу своими словами.<br>Я помогу с текстом, дизайном<br>и новыми возможностями.</p><div class="suggestions"><button @click="promptSuggestion('Добавь форму заявки с именем, телефоном и описанием проекта. Сделай её в стиле сайта.')"><span class="suggestion-icon"><MessageSquare :size="17"/></span><span><strong>Собирать заявки</strong><small>Добавить форму для клиентов</small></span><ArrowUpRight :size="15"/></button><button @click="promptSuggestion('Добавь красивую секцию с отзывами клиентов. Используй редактируемые примеры и стиль сайта.')"><span class="suggestion-icon"><Layers3 :size="17"/></span><span><strong>Добавить секцию</strong><small>Расширить сайт новой идеей</small></span><ArrowUpRight :size="15"/></button><button @click="promptSuggestion('Помоги подключить к сайту аналитику или интеграцию с CRM. Уточни, какой сервис я использую.')"><span class="suggestion-icon"><Link2 :size="17"/></span><span><strong>Подключить сервис</strong><small>CRM, аналитика или виджет</small></span><ArrowUpRight :size="15"/></button></div><div class="welcome-attachment-tip"><Paperclip :size="14"/><span>Добавьте фото, документ или скриншот —<br>так будет проще объяснить идею.</span></div></div>
        <template v-else><article v-for="message in messages" :key="message.id" class="chat-message" :class="message.role"><div v-if="message.role === 'assistant'" class="message-author"><span class="mini-assistant"><Sparkles :size="13"/></span> Forma</div><div class="message-text">{{ message.content }}</div><div v-if="message.attachmentIds?.length" class="message-files"><a v-for="file in messageAttachments(message.attachmentIds)" :key="file.id" :href="attachmentUrl(file)" target="_blank" rel="noopener"><img v-if="file.mime.startsWith('image/')" :src="attachmentUrl(file)" alt=""/><FileText v-else :size="15"/><span>{{ file.name }}</span></a></div></article><div v-if="lastRun?.status === 'failed'" class="run-error" role="alert"><strong>Изменения не завершены</strong><p>{{ lastRun.error || 'Не удалось завершить задачу. Попробуйте ещё раз.' }}</p><button class="text-button" @click="openModal('connect')">Проверить подключение <ArrowRight :size="13"/></button></div><div v-if="lastRun?.status === 'cancelled'" class="run-notice"><Square :size="13"/> Задача остановлена. Черновик сохранён.</div><div v-if="lastRun?.status === 'completed' && lastRun.changes.length" class="changes-card"><span><CheckCheck :size="15"/> Изменения в черновике</span><button v-for="change in lastRun.changes" :key="change.path" @click="selectView('code'); selectCodeFile(change.path)"><FileCode2 :size="13"/> {{ change.path }} <ArrowUpRight :size="12"/></button></div></template>
        <div v-if="activeRun" class="agent-progress" aria-live="polite"><span class="progress-spark"><Sparkles :size="16"/></span><div><strong>{{ activeRun.stage || 'Изучаю ваш сайт…' }}</strong><span>Вы сможете проверить всё перед публикацией</span></div><LoaderCircle class="spin" :size="15"/></div>
      </div>
      <div class="composer-area" @dragover.prevent @drop="dropAttachments"><div v-if="!state.auth.connected" class="connect-strip"><span><span class="status-dot offline"/> Подключите ИИ, чтобы начать</span><button @click="openModal('connect')">Подключить <ArrowUpRight :size="12"/></button></div><div v-if="selectedSection && content?.sections.find(s => s.id === selectedSection)" class="context-strip"><MousePointer2 :size="12"/><span>{{ content.sections.find(s => s.id === selectedSection)?.title }}</span><button class="icon-button" aria-label="Убрать контекст секции" @click="selectedSection = ''"><X :size="12"/></button></div><div class="chat-composer"><div v-if="pendingAttachments.length" class="pending-files"><div v-for="file in pendingAttachments" :key="file.id" class="pending-file"><img v-if="file.mime.startsWith('image/')" :src="attachmentUrl(file)" alt=""/><FileText v-else :size="15"/><span :title="file.name">{{ file.name }}</span><button aria-label="Убрать вложение" @click="attachmentIds = attachmentIds.filter(id => id !== file.id)"><X :size="12"/></button></div></div><textarea ref="composer" v-model="chatText" placeholder="Опишите, что хотите изменить…" aria-label="Сообщение ассистенту" rows="3" @paste="pasteAttachments" @keydown.enter.exact.prevent="sendMessage" @keydown.enter.ctrl.prevent="sendMessage" @keydown.enter.meta.prevent="sendMessage"/><div class="composer-controls"><input ref="uploadInput" type="file" multiple class="visually-hidden" accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.md,.csv,.json" @change="uploadFiles(fileFromEvent($event))"/><button class="icon-button attachment-button" :disabled="uploading || attachmentIds.length >= 5" title="Прикрепить файл (до 10 МБ)" aria-label="Прикрепить файл" @click="uploadInput?.click()"><LoaderCircle v-if="uploading" :size="17" class="spin"/><Paperclip v-else :size="18"/></button><button class="model-button" @click="openModal('connect')"><Sparkles :size="12"/><span>{{ state.auth.model || 'Codex' }}</span><ChevronDown :size="11"/></button><button v-if="activeRun" class="send-button stop-button" title="Остановить" aria-label="Остановить задачу" @click="cancelRun"><Square :size="14" fill="currentColor"/></button><button v-else class="send-button" :disabled="!canSend" aria-label="Отправить сообщение" @click="sendMessage"><ArrowUp :size="18"/></button></div></div><div class="composer-hint"><span>Ваши идеи. Ваш сайт. Под вашим контролем.</span></div><button v-if="!messages.length" class="template-link" :disabled="busy || !!activeRun" @click="addFormTemplate"><Plus :size="12"/> Добавить готовую форму без ИИ</button></div>
    </aside>

    <button v-if="view === 'website' && !showChat" class="mobile-chat-fab" @click="chatOpen = true"><Sparkles :size="20"/> Ассистент</button>
    <div v-if="toast" class="toast" :class="toastType" role="status"><Check v-if="toastType === 'success'" :size="16"/><CircleHelp v-else :size="16"/><span>{{ toast }}</span><button aria-label="Закрыть уведомление" @click="toast = ''"><X :size="14"/></button></div>

    <div v-if="modal" class="modal-backdrop" @mousedown.self="closeModal()"><section ref="formElement" class="modal" :class="{ 'content-modal': modal === 'content', 'integration-modal': modal === 'integration' }" role="dialog" aria-modal="true" :aria-label="modal === 'content' ? 'Редактирование контента' : modal === 'connect' ? 'Подключение ИИ' : modal === 'publish' ? 'Публикация сайта' : modal === 'export' ? 'Экспорт проекта' : modal === 'restore' ? 'Восстановление версии' : 'Настройка интеграции'"><button class="modal-close icon-button" aria-label="Закрыть" :disabled="busy" @click="closeModal()"><X :size="20"/></button>
      <template v-if="modal === 'content' && editorContent"><div class="modal-header"><span class="modal-icon"><Pencil :size="21"/></span><div class="eyebrow">РУЧНОЙ РЕДАКТОР</div><h2>{{ draftSection ? sectionNames[draftSection.type] : 'Настройки сайта' }}</h2><p>Изменения сначала сохранятся в черновик.</p></div><form @submit.prevent="saveContent"><div class="modal-body"><template v-if="draftSection"><div class="field"><label for="section-title">Заголовок</label><input id="section-title" v-model="draftSection.title" required maxlength="200"/></div><div v-if="draftSection.type === 'hero' || draftSection.subtitle !== undefined" class="field"><label for="section-subtitle">Надзаголовок</label><input id="section-subtitle" v-model="draftSection.subtitle"/></div><div class="field"><label for="section-body">Описание</label><textarea id="section-body" v-model="draftSection.body" rows="4"/></div><div class="field" v-if="draftSection.type === 'hero' || draftSection.image !== undefined"><label for="section-image">Изображение</label><select v-if="imageAttachments.length" v-model="draftSection.image" aria-label="Выбрать изображение из материалов" class="image-library-select"><option value="">Выбрать из материалов…</option><option v-for="image in imageAttachments" :key="image.id" :value="image.url">{{ image.name }}</option></select><input id="section-image" v-model="draftSection.image" placeholder="URL изображения или /assets/…"/><small>Загрузите фотографию в материалы или передайте её ассистенту.</small></div><div class="field-pair" v-if="draftSection.type === 'hero' || draftSection.type === 'form' || draftSection.buttonText !== undefined"><div class="field"><label for="button-text">Текст кнопки</label><input id="button-text" v-model="draftSection.buttonText"/></div><div v-if="draftSection.type !== 'form'" class="field"><label for="button-url">Ссылка кнопки</label><input id="button-url" v-model="draftSection.buttonUrl" placeholder="#contacts"/></div></div><template v-if="draftSection.items"><div class="form-section-title"><h3>Карточки</h3><button class="text-button" type="button" @click="draftSection.items.push({ id: newId(), title: '', text: '' })"><Plus :size="13"/> Добавить</button></div><div class="nested-card" v-for="(item, index) in draftSection.items" :key="item.id"><div class="nested-card-title">Карточка {{ index + 1 }}<button class="icon-button" type="button" aria-label="Удалить карточку" @click="draftSection.items.splice(index, 1)"><Trash2 :size="13"/></button></div><div class="field"><label :for="`item-${item.id}`">Название</label><input :id="`item-${item.id}`" v-model="item.title" required/></div><div class="field"><label :for="`item-text-${item.id}`">Описание</label><textarea :id="`item-text-${item.id}`" v-model="item.text" rows="2"/></div></div></template><template v-if="draftSection.fields"><div class="form-section-title"><h3>Поля формы</h3><button class="text-button" type="button" @click="draftSection.fields.push({ name: 'field_' + newId(), label: '', type: 'text' })"><Plus :size="13"/> Добавить</button></div><div class="nested-card" v-for="(field, index) in draftSection.fields" :key="index"><div class="nested-card-title">Поле {{ index + 1 }}<button type="button" class="icon-button" aria-label="Удалить поле" @click="draftSection.fields.splice(index, 1)"><Trash2 :size="13"/></button></div><div class="field-pair"><div class="field"><label :for="`field-label-${index}`">Подпись</label><input :id="`field-label-${index}`" v-model="field.label" required/></div><div class="field"><label :for="`field-type-${index}`">Тип поля</label><select :id="`field-type-${index}`" v-model="field.type"><option value="text">Текст</option><option value="email">Email</option><option value="tel">Телефон</option><option value="textarea">Длинный текст</option></select></div></div><div class="field"><label :for="`field-name-${index}`">Ключ для интеграций</label><input :id="`field-name-${index}`" v-model="field.name" required pattern="[a-zA-Z][a-zA-Z0-9_]*"/></div><label class="checkbox-label"><input v-model="field.required" type="checkbox"/> Обязательное поле</label></div><div class="info-note"><ShieldCheck :size="15"/><p>Заявки появятся в разделе «Заявки» после публикации сайта. В предпросмотре отправка отключена.</p></div></template><div v-if="draftSection.type === 'custom'" class="field"><label for="custom-html">HTML секции</label><textarea id="custom-html" v-model="draftSection.html" rows="7" class="mono-input" spellcheck="false"/><small>Поведение JavaScript редактируется в файле script.js.</small></div><div class="section-order-controls"><span>Порядок секции</span><button type="button" class="button small" :disabled="editorContent.sections[0]?.id === editorSectionId" @click="moveDraftSection(-1)"><ArrowUp :size="13"/> Выше</button><button type="button" class="button small" :disabled="editorContent.sections.at(-1)?.id === editorSectionId" @click="moveDraftSection(1)"><ArrowDown :size="13"/> Ниже</button></div></template><template v-else><div class="field"><label for="site-name">Название сайта</label><input id="site-name" v-model="editorContent.name" required/></div><div class="field"><label for="site-title">Заголовок для поиска</label><input id="site-title" v-model="editorContent.title" required/><small>Отображается во вкладке браузера и поисковых системах.</small></div><div class="field"><label for="site-description">Описание для поиска</label><textarea id="site-description" v-model="editorContent.description" rows="3"/></div><div class="field-pair"><div class="field"><label for="site-email">Email</label><input id="site-email" v-model="editorContent.email" type="email"/></div><div class="field"><label for="site-phone">Телефон</label><input id="site-phone" v-model="editorContent.phone" type="tel"/></div></div><div class="field"><label for="site-accent">Акцентный цвет</label><div class="color-field"><input id="site-accent" v-model="editorContent.accent" type="color"/><input v-model="editorContent.accent" aria-label="Цвет в формате HEX" pattern="#[0-9a-fA-F]{6}"/></div></div></template><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div></div><footer class="modal-footer"><button v-if="draftSection" type="button" class="icon-button danger-text" :disabled="busy" title="Удалить секцию" aria-label="Удалить секцию" @click="deleteDraftSection"><Trash2 :size="17"/></button><span class="footer-spacer"/><button class="button" type="button" :disabled="busy" @click="closeModal()">Отмена</button><button class="button primary" :disabled="busy || !!activeRun" type="submit"><LoaderCircle v-if="busy" :size="15" class="spin"/><Check v-else :size="15"/> Сохранить</button></footer></form></template>

      <template v-if="modal === 'connect'"><div class="modal-header"><span class="modal-icon"><Sparkles :size="23"/></span><div class="eyebrow">У ВАШЕГО САЙТА ЕСТЬ АССИСТЕНТ</div><h2>{{ state.auth.connected ? 'Подключение ИИ' : 'Давайте создадим что-то новое' }}</h2><p>{{ state.auth.connected ? 'Управляйте аккаунтом, который выполняет задачи ИИ.' : 'Подключите свой аккаунт, чтобы редактировать сайт и добавлять возможности через диалог.' }}</p></div><div class="modal-body"><template v-if="state.auth.connected"><div class="connected-account"><span class="account-icon"><Sparkles :size="21"/></span><div><strong>{{ state.auth.provider === 'chatgpt' ? 'ChatGPT' : 'OpenAI API' }}</strong><span>{{ state.auth.email || state.auth.model || 'Аккаунт подключён' }}</span></div><span class="status-badge enabled">Подключён</span></div><div class="info-note"><ShieldCheck :size="17"/><p>Ключи и токены сохраняются только на сервере. Ручное редактирование доступно и без ИИ.</p></div><button class="button full-width" :disabled="busy" @click="disconnectAuth"><Unplug :size="15"/> Отключить аккаунт</button></template><template v-else><div class="auth-tabs"><button :class="{ active: authTab === 'chatgpt' }" @click="authTab = 'chatgpt'">Аккаунт ChatGPT</button><button :class="{ active: authTab === 'api-key' }" @click="authTab = 'api-key'">API-ключ</button></div><form @submit.prevent="connectAuth"><template v-if="authTab === 'chatgpt'"><div class="oauth-description"><div class="oauth-symbol"><Sparkles :size="26"/></div><h3>Ваш ChatGPT — в вашей студии</h3><p>Авторизация откроется в новой вкладке.<br>После входа вернитесь сюда.</p></div><button class="button primary full-width" type="submit" :disabled="busy"><LoaderCircle v-if="busy || oauthWaiting" :size="16" class="spin"/><Sparkles v-else :size="16"/>{{ oauthWaiting ? 'Открыть вход снова' : 'Продолжить с ChatGPT' }}<ArrowUpRight :size="15"/></button><p v-if="oauthWaiting" class="auth-footnote">Ожидаем завершения входа. Подключение обновится автоматически.<br><a v-if="oauthUrl" :href="oauthUrl" target="_blank" rel="noopener" class="oauth-fallback">Открыть страницу входа <ArrowUpRight :size="11"/></a></p><p v-else class="auth-footnote">Для локального личного использования. Доступность зависит от вашего аккаунта и условий OpenAI.</p></template><template v-else><div class="field"><label for="api-key">Секретный API-ключ</label><input id="api-key" v-model="apiKey" type="password" autocomplete="off" placeholder="sk-…" required/><small>Ключ хранится на сервере и не передаётся в код сайта.</small></div><div class="field"><label for="model">Модель <span class="muted">· необязательно</span></label><input id="model" v-model="model" placeholder="Модель по умолчанию"/></div><button class="button primary full-width" :disabled="busy || !apiKey.trim()" type="submit"><LoaderCircle v-if="busy" :size="16" class="spin"/><Link2 v-else :size="16"/> Подключить</button><p class="auth-footnote">Использование API оплачивается в вашем аккаунте OpenAI.</p></template></form></template><div v-if="authError || state.auth.error" class="error-banner" role="alert">{{ authError || state.auth.error }}</div></div></template>

      <template v-if="modal === 'integration'"><div class="modal-header"><span class="modal-icon"><Link2 :size="22"/></span><div class="eyebrow">НОВЫЕ ВОЗМОЖНОСТИ</div><h2>{{ project?.integrations.some(i => i.id === integrationDraft.id) ? 'Настройка интеграции' : 'Подключить интеграцию' }}</h2><p>Сохраните настройки, затем опубликуйте сайт.</p></div><form @submit.prevent="saveIntegration"><div class="modal-body"><div class="auth-tabs"><button type="button" :class="{ active: integrationDraft.type === 'webhook' }" @click="integrationDraft.type = 'webhook'; integrationDraft.enabled = true"><Webhook :size="15"/> Webhook</button><button type="button" :class="{ active: integrationDraft.type === 'script' }" @click="integrationDraft.type = 'script'; integrationDraft.enabled = false"><Braces :size="15"/> Скрипт</button></div><div class="field"><label for="integration-name">Название</label><input id="integration-name" v-model="integrationDraft.name" placeholder="Например, заявки в CRM" required maxlength="100"/></div><template v-if="integrationDraft.type === 'webhook'"><div class="field"><label for="integration-url">URL для отправки заявок</label><input id="integration-url" v-model="integrationDraft.endpoint" type="url" placeholder="https://…" required/><small>Сервер отправит JSON с данными формы на этот адрес.</small></div><div class="field"><label for="integration-secret">Секретный токен <span class="muted">· необязательно</span></label><input id="integration-secret" v-model="integrationSecret" type="password" autocomplete="new-password" :placeholder="integrationDraft.secretConfigured ? 'Сохранён. Оставьте пустым, чтобы не менять.' : 'Bearer-токен вашего сервиса'"/><small>Не попадает в исходный код или экспорт сайта.</small></div></template><template v-else><div class="field"><label for="integration-script">Код скрипта</label><textarea id="integration-script" v-model="integrationDraft.script" rows="7" class="mono-input" placeholder="JavaScript без тегов &lt;script&gt;" required spellcheck="false"/></div><div class="info-note"><ShieldCheck :size="17"/><p>Скрипт сможет выполняться в браузере посетителя. Используйте код сервиса, которому доверяете. В предпросмотре он отключён.</p></div></template><label class="toggle-row"><div><strong>{{ integrationDraft.type === 'script' ? 'Разрешить выполнение скрипта' : 'Отправлять новые заявки' }}</strong><span>После следующей публикации сайта</span></div><input v-model="integrationDraft.enabled" type="checkbox"/><span class="toggle-track"/></label><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div></div><footer class="modal-footer"><button v-if="project?.integrations.some(i => i.id === integrationDraft.id)" type="button" class="icon-button danger-text" :disabled="busy" aria-label="Удалить интеграцию" @click="deleteIntegration"><Trash2 :size="17"/></button><span class="footer-spacer"/><button type="button" class="button" :disabled="busy" @click="closeModal()">Отмена</button><button class="button primary" type="submit" :disabled="busy || !!activeRun"><LoaderCircle v-if="busy" class="spin" :size="15"/> Сохранить</button></footer></form></template>

      <template v-if="modal === 'export'"><div class="modal-header"><span class="modal-icon"><Code2 :size="23"/></span><div class="eyebrow">ВАШ САЙТ — ВАШ КОД</div><h2>Экспорт проекта</h2><p>Скачайте исходный проект с текущим контентом, стилями и скриптами.</p></div><div class="modal-body"><button class="export-option" :disabled="busy" @click="exportProject('nuxt')"><span class="framework-icon nuxt">N</span><span><strong>Nuxt</strong><small>Vue · стартовый проект</small></span><ArrowDownToLine :size="19"/></button><button class="export-option" :disabled="busy" @click="exportProject('next')"><span class="framework-icon next">N<span>↗</span></span><span><strong>Next.js</strong><small>React · стартовый проект</small></span><ArrowDownToLine :size="19"/></button><div class="info-note"><FileText :size="17"/><p>Архив содержит инструкцию по запуску. Серверные секреты исключены. Для приёма заявок после переноса потребуется настроить обработчик.</p></div><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div></div></template>

      <template v-if="modal === 'publish'"><div class="modal-header"><span class="modal-icon"><Globe2 :size="23"/></span><div class="eyebrow">ОПУБЛИКОВАННАЯ ВЕРСИЯ</div><h2>Локальная публикация</h2><p>Черновик версии {{ project?.revision }} станет доступен на опубликованном сайте.</p></div><div class="modal-body"><div class="publish-check"><Check :size="16"/> Контент и код прошли проверку</div><div class="publish-check"><Check :size="16"/> Текущую версию можно будет восстановить</div><div v-if="project?.integrations.some(i => i.type === 'script' && i.enabled)" class="info-note"><Braces :size="17"/><p>На сайте будут запущены включённые внешние скрипты. Проверьте настройки интеграций перед публикацией.</p></div><div v-if="state.validation.warnings.length" class="warning-banner"><p v-for="warning in state.validation.warnings" :key="warning">{{ warning }}</p></div><a :href="state.previewUrl" target="_blank" rel="noopener" class="preview-before-publish">Ещё раз посмотреть черновик <ExternalLink :size="14"/></a><p class="auth-footnote">MVP публикует сайт на локальном сервере. Для публичного домена экспортируйте проект на ваш хостинг.</p><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div></div><footer class="modal-footer"><button class="button" :disabled="busy" @click="closeModal()">Пока нет</button><button class="button primary" :disabled="busy || !state.validation.valid || !!activeRun" @click="publish"><LoaderCircle v-if="busy" class="spin" :size="15"/><ArrowUpRight v-else :size="15"/> Опубликовать</button></footer></template>

      <template v-if="modal === 'restore'"><div class="modal-header"><span class="modal-icon"><RotateCcw :size="23"/></span><div class="eyebrow">ИСТОРИЯ САЙТА</div><h2>Восстановить версию {{ restoreRelease?.revision }}?</h2><p>Она заменит текущий черновик вместе с контентом, кодом и интеграциями. Опубликованный сайт изменится после вашей следующей публикации.</p></div><div class="modal-body"><div class="restore-preview"><History :size="19"/><div><strong>{{ restoreRelease?.label }}</strong><span>{{ restoreRelease && dateLabel(restoreRelease.createdAt) }}</span></div></div><div v-if="actionError" class="error-banner" role="alert">{{ actionError }}</div></div><footer class="modal-footer"><button class="button" :disabled="busy" @click="closeModal()">Отмена</button><button class="button primary" :disabled="busy || !!activeRun" @click="restore"><LoaderCircle v-if="busy" class="spin" :size="15"/><RotateCcw v-else :size="15"/> Восстановить черновик</button></footer></template>
    </section></div>
  </div>
</template>
