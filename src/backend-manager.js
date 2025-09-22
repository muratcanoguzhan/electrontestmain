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
      // Start both backends in parallel
      const [backend1Result, backend2Result] = await Promise.all([
        this.startBackend('backend1', './backend1/Backend1.exe'),
        this.startBackend('backend2', './backend2/Backend2.exe')
      ]);

      if (!backend1Result.success || !backend2Result.success) {
        throw new Error('Failed to start one or more backends');
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
   * @returns {Promise<Object>} - Result with success status and port
   */
  async startBackend(name, executablePath) {
    return new Promise((resolve, reject) => {
      // Check if executable exists
      if (!fs.existsSync(executablePath)) {
        return resolve({ 
          success: false, 
          error: `Backend executable not found: ${executablePath}` 
        });
      }

      console.log(`Starting ${name}...`);

      // Start process with port 0 (OS will assign available port)
      const process = spawn(executablePath, ['--urls', 'http://localhost:0'], {
        cwd: path.dirname(executablePath),
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