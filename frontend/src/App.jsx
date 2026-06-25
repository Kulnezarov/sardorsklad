import React, { Component, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import PrivateRoute from './auth/PrivateRoute';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import CnyRateSync from './components/CnyRateSync';
import LoginPage from './auth/LoginPage';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import SalesHub from './pages/SalesHub';
import ProductFound from './pages/ProductFound';
import Reserve from './pages/Reserve';
import History from './pages/History';
import Settings from './pages/Settings';
import Orders from './pages/Orders';
import Intake from './pages/Intake';
import NotFoundPage from './pages/NotFoundPage';
import OnlineOverlay from './components/OnlineOverlay';
import MobileAppDock from './components/MobileAppDock';

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
    <div className="app app--mobile-dock">
      <CnyRateSync />
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <div className="main-content">
        <TopBar onMenuClick={() => setIsMenuOpen((prev) => !prev)} />
        <div className="content-area content-area--mobile-dock" onClick={() => isMenuOpen && setIsMenuOpen(false)}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/sales" element={<SalesHub />} />
              <Route path="/sales/found" element={<ProductFound />} />
              <Route path="/reserve" element={<Reserve />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/intake" element={<Intake />} />
              <Route path="/intake/:clientId" element={<Intake />} />
              <Route path="/categories" element={<Navigate to="/products" replace />} />
              <Route path="/history" element={<History />} />
              <Route path="/astra" element={<Navigate to="/dashboard" replace />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </div>
      <MobileAppDock />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <OnlineOverlay />
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
