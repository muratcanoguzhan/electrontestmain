const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Simple Backend Manager using OS-assigned ports
 * No race conditions, no file locking, no port conflicts!
 */
class BackendManager {
  constructor() {
    this.processes = [];
    this.ports = {};
  }

  /**
   * Start both backend processes and let OS assign ports
   * @returns {Promise<Object>} - Object with assigned ports
   */
  async startBackends() {
    console.log('Starting .NET backends with OS-assigned ports...');
    
    try {
      // Start backend2 first (since backend1 needs its port)
      console.log('Starting backend2 first...');
      const backend2Result = await this.startBackend('backend2', './backend2/Backend2.exe');
      
      if (!backend2Result.success) {
        throw new Error('Failed to start backend2');
      }

      // Now start backend1 with backend2's port as environment variable
      console.log('Starting backend1 with backend2 port info...');
      const backend1Result = await this.startBackend('backend1', './backend1/Backend1.exe', {
        BACKEND2_PORT: backend2Result.port.toString(),
        BACKEND2_URL: `http://localhost:${backend2Result.port}`
      });

      if (!backend1Result.success) {
        throw new Error('Failed to start backend1');
      }

      this.ports = {
        backend1: backend1Result.port,
        backend2: backend2Result.port
      };

      console.log('✓ All backends started successfully:', this.ports);
      return this.ports;

    } catch (error) {
      console.error('Failed to start backends:', error.message);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Start a single backend process
   * @param {string} name - Backend name
   * @param {string} executablePath - Path to the .exe file
   * @param {Object} additionalEnvVars - Additional environment variables
   * @returns {Promise<Object>} - Result with success status and port
   */
  async startBackend(name, executablePath, additionalEnvVars = {}) {
    return new Promise((resolve, reject) => {
      // Check if executable exists
      if (!fs.existsSync(executablePath)) {
        return resolve({ 
          success: false, 
          error: `Backend executable not found: ${executablePath}` 
        });
      }

      console.log(`Starting ${name}...`);

      // Prepare environment variables
      const env = {
        ...process.env,
        ...additionalEnvVars,
        // Standard ASP.NET Core environment variables
        ASPNETCORE_ENVIRONMENT: 'Production',
        DOTNET_ENVIRONMENT: 'Production',
        // Use ASPNETCORE_URLS for automatic port allocation
        ASPNETCORE_URLS: 'http://localhost:0'  // Port 0 = OS assigns available port
      };

      console.log(`[${name}] Environment variables:`, { ...additionalEnvVars, ASPNETCORE_URLS: env.ASPNETCORE_URLS });

      // Start process without --urls argument (will use ASPNETCORE_URLS env var)
      const process = spawn(executablePath, [], {
        cwd: path.dirname(executablePath),
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let portFound = false;

      // Listen for port assignment in stdout
      process.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[${name}] ${output.trim()}`);

        // Look for ASP.NET Core's "Now listening on" message
        // Example: "Now listening on: http://localhost:52341"
        const match = output.match(/Now listening on:\s*http:\/\/localhost:(\d+)/i);
        if (match && !portFound) {
          const assignedPort = parseInt(match[1]);
          portFound = true;
          
          console.log(`✓ ${name} assigned port ${assignedPort}`);
          
          this.processes.push({
            name,
            process,
            port: assignedPort
          });
          
          resolve({ success: true, port: assignedPort });
        }
      });

      process.stderr.on('data', (data) => {
        console.error(`[${name}] ${data.toString().trim()}`);
      });

      process.on('error', (error) => {
        if (!portFound) {
          resolve({ success: false, error: error.message });
        }
      });

      process.on('exit', (code) => {
        if (!portFound && code !== 0) {
          resolve({ success: false, error: `Process exited with code ${code}` });
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!portFound) {
          process.kill();
          resolve({ success: false, error: 'Timeout waiting for port assignment' });
        }
      }, 10000);
    });
  }

  /**
   * Get the assigned ports
   * @returns {Object} - Port assignments
   */
  getPorts() {
    return this.ports;
  }

  /**
   * Shutdown all backend processes
   */
  async shutdown() {
    console.log('Shutting down backend processes...');
    
    for (const backend of this.processes) {
      try {
        console.log(`Stopping ${backend.name}...`);
        backend.process.kill('SIGTERM');
      } catch (error) {
        console.warn(`Error stopping ${backend.name}:`, error.message);
      }
    }
    
    this.processes = [];
    this.ports = {};
    console.log('✓ All backends stopped');
  }
}

module.exports = BackendManager;