const crypto = require('crypto');

/**
 * OAuth PKCE utilities for secure authentication flow
 */
class OAuthPKCE {
  constructor(clientId, authUrl, tokenUrl, redirectUri = 'myapp://callback') {
    this.clientId = clientId;
    this.authUrl = authUrl;
    this.tokenUrl = tokenUrl;
    this.redirectUri = redirectUri;
    this.codeVerifier = null;
    this.codeChallenge = null;
    this.state = null;
  }

  /**
   * Generate a cryptographically random string for PKCE
   * @param {number} length - Length of the string
   * @returns {string} - Base64 URL-encoded string
   */
  generateRandomString(length = 128) {
    const buffer = crypto.randomBytes(length);
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate SHA256 hash and base64url encode it
   * @param {string} plain - Plain text to hash
   * @returns {string} - Base64 URL-encoded hash
   */
  sha256(plain) {
    return crypto
      .createHash('sha256')
      .update(plain)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  generatePKCE() {
    this.codeVerifier = this.generateRandomString(128);
    this.codeChallenge = this.sha256(this.codeVerifier);
    this.state = this.generateRandomString(32);
  }

  /**
   * Build authorization URL with PKCE parameters
   * @param {string[]} scopes - OAuth scopes to request
   * @returns {string} - Complete authorization URL
   */
  buildAuthUrl(scopes = ['openid', 'profile', 'email']) {
    if (!this.codeChallenge) {
      this.generatePKCE();
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state: this.state,
      code_challenge: this.codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Parse callback URL and extract authorization code
   * @param {string} callbackUrl - The full callback URL
   * @returns {Object} - Parsed parameters including code and state
   */
  parseCallback(callbackUrl) {
    try {
      const url = new URL(callbackUrl);
      const params = new URLSearchParams(url.search);
      
      return {
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
        error_description: params.get('error_description')
      };
    } catch (error) {
      throw new Error(`Invalid callback URL: ${error.message}`);
    }
  }

  /**
   * Validate state parameter to prevent CSRF attacks
   * @param {string} receivedState - State received from callback
   * @returns {boolean} - Whether state is valid
   */
  validateState(receivedState) {
    return this.state === receivedState;
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} authorizationCode - The authorization code from callback
   * @returns {Promise<Object>} - Token response object
   */
  async exchangeCodeForTokens(authorizationCode) {
    if (!this.codeVerifier) {
      throw new Error('Code verifier not found. Generate PKCE first.');
    }

    const tokenData = {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code: authorizationCode,
      redirect_uri: this.redirectUri,
      code_verifier: this.codeVerifier
    };

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams(tokenData)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorData}`);
      }

      const tokens = await response.json();
      
      // Clear PKCE data after successful exchange
      this.codeVerifier = null;
      this.codeChallenge = null;
      this.state = null;

      return tokens;
    } catch (error) {
      throw new Error(`Token exchange error: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} - New token response object
   */
  async refreshAccessToken(refreshToken) {
    const tokenData = {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: refreshToken
    };

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams(tokenData)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorData}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Token refresh error: ${error.message}`);
    }
  }

  /**
   * Check if a token is expired
   * @param {Object} tokenData - Token object with expires_at or expires_in
   * @returns {boolean} - Whether the token is expired
   */
  isTokenExpired(tokenData) {
    if (!tokenData) return true;

    // If expires_at is available (Unix timestamp)
    if (tokenData.expires_at) {
      return Date.now() > tokenData.expires_at * 1000;
    }

    // If expires_in is available (seconds from issued_at)
    if (tokenData.expires_in && tokenData.issued_at) {
      const expiresAt = (tokenData.issued_at + tokenData.expires_in) * 1000;
      return Date.now() > expiresAt;
    }

    // If we don't have expiration info, assume it's expired for safety
    return true;
  }

  /**
   * Add issued_at timestamp to token data
   * @param {Object} tokenData - Token response from server
   * @returns {Object} - Token data with issued_at timestamp
   */
  addIssuedAt(tokenData) {
    return {
      ...tokenData,
      issued_at: Math.floor(Date.now() / 1000)
    };
  }
}

module.exports = OAuthPKCE;