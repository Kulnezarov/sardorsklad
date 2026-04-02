import React, { Component, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import PrivateRoute from './auth/PrivateRoute';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import CnyRateSync from './components/CnyRateSync';
import LoginPage from './auth/LoginPage';
import RegisterPage from './auth/RegisterPage';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Sales from './pages/Sales';
import ProductFound from './pages/ProductFound';
import Reserve from './pages/Reserve';
import History from './pages/History';
import AstraChat from './pages/AstraChat';
import Settings from './pages/Settings';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>Ошибка рендера</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fee', padding: 16, borderRadius: 8 }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#eee', padding: 16, borderRadius: 8, marginTop: 8, fontSize: 12 }}>
            {this.state.error?.stack || ''}
          </pre>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="app">
      <CnyRateSync />
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <div className="main-content">
        <TopBar onMenuClick={() => setIsMenuOpen((prev) => !prev)} />
        <div className="content-area" onClick={() => isMenuOpen && setIsMenuOpen(false)}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/sales/found" element={<ProductFound />} />
              <Route path="/reserve" element={<Reserve />} />
              <Route path="/history" element={<History />} />
              <Route path="/astra" element={<AstraChat />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <AppShell />
              </PrivateRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
