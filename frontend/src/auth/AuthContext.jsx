import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(undefined);

const USER_STORAGE_KEY = 'user';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const { data } = await authApi.me();
        setUser(data);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
      } catch {
        localStorage.removeItem('authToken');
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
    };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isDemoMode: false,
      login: async (email, password) => {
        localStorage.removeItem('authToken');
        localStorage.removeItem(USER_STORAGE_KEY);
        const { data } = await authApi.login({ email, password });
        localStorage.setItem('authToken', data.access_token);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        setUser(data.user);
        return data;
      },
      logout: async () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
