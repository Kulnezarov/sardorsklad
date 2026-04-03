import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Send,
  Loader2,
  ImagePlus,
  Trash2,
  X,
  User,
  PanelLeftClose,
  PanelLeft,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react';
import { astraChatApi } from '../api/client';

const WINDOW_BASE = 5;
const LOAD_CHUNK = 5;
const MAX_VISIBLE = 50;

const STORAGE = {
  WIPE_DAY: 'astra-wipe-day-v1',
  SESSIONS: 'astra-sessions-v1',
  CURRENT: 'astra-current-messages-v1',
};

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minutesSinceMidnight(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function persistWipeDay() {
  localStorage.setItem(STORAGE.WIPE_DAY, localDateKey());
}

function shouldRunDailyWipe() {
  if (minutesSinceMidnight() < 2) return false;
  const today = localDateKey();
  const last = localStorage.getItem(STORAGE.WIPE_DAY);
  if (last == null || last === '') {
    persistWipeDay();
    return false;
  }
  return last !== today;
}

function hardWipeAll() {
  localStorage.removeItem(STORAGE.CURRENT);
  localStorage.removeItem(STORAGE.SESSIONS);
  persistWipeDay();
}

function loadCurrent() {
  try {
    const raw = localStorage.getItem(STORAGE.CURRENT);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function saveCurrent(messages) {
  try {
    localStorage.setItem(STORAGE.CURRENT, JSON.stringify(messages));
  } catch {}
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE.SESSIONS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function saveSessions(list) {
  try {
    localStorage.setItem(STORAGE.SESSIONS, JSON.stringify(list.slice(0, 40)));
  } catch {}
}

function newId() {
  return crypto.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resizeImage(file, maxSize = 800) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function AstraAvatar({ className = '' }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-600 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/30 ${className}`}
      aria-hidden
    >
      A
    </div>
  );
}

function UserAvatar({ className = '' }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-600 bg-zinc-800 text-zinc-200 ${className}`}
      aria-hidden
    >
      <User className="h-4 w-4" strokeWidth={2} />
    </div>
  );
}

function TypewriterText({ text, active, className, onComplete }) {
  const [shown, setShown] = useState(active ? '' : text);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) {
      setShown(text);
      return undefined;
    }
    setShown('');
    let i = 0;
    const delay = text.length > 500 ? 6 : 12;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        onCompleteRef.current?.();
      }
    }, delay);
    return () => window.clearInterval(id);
  }, [text, active]);

  return <span className={className}>{shown}</span>;
}

