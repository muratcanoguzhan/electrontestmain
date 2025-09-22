const keytar = require('keytar');

/**
 * Secure token storage using keytar (OS credential store)
 */
class TokenStorage {
  constructor(serviceName = 'electron-oauth-app') {
    this.serviceName = serviceName;
    this.accountName = 'oauth-tokens';
  }

  /**
   * Store tokens securely in the OS credential store
   * @param {Object} tokens - Token object containing access_token, refresh_token, etc.
   * @returns {Promise<void>}
   */
  async storeTokens(tokens) {
    try {
      const tokenData = JSON.stringify(tokens);
      await keytar.setPassword(this.serviceName, this.accountName, tokenData);
      console.log('Tokens stored securely');
    } catch (error) {
      throw new Error(`Failed to store tokens: ${error.message}`);
    }
  }

  /**
   * Retrieve tokens from the OS credential store
   * @returns {Promise<Object|null>} - Token object or null if not found
   */
  async getTokens() {
    try {
      const tokenData = await keytar.getPassword(this.serviceName, this.accountName);
      if (!tokenData) {
        return null;
      }
      return JSON.parse(tokenData);
    } catch (error) {
      console.error('Failed to retrieve tokens:', error.message);
      return null;
    }
  }

  /**
   * Delete tokens from the OS credential store
   * @returns {Promise<boolean>} - True if deleted successfully
   */
  async deleteTokens() {
    try {
      const deleted = await keytar.deletePassword(this.serviceName, this.accountName);
      if (deleted) {
        console.log('Tokens deleted successfully');
      } else {
        console.log('No tokens found to delete');
      }
      return deleted;
    } catch (error) {
      console.error('Failed to delete tokens:', error.message);
      return false;
    }
  }

  /**
   * Check if tokens exist in storage
   * @returns {Promise<boolean>} - True if tokens exist
   */
  async hasTokens() {
    try {
      const tokens = await this.getTokens();
      return tokens !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update specific token values (e.g., after refresh)
   * @param {Object} updates - Object with token updates
   * @returns {Promise<void>}
   */
  async updateTokens(updates) {
    try {
      const currentTokens = await this.getTokens();
      if (!currentTokens) {
        throw new Error('No existing tokens to update');
      }

      const updatedTokens = {
        ...currentTokens,
        ...updates
      };

      await this.storeTokens(updatedTokens);
      console.log('Tokens updated successfully');
    } catch (error) {
      throw new Error(`Failed to update tokens: ${error.message}`);
    }
  }
}

/**
 * Token manager with automatic refresh capabilities
 */
class TokenManager {
  constructor(oauthPKCE, tokenStorage = null) {
    this.oauthPKCE = oauthPKCE;
    this.tokenStorage = tokenStorage || new TokenStorage();
    this.refreshPromise = null; // Prevent concurrent refresh attempts
  }

  /**
   * Get valid access token, refreshing if necessary
   * @returns {Promise<string|null>} - Valid access token or null if authentication needed
   */
  async getValidAccessToken() {
    try {
      const tokens = await this.tokenStorage.getTokens();
      
      if (!tokens) {
        return null; // No tokens available, need authentication
      }

      // Check if access token is still valid
      if (!this.oauthPKCE.isTokenExpired(tokens)) {
        return tokens.access_token;
      }

      // Token is expired, try to refresh
      if (tokens.refresh_token) {
        const refreshedTokens = await this.refreshTokens(tokens.refresh_token);
        return refreshedTokens.access_token;
      }

      // No refresh token available, need re-authentication
      await this.tokenStorage.deleteTokens();
      return null;
    } catch (error) {
      console.error('Error getting valid access token:', error.message);
      // If there's an error, delete potentially corrupted tokens
      await this.tokenStorage.deleteTokens();
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} - New token data
   */
  async refreshTokens(refreshToken) {
    // Prevent concurrent refresh attempts
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    this.refreshPromise = this._performTokenRefresh(refreshToken);
    
    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform token refresh
   * @private
   */
  async _performTokenRefresh(refreshToken) {
    try {
      console.log('Refreshing access token...');
      const newTokens = await this.oauthPKCE.refreshAccessToken(refreshToken);
      
      // Add issued_at timestamp
      const tokenData = this.oauthPKCE.addIssuedAt(newTokens);
      
      // Preserve refresh token if not included in response
      if (!tokenData.refresh_token) {
        tokenData.refresh_token = refreshToken;
      }

      await this.tokenStorage.storeTokens(tokenData);
      console.log('Access token refreshed successfully');
      
      return tokenData;
    } catch (error) {
      console.error('Token refresh failed:', error.message);
      // If refresh fails, delete tokens to force re-authentication
      await this.tokenStorage.deleteTokens();
      throw error;
    }
  }

  /**
   * Store new tokens (e.g., after initial authentication)
   * @param {Object} tokens - Token data from OAuth provider
   * @returns {Promise<void>}
   */
  async storeTokens(tokens) {
    const tokenData = this.oauthPKCE.addIssuedAt(tokens);
    await this.tokenStorage.storeTokens(tokenData);
  }

  /**
   * Check if user is authenticated (has valid tokens)
   * @returns {Promise<boolean>} - True if authenticated
   */
  async isAuthenticated() {
    const accessToken = await this.getValidAccessToken();
    return accessToken !== null;
  }

  /**
   * Clear all stored tokens (logout)
   * @returns {Promise<void>}
   */
  async clearTokens() {
    await this.tokenStorage.deleteTokens();
    console.log('User logged out - tokens cleared');
  }

  /**
   * Force token refresh (for actions requiring fresh authentication)
   * @returns {Promise<boolean>} - True if refresh successful, false if re-auth needed
   */
  async forceTokenRefresh() {
    try {
      const tokens = await this.tokenStorage.getTokens();
      
      if (!tokens || !tokens.refresh_token) {
        return false; // Need re-authentication
      }

      await this.refreshTokens(tokens.refresh_token);
      return true;
    } catch (error) {
      console.error('Forced token refresh failed:', error.message);
      return false; // Need re-authentication
    }
  }
}

module.exports = {
  TokenStorage,
  TokenManager
};