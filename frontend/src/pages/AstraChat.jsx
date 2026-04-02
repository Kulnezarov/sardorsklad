import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiSend, FiImage, FiTrash2, FiX, FiLoader } from 'react-icons/fi';
import { astraChatApi } from '../api/client';

const STORAGE_KEY = 'astra-chat-history';
const MAX_HISTORY = 50;

const WELCOME_MESSAGE = {
  role: 'assistant',
  text: 'Привет! Я ASTRA — ваш ИИ-ассистент по китайским автозапчастям.\n\nЯ могу:\n• Найти товары на складе\n• Определить запчасть по фото\n• Подсказать аналоги и OEM-номера\n• Помочь с ценообразованием\n• Отвечать на русском, китайском 🇨🇳 и узбекском 🇺🇿\n\nЧем могу помочь?',
};

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
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
    scrollToBottom();
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
    setMessages([WELCOME_MESSAGE]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const removePhoto = () => {
    setPhotoPreview(null);
    setPhotoBase64(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 900, margin: '0 auto', padding: '0 10px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 6px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #6366f1, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18, flexShrink: 0, boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
            A
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)', letterSpacing: '-0.02em' }}>ASTRA</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>ИИ-ассистент по автозапчастям</div>
          </div>
        </div>
        <button
          type="button"
          onClick={clearChat}
          title="Очистить чат"
          style={{ width: 38, height: 38, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}
        >
          <FiTrash2 size={16} />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 4px 12px' }}>
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
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #6366f1, #7c3aed)'
                  : 'var(--ios-grouped-bg)',
                color: msg.role === 'user' ? '#fff' : 'var(--text)',
                fontSize: 14,
                lineHeight: 1.55,
                fontWeight: 500,
                border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxShadow: msg.role === 'user' ? '0 4px 12px rgba(99,102,241,0.25)' : 'none',
              }}
            >
              {msg.photo && (
                <img
                  src={msg.photo}
                  alt="Фото"
                  style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 12, marginBottom: 8, display: 'block' }}
                />
              )}
              {msg.text}
            </div>
          </div>
        ))}

        {sendMutation.isPending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
            <div style={{
              padding: '14px 20px', borderRadius: '18px 18px 18px 4px',
              background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10,
              color: 'var(--text-muted)', fontSize: 14, fontWeight: 500,
            }}>
              <FiLoader size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ASTRA думает...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Photo preview */}
      {photoPreview && (
        <div style={{ padding: '8px 8px 0', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', position: 'relative', borderRadius: 14, overflow: 'hidden', border: '2px solid var(--primary)', background: 'var(--surface)' }}>
            <img src={photoPreview} alt="Превью" style={{ height: 80, borderRadius: 12, display: 'block' }} />
            <button
              type="button"
              onClick={removePhoto}
              style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <FiX size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 4px 14px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          padding: '8px 10px', borderRadius: 20,
          background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)',
        }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Прикрепить фото"
            style={{ width: 40, height: 40, borderRadius: 12, border: 'none', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}
          >
            <FiImage size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhoto}
          />

          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Спросите ASTRA..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 15, fontWeight: 500, color: 'var(--text)',
              resize: 'none', fontFamily: 'inherit',
              minHeight: 40, maxHeight: 120, padding: '8px 4px', lineHeight: 1.4,
            }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={sendMutation.isPending || (!input.trim() && !photoBase64)}
            style={{
              width: 42, height: 42, borderRadius: 14, border: 'none',
              background: (input.trim() || photoBase64) && !sendMutation.isPending
                ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'var(--bg-secondary)',
              color: (input.trim() || photoBase64) && !sendMutation.isPending ? '#fff' : 'var(--text-muted)',
              cursor: sendMutation.isPending ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: (input.trim() || photoBase64) && !sendMutation.isPending ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {sendMutation.isPending ? <FiLoader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <FiSend size={18} />}
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
          ASTRA by Сардор Кулнезаров · Gemini AI
        </div>
      </div>
    </div>
  );
};

export default AstraChat;