const AstraChat = () => {
  const [archive, setArchive] = useState(loadCurrent);
  const [sessions, setSessions] = useState(loadSessions);
  const [olderLoaded, setOlderLoaded] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [typewriterMsgId, setTypewriterMsgId] = useState(null);

  const scrollRef = useRef(null);
  const loadLockRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const applyDailyWipe = useCallback(() => {
    if (!shouldRunDailyWipe()) return;
    hardWipeAll();
    setArchive([]);
    setSessions([]);
    setOlderLoaded(0);
    setTypewriterMsgId(null);
    toast.success('ASTRA: новый день — история очищена (00:02).');
  }, []);

  useEffect(() => {
    applyDailyWipe();
    const t = setInterval(applyDailyWipe, 60_000);
    return () => clearInterval(t);
  }, [applyDailyWipe]);

  useEffect(() => {
    saveCurrent(archive);
  }, [archive]);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const visibleCount = useMemo(() => {
    const n = archive.length;
    if (n === 0) return 0;
    const want = Math.min(n, Math.min(MAX_VISIBLE, WINDOW_BASE + olderLoaded));
    return want;
  }, [archive.length, olderLoaded]);

  const visibleMessages = useMemo(() => {
    if (!archive.length) return [];
    return archive.slice(-visibleCount);
  }, [archive, visibleCount]);

  const scrollToBottomSmooth = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    if (olderLoaded === 0) scrollToBottomSmooth();
  }, [archive.length, olderLoaded, scrollToBottomSmooth]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevScrollHeightRef.current === 0) return;
    const diff = el.scrollHeight - prevScrollHeightRef.current;
    if (diff > 0) el.scrollTop += diff;
    prevScrollHeightRef.current = 0;
  }, [visibleMessages.length, olderLoaded]);

  const sendMutation = useMutation({
    mutationFn: (data) => astraChatApi.send(data),
    onSuccess: (res, variables) => {
      const reply = res.data?.reply || 'Нет ответа';
      const assistantId = newId();
      setArchive((prev) => [...prev, { id: assistantId, role: 'assistant', text: reply }]);
      setTypewriterMsgId(assistantId);
      setOlderLoaded(0);
    },
    onError: (err) => {
      const detail = err.response?.data?.detail || err.message || 'Ошибка';
      toast.error(`ASTRA: ${detail}`);
      const assistantId = newId();
      setArchive((prev) => [...prev, { id: assistantId, role: 'assistant', text: `Ошибка: ${detail}` }]);
      setTypewriterMsgId(assistantId);
      setOlderLoaded(0);
    },
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || loadLockRef.current) return;
    if (el.scrollTop < 72 && olderLoaded + WINDOW_BASE < archive.length) {
      loadLockRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      setOlderLoaded((o) => Math.min(o + LOAD_CHUNK, Math.max(0, archive.length - WINDOW_BASE)));
      window.setTimeout(() => {
        loadLockRef.current = false;
      }, 400);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text && !photoBase64) return;

    const userId = newId();
    const userMessage = {
      id: userId,
      role: 'user',
      text: text || '📷 Фото',
      photo: photoPreview || undefined,
    };

    setArchive((prev) => [...prev, userMessage]);

    setInput('');
    setPhotoPreview(null);
    setOlderLoaded(0);
    setTypewriterMsgId(null);

    const historyForApi = [...archive, userMessage]
      .filter((m) => !m.photo)
      .map((m) => ({ role: m.role, text: m.text }));

    sendMutation.mutate({
      message: text || 'Что на этом фото?',
      photo_base64: photoBase64 || undefined,
      history: historyForApi.slice(-20),
    });

    setPhotoBase64(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const dataUrl = await resizeImage(file, 800);
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl);
      inputRef.current?.focus();
    } catch {
      toast.error('Не удалось загрузить фото');
    }
  };

  const newChat = () => {
    if (archive.length > 0) {
      const title =
        archive.find((m) => m.role === 'user' && m.text && !m.text.startsWith('📷'))?.text?.slice(0, 48) ||
        'Диалог';
      setSessions((prev) => [
        { id: newId(), title, updatedAt: Date.now(), messages: [...archive] },
        ...prev,
      ]);
    }
    setArchive([]);
    setOlderLoaded(0);
    setTypewriterMsgId(null);
    saveCurrent([]);
  };

  const openSession = (s) => {
    if (archive.length > 0) {
      const title =
        archive.find((m) => m.role === 'user' && m.text && !m.text.startsWith('📷'))?.text?.slice(0, 48) ||
        'Диалог';
      setSessions((prev) => [{ id: newId(), title, updatedAt: Date.now(), messages: [...archive] }, ...prev]);
    }
    setArchive(Array.isArray(s.messages) ? [...s.messages] : []);
    setOlderLoaded(0);
    setTypewriterMsgId(null);
    setSidebarOpen(false);
  };

  const deleteSession = (id, e) => {
    e.stopPropagation();
    setSessions((prev) => prev.filter((x) => x.id !== id));
  };

  const clearEverything = () => {
    if (!window.confirm('Удалить текущий чат и всю историю в боковой панели?')) return;
    hardWipeAll();
    setArchive([]);
    setSessions([]);
    setOlderLoaded(0);
    setTypewriterMsgId(null);
  };

  const removePhoto = () => {
    setPhotoPreview(null);
    setPhotoBase64(null);
  };

  const hasThread = archive.length > 0;
  const canLoadMore = olderLoaded + WINDOW_BASE < archive.length;

  return (
    <div className="flex h-[min(100dvh-56px,calc(100vh-56px))] min-h-[420px] w-full max-w-[1400px] mx-auto bg-zinc-950 text-zinc-100 antialiased rounded-xl overflow-hidden border border-zinc-800 shadow-2xl shadow-black/40">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Закрыть меню"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed z-50 flex h-[min(100dvh-56px,calc(100vh-56px))] w-[min(100%,280px)] flex-col border-r border-zinc-800 bg-zinc-900/95 backdrop-blur-md transition-transform md:static md:z-0 md:w-64
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:min-w-0 md:border-0 md:overflow-hidden md:p-0 md:opacity-0'}
        `}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
          <Sparkles className="h-5 w-5 text-indigo-400" />
          <span className="font-semibold tracking-tight">ASTRA</span>
        </div>
        <button
          type="button"
          onClick={newChat}
          className="m-2 flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/80 py-2.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Новый чат
        </button>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">История</p>
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-xs text-zinc-500">Сохранённые диалоги появятся после «Новый чат».</p>
          )}
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openSession(s)}
                  className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-800"
                >
                  <MessageSquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 group-hover:text-indigo-400" />
                  <span className="line-clamp-2 flex-1">{s.title}</span>
                  <button
                    type="button"
                    onClick={(e) => deleteSession(s.id, e)}
                    className="shrink-0 rounded p-1 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
                    title="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-zinc-800 p-2 text-[10px] leading-relaxed text-zinc-500">
          Эксперт по автозапчастям и ТО. Сброс истории каждый день в 00:02.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2 md:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 md:hidden"
            aria-label="Меню"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 md:flex"
            title="Панель истории"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1 text-center md:text-left">
            <h1 className="truncate text-sm font-semibold text-zinc-100">ASTRA · автозапчасти</h1>
            <p className="truncate text-xs text-zinc-500">Точные ответы по каталогам, совместимости и обслуживанию</p>
          </div>
          {hasThread && (
            <button
              type="button"
              onClick={clearEverything}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition hover:border-red-900/50 hover:bg-red-950/30 hover:text-red-300"
              title="Очистить всё"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </header>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto scroll-smooth"
        >
          {!hasThread ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 pb-32 text-center">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(99,102,241,0.15),transparent)]" />
              <AstraAvatar className="!h-20 !w-20 !text-2xl !rounded-2xl" />
              <h2 className="relative mt-8 text-xl font-semibold text-zinc-100 sm:text-2xl">Привет, я ASTRA</h2>
              <p className="relative mt-2 max-w-sm text-sm text-zinc-400">Ваш личный помощник по автозапчастям и техобслуживанию.</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-3 py-4 md:px-6">
              {canLoadMore && (
                <div className="mb-4 flex justify-center">
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-500">
                    Прокрутите вверх для более ранних сообщений
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-4">
                {visibleMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.role === 'assistant' ? <AstraAvatar /> : <UserAvatar />}
                    <div
                      className={`max-w-[min(100%,560px)] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-indigo-600 to-violet-700 text-white'
                          : 'border border-zinc-700/80 bg-zinc-900 text-zinc-100'
                      }`}
                    >
                      {msg.photo && (
                        <img src={msg.photo} alt="" className="mb-2 max-h-52 w-full rounded-lg object-contain" />
                      )}
                      {msg.role === 'assistant' ? (
                        <TypewriterText
                          text={msg.text}
                          active={msg.id === typewriterMsgId}
                          onComplete={() => {
                            if (msg.id === typewriterMsgId) setTypewriterMsgId(null);
                          }}
                          className="whitespace-pre-wrap break-words"
                        />
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{msg.text}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {sendMutation.isPending && (
                <div className="mt-4 flex gap-3">
                  <AstraAvatar />
                  <div className="flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    ASTRA готовит ответ…
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} className="h-px w-full shrink-0" />
            </div>
          )}
        </div>

        {photoPreview && (
          <div className="shrink-0 border-t border-zinc-800 px-3 py-2 md:px-6">
            <div className="relative inline-block overflow-hidden rounded-xl border-2 border-indigo-500">
              <img src={photoPreview} alt="" className="h-20 object-cover" />
              <button
                type="button"
                onClick={removePhoto}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/90 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-950/80 p-2 shadow-inner">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-indigo-400 transition hover:bg-zinc-800"
              title="Фото"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Спросите о запчастях, артикулах, совместимости…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKeyDown}
              className="max-h-[120px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sendMutation.isPending || (!input.trim() && !photoBase64)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sendMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-600">Профессиональный тон · данные не для замены сервисной документации OEM</p>
        </div>
      </div>
    </div>
  );
};

export default AstraChat;
