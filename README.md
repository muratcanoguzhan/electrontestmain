# OAuth Multi-Instance Electron App

This Electron application demonstrates:
- External browser OAuth authentication with PKCE
- Deep-link callback handling via custom protocol
- Multi-instance behavior for file associations
- Secure token storage using the OS credential store

## Features

### Authentication Flow
- **External Browser OAuth**: Uses system browser instead of embedded webview
- **PKCE Security**: Implements Proof Key for Code Exchange for enhanced security
- **Deep-link Callback**: Custom protocol (`myapp://`) handles OAuth callbacks
- **Secure Storage**: Tokens stored in OS credential store using keytar
- **Auto Refresh**: Access tokens automatically refreshed when needed

### Multi-Instance Behavior
- **Windows/Linux**: True multi-process instances for each `.mydoc` file
- **macOS**: Multiple windows within single process (platform limitation)
- **File Association**: Double-clicking `.mydoc` files opens new instances
- **Authentication**: Unauthenticated file opens prompt for login first

### Forced Re-authentication
- Menu action "Update Something" requires fresh authentication
- Demonstrates forced token refresh for sensitive operations

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure OAuth Provider**
   - Copy `.env.example` to `.env`
   - Replace with your OAuth provider settings:
     ```
     OAUTH_CLIENT_ID=your-client-id
     OAUTH_AUTH_URL=https://your-provider.com/oauth/authorize
     OAUTH_TOKEN_URL=https://your-provider.com/oauth/token
     ```
   - Configure your OAuth provider to accept `myapp://callback` as redirect URI

3. **Run Development**
   ```bash
   npm run dev
   ```

4. **Build for Production**
   ```bash
   npm run build
   ```

## File Structure

```
src/
├── main.js              # Main process entry point
├── auth-manager.js      # Authentication state machine
├── oauth-pkce.js        # OAuth PKCE utilities
├── token-manager.js     # Secure token storage
├── preload.js           # Secure IPC bridge
├── login.html           # Login window UI
└── main.html            # Main application UI
```

## Cross-Platform Protocol Registration

The app registers the `myapp://` protocol and `.mydoc` file association:

- **Windows**: via NSIS installer and registry
- **macOS**: via Info.plist in app bundle  
- **Linux**: via .desktop file and mime types

## Security Considerations

- Uses system browser for OAuth (more secure than embedded webview)
- Implements PKCE to prevent authorization code interception
- Stores tokens in OS credential store, not plain text files
- Validates state parameter to prevent CSRF attacks
- Uses context isolation and disabled node integration in renderer

## OAuth Provider Setup

### Required Redirect URI
Configure your OAuth provider to accept: `myapp://callback`

### Supported Grant Types
- Authorization Code with PKCE
- Refresh Token

### Required Scopes
Typically: `openid profile email` (adjust per your provider)

## Testing Multi-Instance

1. **Start the app**: `npm run dev`
2. **Create test file**: Use "Create Test .mydoc File" button
3. **Double-click file**: Should open new instance (Windows/Linux) or window (macOS)
4. **Test authentication**: Try "Update Something" menu action

## Common Issues

### Protocol Not Registered
- Ensure app is properly installed (not just run from dev)
- On Windows, may need admin rights for protocol registration
- On macOS, protocol registration happens during app bundle creation

### Keytar Installation Issues
- Requires native compilation
- May need build tools: `npm install -g windows-build-tools` (Windows)
- Alternative: Use electron-store with encryption for token storage

### OAuth Callback Not Working
- Verify redirect URI matches exactly: `myapp://callback`
- Check if multiple app instances are conflicting
- Ensure protocol is registered system-wide

## Development vs Production

### Development Mode
- Use `npm run dev` for development
- Protocol registration may not work in dev mode
- Test OAuth with localhost callback first

### Production Mode
- Build and install the app properly
- Protocol and file associations will work correctly
- Test complete OAuth flow with custom protocol

## License

MIT