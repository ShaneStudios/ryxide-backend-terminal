const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

const corsOptions = {
  origin: '*',
  methods: 'POST',
};

const EXEC_TIMEOUT = 15000;
const MAX_BUFFER = 1024 * 500;
const DEFAULT_SHELL = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

app.use(cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('RyxIDE Terminal Backend (HTTP) is running.');
});

app.post('/execute', (req, res) => {
  const command = req.body.command;

  if (!command || typeof command !== 'string' || command.trim() === '') {
    return res.status(400).json({ error: 'Command is required and must be a non-empty string.' });
  }

  console.log(`Executing command: ${command}`);

  exec(command, { timeout: EXEC_TIMEOUT, maxBuffer: MAX_BUFFER, shell: DEFAULT_SHELL }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Exec error for command "${command}": ${error.message}`);
      return res.status(500).json({
        error: `Command failed: ${error.message}`,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error.code,
      });
    }

    console.log(`Command "${command}" finished.`);
    res.status(200).json({
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
    });
  });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.warn('--- SECURITY WARNING ---');
  console.warn('This server executes arbitrary commands received via HTTP.');
  console.warn('Ensure it is not exposed to untrusted users or networks without proper security measures (authentication, input validation, restricted commands).');
  console.warn('Using CORS with "*" is insecure for production.');
  console.warn('-----------------------');
});
