const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const OAuthPKCE = require('./oauth-pkce');
const { TokenManager } = require('./token-manager');

/**
 * Authentication state machine for handling OAuth flow
 */
class AuthenticationManager {
  constructor() {
    // OAuth configuration - Replace with your actual OAuth provider details
    this.oauthConfig = {
      clientId: process.env.OAUTH_CLIENT_ID || 'your-client-id',
      authUrl: process.env.OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: process.env.OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'profile', 'email']
    };

    this.oauthPKCE = new OAuthPKCE(
      this.oauthConfig.clientId,
      this.oauthConfig.authUrl,
      this.oauthConfig.tokenUrl
    );

    this.tokenManager = new TokenManager(this.oauthPKCE);

    // Authentication state
    this.authState = 'unauthenticated'; // unauthenticated | authenticating | authenticated
    this.loginWindow = null;
    this.mainWindow = null;
    this.pendingAuthCallback = null;
    this.pendingFileToOpen = null;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // IPC handlers for renderer processes
    ipcMain.handle('auth:start-login', () => this.startLogin());
    ipcMain.handle('auth:start-forced-login', () => this.startForcedLogin());
    ipcMain.handle('auth:get-status', () => this.getAuthStatus());
    ipcMain.handle('auth:logout', () => this.logout());

