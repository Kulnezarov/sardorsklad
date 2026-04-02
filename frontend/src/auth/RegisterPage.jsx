import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';
import './LoginPage.css';

function apiErrorMessage(error) {
  const d = error?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d[0]?.msg) return d.map((x) => x.msg).join(', ');
  return error?.message || 'Ошибка';
}

const RegisterPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Заполните email и пароль');
      return;
    }
    if (password.length < 6) {
      toast.error('Пароль не короче 6 символов');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, fullName.trim() || undefined);
      toast.success('Аккаунт создан');
      navigate('/dashboard');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-bg-orb login-bg-orb-top" />
      <div className="login-bg-orb login-bg-orb-bottom" />
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h2 className="login-title">SkladPro</h2>
          <p className="login-subtitle">Регистрация</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
              className="form-input"
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Имя (необязательно)</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Имя"
              className="form-input"
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Не менее 6 символов"
              required
              minLength={6}
              className="form-input"
              autoComplete="new-password"
            />
          </div>

          <button type="submit" disabled={loading} className="form-button">
            {loading ? 'Создание...' : 'Зарегистрироваться'}
          </button>

          <div className="login-footer">
            <p className="login-footer-text">
              Уже есть аккаунт?{' '}
              <Link to="/login" style={{ color: 'var(--accent, #2563eb)' }}>
                Войти
              </Link>
            </p>
          </div>
        </form>
      </div>

      <p className="login-copyright">© 2026 SkladPro. Все права защищены.</p>
    </div>
  );
};

export default RegisterPage;
