// Simple usage example - replace your existing startMainWindowWithProcesses method

const SimpleBackendManager = require('./simple-backend-manager');

// In your main class:
async startMainWindowWithProcesses(splashscreen, userSettingsStore, title, language, version, isDevelopment) {
  splashscreen.webContents.send('message', 'Startup in process');

  if (isDevelopment) {
    this.backendPort = 1111;
    this.testApplibPort = 2222;
    await this.createWindow(splashscreen, language, isDevelopment);
  } else {
    // Simple backend startup - no race conditions!
    const backendManager = new SimpleBackendManager();
    
    try {
      const ports = await backendManager.startBackends(userSettingsStore, version, this.env1);
      
      this.backendPort = ports.backendPort;
      this.testApplibPort = ports.testApplibPort;
      this.backendManager = backendManager; // Store for cleanup

      console.log(`Backend: ${this.backendPort}, TestApp: ${this.testApplibPort}`);
      
      // Create window after backends are ready
      await this.createWindow(splashscreen, language, isDevelopment);
      
    } catch (error) {
      this.quitWithError(error.message, title);
    }
  }
}

// Add cleanup method
async cleanup() {
  if (this.backendManager) {
    this.backendManager.cleanup();
  }
}