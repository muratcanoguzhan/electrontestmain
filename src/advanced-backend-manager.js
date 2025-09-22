const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Advanced Backend Manager with service discovery
 * Backends can discover each other's ports after startup
 */
class AdvancedBackendManager {
  constructor() {
    this.processes = [];
    this.ports = {};
    this.serviceRegistry = new Map();
  }

  /**
   * Start both backends and set up service discovery
   */
  async startBackends() {
    console.log('Starting .NET backends with service discovery...');
    
    try {
      // Start both backends in parallel (they don't need each other's ports at startup)
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

      // Register services for discovery
      this.serviceRegistry.set('backend1', {
        port: backend1Result.port,
        url: `http://localhost:${backend1Result.port}`,
        status: 'running'
      });
      
      this.serviceRegistry.set('backend2', {
        port: backend2Result.port,
        url: `http://localhost:${backend2Result.port}`,
        status: 'running'
      });

      // Notify backends about each other (optional)
      await this.notifyBackendsOfPorts();

      console.log('✓ All backends started with service discovery:', this.ports);
      return {
        ports: this.ports,
        serviceRegistry: Object.fromEntries(this.serviceRegistry)
      };

    } catch (error) {
      console.error('Failed to start backends:', error.message);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Start a backend with service discovery environment variables
   */
  async startBackend(name, executablePath) {
    return new Promise((resolve) => {
      if (!fs.existsSync(executablePath)) {
        return resolve({ 
          success: false, 
          error: `Backend executable not found: ${executablePath}` 
        });
      }

      console.log(`Starting ${name}...`);

      // Environment variables for service discovery
      const env = {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Production',
        DOTNET_ENVIRONMENT: 'Production',
        // Service discovery endpoint (this Electron app will provide this)
        SERVICE_DISCOVERY_URL: 'http://localhost:0', // We'll update this after we know our own port
        SERVICE_NAME: name
      };

      const process = spawn(executablePath, ['--urls', 'http://localhost:0'], {
        cwd: path.dirname(executablePath),
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let portFound = false;

      process.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[${name}] ${output.trim()}`);

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

      setTimeout(() => {
        if (!portFound) {
          process.kill();
          resolve({ success: false, error: 'Timeout waiting for port assignment' });
        }
      }, 10000);
    });
  }

  /**
   * Notify backends about each other's ports via HTTP calls
   */
  async notifyBackendsOfPorts() {
    const http = require('http');
    
    for (const [serviceName, serviceInfo] of this.serviceRegistry) {
      try {
        // Create a configuration payload for this backend
        const otherServices = {};
        for (const [otherName, otherInfo] of this.serviceRegistry) {
          if (otherName !== serviceName) {
            otherServices[otherName] = {
              port: otherInfo.port,
              url: otherInfo.url
            };
          }
        }

        const configPayload = JSON.stringify({
          services: otherServices
        });

        // Send POST request to backend's config endpoint
        const postData = configPayload;
        const options = {
          hostname: 'localhost',
          port: serviceInfo.port,
          path: '/api/config/services',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = http.request(options, (res) => {
          if (res.statusCode === 200) {
            console.log(`✓ ${serviceName} notified of other services`);
          } else {
            console.warn(`⚠ ${serviceName} config endpoint returned ${res.statusCode}`);
          }
        });

        req.on('error', (err) => {
          console.warn(`⚠ Could not notify ${serviceName} of services:`, err.message);
        });

        req.write(postData);
        req.end();

      } catch (error) {
        console.warn(`⚠ Error notifying ${serviceName}:`, error.message);
      }
    }
  }

  /**
   * Get service registry for other components
   */
  getServiceRegistry() {
    return Object.fromEntries(this.serviceRegistry);
  }

  /**
   * Get ports (legacy compatibility)
   */
  getPorts() {
    return this.ports;
  }

  /**
   * Shutdown all backends
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
    this.serviceRegistry.clear();
    console.log('✓ All backends stopped');
  }
}

module.exports = AdvancedBackendManager;