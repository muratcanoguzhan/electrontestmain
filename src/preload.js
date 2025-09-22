const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication methods
  auth: {
    startLogin: () => ipcRenderer.invoke('auth:start-login'),
    startForcedLogin: () => ipcRenderer.invoke('auth:start-forced-login'),
    getStatus: () => ipcRenderer.invoke('auth:get-status'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    
    // Event listeners
    onWaitingForCallback: (callback) => {
      ipcRenderer.on('auth:waiting-for-callback', callback);
      return () => ipcRenderer.removeListener('auth:waiting-for-callback', callback);
    },
    onSuccess: (callback) => {
      ipcRenderer.on('auth:success', callback);
      return () => ipcRenderer.removeListener('auth:success', callback);
    },
    onError: (callback) => {
      ipcRenderer.on('auth:error', callback);
      return () => ipcRenderer.removeListener('auth:error', callback);
    },
    onStatusChanged: (callback) => {
      ipcRenderer.on('auth:status-changed', callback);
      return () => ipcRenderer.removeListener('auth:status-changed', callback);
    }
  },

  // File operations
  file: {
    onOpen: (callback) => {
      ipcRenderer.on('file:open', callback);
      return () => ipcRenderer.removeListener('file:open', callback);
    }
  },

  // Menu actions
  menu: {
    onOpenFile: (callback) => {
      ipcRenderer.on('menu:open-file', callback);
      return () => ipcRenderer.removeListener('menu:open-file', callback);
    }
  },

  // Application actions
  action: {
    onUpdateSomething: (callback) => {
      ipcRenderer.on('action:update-something', callback);
      return () => ipcRenderer.removeListener('action:update-something', callback);
    }
  },

  // Utility methods
  platform: process.platform,
  
  // Remove all listeners (cleanup)
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('auth:waiting-for-callback');
    ipcRenderer.removeAllListeners('auth:success');
    ipcRenderer.removeAllListeners('auth:error');
    ipcRenderer.removeAllListeners('auth:status-changed');
    ipcRenderer.removeAllListeners('file:open');
    ipcRenderer.removeAllListeners('menu:open-file');
    ipcRenderer.removeAllListeners('action:update-something');
  }
});