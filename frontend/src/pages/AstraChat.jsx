import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiSend, FiImage, FiTrash2, FiX, FiLoader } from 'react-icons/fi';
import { astraChatApi } from '../api/client';

const STORAGE_KEY = 'astra-chat-history';
const MAX_HISTORY = 50;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
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

function AstraLogo({ size = 88 }) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '28%',
        background: 'linear-gradient(145deg, #6366f1 0%, #4f46e5 40%, #7c3aed 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 800,
        fontSize: size * 0.38,
        letterSpacing: '-0.06em',
        boxShadow: '0 12px 40px rgba(99, 102, 241, 0.45)',
        flexShrink: 0,
      }}
    >
      A
    </div>
  );
}

const AstraChat = () => {
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (data) => astraChatApi.send(data),
    onSuccess: (res) => {
      const reply = res.data?.reply || 'Нет ответа';
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    },
    onError: (err) => {
      const detail = err.response?.data?.detail || err.message || 'Ошибка';
      toast.error(`ASTRA: ${detail}`);
      setMessages((prev) => [...prev, { role: 'assistant', text: `Ошибка: ${detail}` }]);
    },
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text && !photoBase64) return;

    const userMessage = { role: 'user', text: text || '📷 Фото', photo: photoPreview || undefined };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setPhotoPreview(null);

    const historyForApi = updatedMessages
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

  const clearChat = () => {
    if (!window.confirm('Очистить историю чата с ASTRA?')) return;
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const removePhoto = () => {
    setPhotoPreview(null);
    setPhotoBase64(null);
  };

  const hasThread = messages.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 'min(100dvh - 120px, calc(100vh - 120px))',
        maxWidth: 720,
        margin: '0 auto',
        width: '100%',
        padding: '0 env(safe-area-inset-right, 0) 0 env(safe-area-inset-left, 0)',
      }}
    >
      <style>{`
        @keyframes astra-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Верхняя панель */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ transform: 'scale(0.55)', transformOrigin: 'left center' }}>
            <AstraLogo size={72} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', letterSpacing: '-0.02em' }}>ASTRA</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Gemini · автозапчасти</div>
          </div>
        </div>
        {hasThread && (
          <button
            type="button"
            onClick={clearChat}
            title="Очистить чат"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            <FiTrash2 size={16} />
          </button>
        )}
      </div>

      {/* Область контента: приветствие по центру или переписка */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {!hasThread ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '24px 20px 100px',
              background:
                'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(99, 102, 241, 0.12), transparent 55%), var(--bg, transparent)',
            }}
          >
            <AstraLogo size={96} />
            <h1
              style={{
                margin: '28px 0 0',
                fontSize: 'clamp(1.25rem, 4.5vw, 1.5rem)',
                fontWeight: 700,
                color: 'var(--text)',
                lineHeight: 1.35,
                maxWidth: 320,
              }}
            >
              Привет, я ASTRA
            </h1>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 'clamp(1rem, 3.5vw, 1.125rem)',
                fontWeight: 500,
                color: 'var(--text-muted)',
                maxWidth: 280,
                lineHeight: 1.45,
              }}
            >
              ваш личный помощник
            </p>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '8px 12px 8px',
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    maxWidth: 'min(85%, 520px)',
                    padding: '12px 16px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background:
                      msg.role === 'user'
                        ? 'linear-gradient(135deg, #6366f1, #7c3aed)'
                        : 'var(--ios-grouped-bg)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text)',
                    fontSize: 14,
                    lineHeight: 1.55,
                    fontWeight: 500,
                    border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxShadow: msg.role === 'user' ? '0 4px 12px rgba(99, 102, 241, 0.25)' : 'none',
                  }}
                >
                  {msg.photo && (
                    <img
                      src={msg.photo}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 12, marginBottom: 8, display: 'block' }}
                    />
                  )}
                  {msg.text}
                </div>
              </div>
            ))}

            {sendMutation.isPending && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '18px 18px 18px 4px',
                    background: 'var(--ios-grouped-bg)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: 'var(--text-muted)',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  <FiLoader size={16} style={{ animation: 'astra-spin 1s linear infinite' }} />
                  ASTRA думает...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Превью фото */}
      {photoPreview && (
        <div style={{ padding: '0 12px 6px', flexShrink: 0 }}>
          <div
            style={{
              display: 'inline-flex',
              position: 'relative',
              borderRadius: 14,
              overflow: 'hidden',
              border: '2px solid var(--primary)',
              background: 'var(--surface)',
            }}
          >
            <img src={photoPreview} alt="" style={{ height: 72, display: 'block' }} />
            <button
              type="button"
              onClick={removePhoto}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 26,
                height: 26,
                borderRadius: 8,
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FiX size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Поле ввода — снизу, как в ChatGPT */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px calc(12px + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 22,
            background: 'var(--ios-grouped-bg)',
            border: '1px solid var(--border)',
            maxWidth: '100%',
          }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Фото"
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              border: 'none',
              background: 'var(--surface)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              flexShrink: 0,
            }}
          >
            <FiImage size={20} />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />

          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Сообщение для ASTRA..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '16px',
              fontWeight: 500,
              color: 'var(--text)',
              resize: 'none',
              fontFamily: 'inherit',
              minHeight: 42,
              maxHeight: 120,
              padding: '8px 4px',
              lineHeight: 1.4,
            }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={sendMutation.isPending || (!input.trim() && !photoBase64)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              border: 'none',
              background:
                (input.trim() || photoBase64) && !sendMutation.isPending
                  ? 'linear-gradient(135deg, #6366f1, #7c3aed)'
                  : 'var(--bg-secondary)',
              color: (input.trim() || photoBase64) && !sendMutation.isPending ? '#fff' : 'var(--text-muted)',
              cursor: sendMutation.isPending ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow:
                (input.trim() || photoBase64) && !sendMutation.isPending
                  ? '0 4px 12px rgba(99, 102, 241, 0.3)'
                  : 'none',
            }}
          >
            {sendMutation.isPending ? (
              <FiLoader size={18} style={{ animation: 'astra-spin 1s linear infinite' }} />
            ) : (
              <FiSend size={18} />
            )}
          </button>
        </div>
        <p style={{ textAlign: 'center', margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
          Сардор Кулнезаров · Gemini
        </p>
      </div>
    </div>
  );
};

export default AstraChat;
