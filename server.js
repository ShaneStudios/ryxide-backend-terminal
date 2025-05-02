const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const app = express();
const port = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());

// --- Simple State (Simulated - Reset per request in HTTP model) ---
// In a real stateful (WebSocket) app, this would be per-connection.
// For HTTP, each request effectively starts at the base directory.
// We can simulate CWD changes within the processing of a command sequence
// if multiple commands are sent at once (e.g. "mkdir test && cd test"), but
// the *next* HTTP request will reset.
let currentWorkingDirectory = process.env.HOME || os.homedir() || process.cwd(); // Default CWD

app.get('/', (req, res) => {
  res.send('RyxIDE Terminal Backend (HTTP/Command Handler Mode) Running');
});

app.post('/execute', async (req, res) => {
  const commandLine = req.body.command;
  // Allow overriding CWD for specific execution if needed? Or keep it session based?
  // For HTTP, session state is hard. Let's assume commands operate relative to a base path
  // or we implement basic CWD simulation within this function for chained commands.
  // Simple approach: Each command runs independently for now.
  // TODO: Implement better CWD handling if needed later (e.g., using session cookies or passing cwd state).

  if (!commandLine || typeof commandLine !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "command" field.', stdout: '', stderr: '' });
  }

  console.log(`Received command: ${commandLine}`);

  const parts = commandLine.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    switch (command) {
      case 'pwd':
        stdout = currentWorkingDirectory;
        break;

      case 'echo':
        stdout = args.join(' ');
        break;

      case 'clear':
        stdout = '';
        break;

      case 'ls':
      case 'dir':
        try {
          const targetPath = args[0] ? path.resolve(currentWorkingDirectory, args[0]) : currentWorkingDirectory;
          if (!targetPath.startsWith(currentWorkingDirectory)) {
              throw new Error("Access denied outside working directory.");
          }
          const files = await fs.readdir(targetPath, { withFileTypes: true });
          stdout = files.map(file => {
              let indicator = file.isDirectory() ? '/' : '';
              return file.name + indicator;
          }).join('\n');
        } catch (e) {
          stderr = `ls: cannot access '${args[0] || '.'}': ${e.message}`;
          exitCode = 1;
        }
        break;

      case 'mkdir':
        if (!args[0]) {
            stderr = 'mkdir: missing operand'; exitCode = 1; break;
        }
        try {
          const dirToCreate = path.resolve(currentWorkingDirectory, args[0]);
          if (!dirToCreate.startsWith(currentWorkingDirectory)) {
              throw new Error("Access denied outside working directory.");
          }
          await fs.mkdir(dirToCreate, { recursive: true });
          // stdout = `Directory created: ${args[0]}`;
          // Optional success message
        } catch (e) {
          stderr = `mkdir: cannot create directory '${args[0]}': ${e.message}`;
          exitCode = 1;
        }
        break;

      case 'cat':
         if (!args[0]) { stderr = 'cat: missing filename'; exitCode = 1; break; }
         try {
             const fileToRead = path.resolve(currentWorkingDirectory, args[0]);
             if (!fileToRead.startsWith(currentWorkingDirectory)) {
                 throw new Error("Access denied outside working directory.");
             }
             stdout = await fs.readFile(fileToRead, 'utf8');
         } catch (e) {
             stderr = `cat: ${args[0]}: ${e.message}`;
             exitCode = 1;
         }
         break;

       case 'cd':
         if (!args[0]) { stderr = 'cd: missing directory'; exitCode = 1; break; }
         try {
             const targetDir = path.resolve(currentWorkingDirectory, args[0]);
              if (!targetDir.startsWith(currentWorkingDirectory)) {
                  throw new Error("Access denied outside working directory.");
              }
             const stats = await fs.stat(targetDir);
             if (!stats.isDirectory()) {
                 stderr = `cd: not a directory: ${args[0]}`; exitCode = 1;
             }
         } catch (e) {
             stderr = `cd: no such file or directory: ${args[0]}`;
             exitCode = 1;
         }
         break;

      default:
        stderr = `RyxIDE: command not found: ${command}`;
        exitCode = 127;
        // --- Fallback Execution (DISABLED - UNSAFE without proper sandboxing) ---
        // If we really need arbitrary commands, implement strong sandboxing (Docker, etc.)
        // and uncomment/adapt the child_process.exec logic from the previous version HERE.
        // For now, unknown commands just fail.
        // ------------------------------------------------------------------------
        break;
    }
  } catch (e) {
      console.error(`Error processing command '${command}':`, e);
      stderr = `Internal server error processing command: ${e.message}`;
      exitCode = -1;
  }

  res.status(200).json({
    stdout: stdout,
    stderr: stderr,
    exit_code: exitCode
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Terminal HTTP backend (Command Handler) listening on 0.0.0.0:${port}`);
});