    // Handle protocol callbacks (Windows/Linux)
    if (process.platform !== 'darwin') {
      this.handleProtocolCallback();
    }
  }

  /**
   * Check authentication status on app startup
   */
  async initialize() {
    try {
      const isAuthenticated = await this.tokenManager.isAuthenticated();
      this.authState = isAuthenticated ? 'authenticated' : 'unauthenticated';
      console.log(`Initial auth state: ${this.authState}`);
      return this.authState;
    } catch (error) {
      console.error('Error initializing authentication:', error);
      this.authState = 'unauthenticated';
      return this.authState;
    }
  }

  /**
   * Get current authentication status
   */
  async getAuthStatus() {
    const isAuthenticated = await this.tokenManager.isAuthenticated();
    this.authState = isAuthenticated ? 'authenticated' : 'unauthenticated';
    return {
      state: this.authState,
      isAuthenticated
    };
  }

  /**
   * Start OAuth login flow
   */
  async startLogin() {
    if (this.authState === 'authenticating') {
      console.log('Login already in progress');
      return { success: false, message: 'Login already in progress' };
    }

    try {
      this.authState = 'authenticating';
      
      // Generate PKCE parameters and build auth URL
      const authUrl = this.oauthPKCE.buildAuthUrl(this.oauthConfig.scopes);
      console.log('Opening browser for OAuth login...');
      
      // Open external browser
      await shell.openExternal(authUrl);
      
      // Show waiting UI if login window exists
      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        this.loginWindow.webContents.send('auth:waiting-for-callback');
      }

      return { success: true, message: 'Browser opened for login' };
    } catch (error) {
      console.error('Error starting login:', error);
      this.authState = 'unauthenticated';
      return { success: false, message: error.message };
    }
  }

  /**
   * Start forced login (for actions requiring fresh authentication)
   */
  async startForcedLogin() {
    console.log('Starting forced re-authentication...');
    
    // Clear existing tokens to force fresh login
    await this.tokenManager.clearTokens();
    this.authState = 'unauthenticated';
    
    return this.startLogin();
  }

  /**
   * Handle OAuth callback from protocol
   */
  async handleOAuthCallback(callbackUrl) {
    if (this.authState !== 'authenticating') {
      console.log('Received callback but not in authenticating state');
      return;
    }

    try {
      console.log('Processing OAuth callback...');
      
      // Parse callback parameters
      const params = this.oauthPKCE.parseCallback(callbackUrl);
      
      if (params.error) {
        throw new Error(`OAuth error: ${params.error} - ${params.error_description}`);
      }

      if (!params.code) {
        throw new Error('No authorization code received');
      }

      // Validate state to prevent CSRF
      if (!this.oauthPKCE.validateState(params.state)) {
        throw new Error('Invalid state parameter - possible CSRF attack');
      }

      // Exchange code for tokens
      const tokens = await this.oauthPKCE.exchangeCodeForTokens(params.code);
      await this.tokenManager.storeTokens(tokens);

      this.authState = 'authenticated';
      console.log('OAuth login successful!');

      // Notify UI
      this.notifyAuthSuccess();

      // Handle pending file if any
      if (this.pendingFileToOpen) {
        const file = this.pendingFileToOpen;
        this.pendingFileToOpen = null;
        this.openMainWindow(file);
      } else {
        this.openMainWindow();
      }

      // Close login window
      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        this.loginWindow.close();
      }

      return { success: true };
    } catch (error) {
      console.error('OAuth callback error:', error);
      this.authState = 'unauthenticated';
      
      // Notify UI of error
      this.notifyAuthError(error.message);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle protocol callback for Windows/Linux
   */
  handleProtocolCallback() {
    // Check if app was launched with protocol URL
    const protocolUrl = process.argv.find(arg => arg.startsWith('myapp://'));
    if (protocolUrl) {
      console.log('App launched with protocol URL:', protocolUrl);
      // Delay handling to ensure app is ready
      setTimeout(() => this.handleOAuthCallback(protocolUrl), 1000);
    }

    // Handle subsequent protocol calls
    app.on('second-instance', (event, commandLine) => {
      const protocolUrl = commandLine.find(arg => arg.startsWith('myapp://'));
      if (protocolUrl) {
        console.log('Received protocol URL in second instance:', protocolUrl);
        this.handleOAuthCallback(protocolUrl);
      }
    });
  }

  /**
   * Handle protocol callback for macOS
   */
  setupMacOSProtocolHandler() {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      console.log('Received protocol URL on macOS:', url);
      this.handleOAuthCallback(url);
    });
  }

  /**
   * Logout user
   */
  async logout() {
    try {
      await this.tokenManager.clearTokens();
      this.authState = 'unauthenticated';
      
      // Close main window and show login window
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.close();
      }
      
      this.showLoginWindow();
      
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Show login window
   */
  showLoginWindow() {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus();
      return;
    }

    this.loginWindow = new BrowserWindow({
      width: 400,
      height: 500,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      resizable: false,
      title: 'Login Required'
    });

    this.loginWindow.loadFile(path.join(__dirname, 'login.html'));

    this.loginWindow.on('closed', () => {
      this.loginWindow = null;
    });
  }

  /**
   * Open main application window
   */
  openMainWindow(filePath = null) {
    // For multi-instance behavior, create new window for each file
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      title: filePath ? `MyApp - ${path.basename(filePath)}` : 'MyApp'
    });

    mainWindow.loadFile(path.join(__dirname, 'main.html'));

    // Set up application menu
    this.setupApplicationMenu(mainWindow);

    // Send file path to renderer if provided
    mainWindow.webContents.once('did-finish-load', () => {
      if (filePath) {
        mainWindow.webContents.send('file:open', filePath);
      }
    });

    // Store reference to main window(s)
    if (!this.mainWindow) {
      this.mainWindow = mainWindow;
    }

    mainWindow.on('closed', () => {
      if (this.mainWindow === mainWindow) {
        this.mainWindow = null;
      }
    });

    return mainWindow;
  }

  /**
   * Set up application menu
   */
  setupApplicationMenu(targetWindow) {
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open File...',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              // Handle file open dialog
              targetWindow.webContents.send('menu:open-file');
            }
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: 'Actions',
        submenu: [
          {
            label: 'Update Something',
            click: async () => {
              // Force fresh authentication for this action
              const result = await this.startForcedLogin();
              if (result.success) {
                targetWindow.webContents.send('action:update-something');
              }
            }
          }
        ]
      },
      {
        label: 'Account',
        submenu: [
          {
            label: 'Logout',
            click: async () => {
              await this.logout();
            }
          }
        ]
      }
    ];

    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      });
    }

    const menu = Menu.buildFromTemplate(template);
    targetWindow.setMenu(menu);
  }

  /**
   * Notify UI of successful authentication
   */
  notifyAuthSuccess() {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.webContents.send('auth:success');
    }
    
    // Notify all main windows
    BrowserWindow.getAllWindows().forEach(window => {
      if (window !== this.loginWindow) {
        window.webContents.send('auth:status-changed', { 
          state: 'authenticated', 
          isAuthenticated: true 
        });
      }
    });
  }

  /**
   * Notify UI of authentication error
   */
  notifyAuthError(errorMessage) {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.webContents.send('auth:error', errorMessage);
    }
  }

  /**
   * Handle file open request
   */
  async handleFileOpen(filePath) {
    const isAuthenticated = await this.tokenManager.isAuthenticated();
    
    if (isAuthenticated) {
      // User is authenticated, open file in new window
      this.openMainWindow(filePath);
    } else {
      // User not authenticated, store file and show login
      this.pendingFileToOpen = filePath;
      this.showLoginWindow();
    }
  }
}

module.exports = AuthenticationManager;