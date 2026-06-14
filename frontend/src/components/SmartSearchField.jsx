import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiMic, FiSearch, FiX } from 'react-icons/fi';

/**
 * Поле умного поиска с микрофоном (Web Speech API).
 */
export default function SmartSearchField({
  value,
  onChange,
  placeholder = 'Поиск…',
  className = '',
  inputClassName = 'ios-input',
  debounceMs = 0,
  enableVoice = true,
  disabled = false,
  autoFocus = false,
  loading = false,
}) {
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [focused, setFocused] = useState(false);
  const recognitionRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    setVoiceSupported(Boolean(SR) && enableVoice);
    return () => {
      recognitionRef.current?.stop?.();
    };
  }, [enableVoice]);

  const emitChange = useCallback(
    (v) => {
      if (debounceMs > 0) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onChange(v), debounceMs);
      } else {
        onChange(v);
      }
    },
    [onChange, debounceMs],
  );

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || disabled) return;
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recognitionRef.current = rec;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) onChange(text);
    };
    rec.start();
  };

  const stopVoice = () => {
    recognitionRef.current?.stop?.();
    setListening(false);
  };

  const hasActions = loading || value || (voiceSupported && enableVoice);

  return (
    <div className={`smart-search-wrap ${className}`.trim()}>
      <div
        className={`smart-search-field${focused ? ' smart-search-field--focused' : ''}${listening ? ' smart-search-field--listening' : ''}${disabled ? ' smart-search-field--disabled' : ''}`}
      >
        <span className="smart-search-field-icon" aria-hidden>
          {loading ? <span className="smart-search-spinner" /> : <FiSearch size={18} />}
        </span>
        <input
          type="text"
          className={`${inputClassName} smart-search-field-input`}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => emitChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {hasActions && (
          <div className="smart-search-field-actions">
            {value && !loading && (
              <button
                type="button"
                className="smart-search-field-action"
                aria-label="Очистить"
                onClick={() => onChange('')}
              >
                <FiX size={17} />
              </button>
            )}
            {voiceSupported && enableVoice && !loading && (
              <button
                type="button"
                className={`smart-search-field-action smart-search-field-mic${listening ? ' smart-search-field-mic--active' : ''}`}
                aria-label={listening ? 'Остановить' : 'Голосовой поиск'}
                onClick={listening ? stopVoice : startVoice}
                disabled={disabled}
              >
                <FiMic size={17} />
              </button>
            )}
          </div>
        )}
      </div>
      {listening && (
        <p className="smart-search-listening-hint">Слушаю… говорите название или штрих-код</p>
      )}
    </div>
  );
}
