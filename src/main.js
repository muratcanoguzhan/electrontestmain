const { app, protocol } = require('electron');
const path = require('path');
const AuthenticationManager = require('./auth-manager');
const BackendManager = require('./backend-manager');

// Prevent multiple instances on Windows/Linux for the same file
// But allow multiple instances for different files
let authManager;
let backendManager;
let launchedWithFile = null;

// Handle file associations and protocol on startup
function handleStartupArgs() {
  // Check for file argument
  const fileArg = process.argv.find(arg => 
    arg.endsWith('.mydoc') && !arg.startsWith('-')
  );
  
  if (fileArg) {
    launchedWithFile = path.resolve(fileArg);
    console.log('App launched with file:', launchedWithFile);
  }

  // Check for protocol URL (Windows/Linux)
  const protocolArg = process.argv.find(arg => 
    arg.startsWith('myapp://')
  );
  
  if (protocolArg) {
    console.log('App launched with protocol:', protocolArg);
  }
}

// Multi-instance behavior configuration
function setupMultiInstance() {
  if (process.platform === 'darwin') {
    // macOS: Handle multiple instances differently due to platform constraints
    // We'll use separate windows within the same process
    console.log('macOS: Using single process with multiple windows');
  } else {
    // Windows/Linux: Allow true multi-instance behavior
    console.log('Windows/Linux: Allowing multiple processes');
    
    // Don't call app.requestSingleInstanceLock() to allow multiple instances
    // However, we still want to handle the second-instance event for protocol callbacks
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      console.log('Second instance detected:', commandLine);
      
      // Handle protocol callback in existing instance
      const protocolUrl = commandLine.find(arg => arg.startsWith('myapp://'));
      if (protocolUrl && authManager) {
        authManager.handleOAuthCallback(protocolUrl);
        return;
      }

      // Handle file opening in new instance - this shouldn't normally happen
      // since we're allowing multiple processes, but just in case
      const fileArg = commandLine.find(arg => 
        arg.endsWith('.mydoc') && !arg.startsWith('-')
      );
      
      if (fileArg && authManager) {
        const filePath = path.resolve(fileArg);
        authManager.handleFileOpen(filePath);
      }
    });
  }
}

// Set up protocol handling
function setupProtocolHandling() {
  // Register protocol as standard
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'myapp',
      privileges: {
        standard: true,
        secure: true
      }
    }
  ]);

  // Set as default protocol client
  if (!app.isDefaultProtocolClient('myapp')) {
    app.setAsDefaultProtocolClient('myapp');
    console.log('Registered as default protocol client for myapp://');
  }
}

// App event handlers
function setupAppEventHandlers() {
  app.whenReady().then(async () => {
    console.log('App is ready');
    
    try {
      // Start .NET backends with OS-assigned ports (no conflicts!)
      backendManager = new BackendManager();
      const ports = await backendManager.startBackends();
      
      // Initialize authentication manager with backend ports
      authManager = new AuthenticationManager();
      
      // Store ports for later use
      authManager.backendPorts = ports;
      
      // Set up macOS protocol handler
      if (process.platform === 'darwin') {
        authManager.setupMacOSProtocolHandler();
      }

      // Initialize authentication state
      const authState = await authManager.initialize();
      
      if (launchedWithFile) {
        // App was launched with a file
        console.log('Handling file open on startup:', launchedWithFile);
        await authManager.handleFileOpen(launchedWithFile);
      } else if (authState === 'authenticated') {
        // User is already authenticated, show main window
        authManager.openMainWindow();
      } else {
        // User needs to authenticate, show login window
        authManager.showLoginWindow();
      }
    } catch (error) {
      console.error('Failed to start application:', error.message);
      
      // Show error dialog and quit
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Startup Error',
        `Failed to start the application: ${error.message}\n\nPlease ensure your .NET backend applications are available.`
      );
      
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // On macOS, keep app running even when all windows are closed
    if (process.platform !== 'darwin') {
      // Shutdown backends before quitting
      if (backendManager) {
        backendManager.shutdown().then(() => {
          app.quit();
        });
      } else {
        app.quit();
      }
    }
  });

  app.on('activate', async () => {
    // On macOS, re-create window when dock icon is clicked
    if (process.platform === 'darwin') {
      if (!authManager) return;
      
      const authState = await authManager.getAuthStatus();
      if (authState.isAuthenticated) {
        if (!authManager.mainWindow || authManager.mainWindow.isDestroyed()) {
          authManager.openMainWindow();
        }
      } else {
        authManager.showLoginWindow();
      }
    }
  });

  // Handle file opening on macOS
  if (process.platform === 'darwin') {
    app.on('open-file', async (event, filePath) => {
      event.preventDefault();
      console.log('macOS: File open requested:', filePath);
      
      if (authManager) {
        await authManager.handleFileOpen(filePath);
      } else {
        // Store file to open after app is ready
        launchedWithFile = filePath;
      }
    });
  }

  // Handle before-quit to clean up
  app.on('before-quit', async (event) => {
    if (backendManager) {
      console.log('Shutting down backends...');
      event.preventDefault();
      await backendManager.shutdown();
      app.quit();
    }
  });
}

// Enhanced file association handling for Windows/Linux
function handleFileAssociations() {
  if (process.platform !== 'darwin') {
    // Parse command line arguments for file paths
    const args = process.argv.slice(1); // Skip the first argument (electron executable)
    
    for (const arg of args) {
      if (arg.endsWith('.mydoc') && !arg.startsWith('-')) {
        const filePath = path.resolve(arg);
        console.log('File association detected:', filePath);
        
        // For multi-instance behavior, we want to launch a new process for each file
        // This is already handled by the OS when opening files, but we need to
        // make sure each process handles its file correctly
        if (!launchedWithFile) {
          launchedWithFile = filePath;
        }
        break;
      }
    }
  }
}

// Initialize the application
function initializeApp() {
  console.log('Initializing Electron OAuth Multi-Instance App...');
  console.log('Platform:', process.platform);
  console.log('Command line args:', process.argv);
  
  // Handle startup arguments
  handleStartupArgs();
  handleFileAssociations();
  
  // Setup multi-instance behavior
  setupMultiInstance();
  
  // Setup protocol handling
  setupProtocolHandling();
  
  // Setup app event handlers
  setupAppEventHandlers();
}

// Environment configuration
function loadEnvironmentConfig() {
  // Load environment variables from .env file if it exists
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '..', '.env');
    
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = envContent.split('\n').filter(line => line.includes('='));
      
      envVars.forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      });
      
      console.log('Loaded environment configuration from .env');
    } else {
      console.log('No .env file found, using default configuration');
      console.log('Create a .env file with your OAuth provider settings:');
      console.log('OAUTH_CLIENT_ID=your-client-id');
      console.log('OAUTH_AUTH_URL=https://your-provider.com/oauth/authorize');
      console.log('OAUTH_TOKEN_URL=https://your-provider.com/oauth/token');
    }
  } catch (error) {
    console.warn('Error loading environment config:', error.message);
  }
}

// Application startup
function main() {
  try {
    // Load environment configuration
    loadEnvironmentConfig();
    
    // Initialize the application
    initializeApp();
  } catch (error) {
    console.error('Failed to initialize application:', error);
    app.quit();
  }
}

// Security: Prevent new window creation for security
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    console.warn('Blocked new window creation:', navigationUrl);
  });
});

// Start the application
main();