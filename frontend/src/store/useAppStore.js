import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAppStore = create(
  persist(
    (set, get) => ({
      // UI State
      dark: false,
      sidebarOpen: true,
      activeSection: 'dashboard',
      
      // Settings
      settings: {
        store_name: 'SkladPro',
        scan_auto_increment: true,
        history_auto_clean_days: 30,
        label_size: 'medium',
        dark_mode: false,
        cny_rate: 65,
        low_stock_threshold: 5,
      },
      
      // Actions
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setActiveSection: (section) => set({ activeSection: section }),
      updateSettings: (newSettings) => set((state) => ({ 
        settings: { ...state.settings, ...newSettings } 
      })),
      
      // Initialize app from localStorage
      initializeApp: () => {
        const persistedState = get();
        if (persistedState.settings?.dark_mode) {
          set({ dark: persistedState.settings.dark_mode });
        }
      },
    }),
    {
      name: 'skladpro-store',
      partialize: (state) => ({
        dark: state.dark,
        sidebarOpen: state.sidebarOpen,
        settings: state.settings,
      }),
    }
  )
);
