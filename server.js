const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const osTmpdir = require('os-tmpdir');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('RyxIDE Terminal Backend (HTTP Mode) Running');
});

app.post('/execute', (req, res) => {
  const command = req.body.command;
  const cwd = req.body.cwd || osTmpdir() || process.env.HOME || process.cwd();

  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "command" field.' });
  }

  const forbiddenCommands = ['rm -rf /', 'sudo', 'reboot', 'shutdown'];
  if (forbiddenCommands.some(forbidden => command.includes(forbidden))) {
      return res.status(403).json({ error: 'Forbidden command pattern detected.', stdout: '', stderr: '' });
  }

  const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';

  console.log(`Executing command: ${command} in ${cwd}`);

  exec(command, {
    cwd: cwd,
    shell: shell,
    timeout: 15000,
    env: { ...process.env, TERM: 'xterm-256color' }
  }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Exec error: ${error}`);
      const errorMessage = stderr ? `${error.message}\n${stderr}` : error.message;
      if (error.signal === 'SIGTERM' || error.killed) {
         return res.status(200).json({ stdout: stdout, stderr: `${stderr}\n\n[RyxIDE: Process timed out or killed]\n`, exitCode: error.code || -1 });
      }
      return res.status(200).json({ stdout: stdout, stderr: errorMessage, exitCode: error.code || 1 });
    }

    res.status(200).json({
      stdout: stdout,
      stderr: stderr,
      exitCode: 0
    });
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Terminal HTTP backend listening on 0.0.0.0:${port}`);
});
