const { spawn } = require('child_process');
const path = require('path');

/**
 * Super Simple Backend Manager - No race conditions!
 * Just uses OS-assigned ports (port 0) - that's it!
 */
class SimpleBackendManager {
  constructor() {
    this.backendPort = null;
    this.testApplibPort = null;
    this.backendProcess = null;
    this.testApplibProcess = null;
  }

  /**
   * Start both backends - simple and reliable
   */
  async startBackends(userSettings, version, env1) {
    try {
      // Start TestAppweb first
      this.testApplibPort = await this.startProcess('TestAppweb', 'TestApplib\\TestAppweb.exe');
      
      // Start Backend with TestAppweb port info
      this.backendPort = await this.startProcess('Backend', 'Backend\\Backend.exe', {
        '_ConnectedServices:TestAppWeb:applicationUrl': `http://localhost:${this.testApplibPort}`,
        '_version': version,
        '_env1': env1,
        '_env2': userSettings.get('username')
      });

      return {
        backendPort: this.backendPort,
        testApplibPort: this.testApplibPort
      };

    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /**
   * Start one process and return its assigned port
   */
  async startProcess(name, exePath, extraEnvs = {}) {
    return new Promise((resolve, reject) => {
      const fullPath = path.join(__dirname, exePath).replace('app.asar', 'app.asar.unpacked');
      const workDir = path.dirname(fullPath);

      // Simple environment - just let OS assign port
      const env = {
        ...process.env,
        ASPNETCORE_URLS: 'http://localhost:0', // OS picks port
        ...extraEnvs
      };

      const proc = spawn(fullPath, [], { env, cwd: workDir, stdio: 'pipe' });

      // Watch for port assignment
      proc.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[${name}] ${output.trim()}`);

        // Get the assigned port
        const match = output.match(/listening on.*:(\d+)/i);
        if (match) {
          const port = parseInt(match[1]);
          console.log(`✓ ${name} got port ${port}`);
          
          // Store process
          if (name === 'Backend') this.backendProcess = proc;
          if (name === 'TestAppweb') this.testApplibProcess = proc;
          
          resolve(port);
        }
      });

      proc.stderr.on('data', (data) => {
        console.error(`[${name}] ${data}`);
      });

      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code !== 0) reject(new Error(`${name} failed`));
      });

      // Timeout
      setTimeout(() => reject(new Error(`${name} timeout`)), 10000);
    });
  }

  /**
   * Stop everything
   */
  cleanup() {
    if (this.backendProcess) this.backendProcess.kill();
    if (this.testApplibProcess) this.testApplibProcess.kill();
  }
}

module.exports = SimpleBackendManager;