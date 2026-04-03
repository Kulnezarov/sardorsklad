import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';
import './LoginPage.css';

const LoginPage = () => {
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login: signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!loginValue || !password) {
      toast.error('Заполните все поля');
      return;
    }

    setLoading(true);
    
    try {
      await signIn(loginValue, password);
      toast.success('Вход выполнен успешно');
      navigate('/dashboard');
    } catch (error) {
      const d = error?.response?.data?.detail;
      const msg =
        typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join(', ') : error?.message;
      toast.error(msg || 'Ошибка при входе');
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
          <p className="login-subtitle">Вход в систему склада</p>
        </div>
        
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              value={loginValue}
              onChange={(e) => setLoginValue(e.target.value)}
              placeholder="name@example.com"
              required
              className="form-input"
              autoComplete="username"
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите ваш пароль"
              required
              className="form-input"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="form-button"
          >
            {loading ? 'Вход...' : 'Войти в систему'}
          </button>

          <div className="login-footer">
            <p className="login-footer-text">
              Нет аккаунта?{' '}
              <Link to="/register" style={{ color: 'var(--accent, #2563eb)' }}>
                Регистрация
              </Link>
            </p>
          </div>
        </form>
      </div>
      
      <p className="login-copyright">
        © 2026 SkladPro. Все права защищены.
      </p>
    </div>
  );
};

export default LoginPage;
