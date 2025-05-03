const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

const corsOptions = {
    origin: '*',
    methods: 'POST',
    exposedHeaders: ['X-Log-Proxy-*'],
};

const EXEC_TIMEOUT = 15000;
const MAX_BUFFER = 1024 * 500;
const DEFAULT_SHELL = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
const MAX_LOG_HEADERS = 5;

app.use(cors(corsOptions));
app.use(express.json());

function addLogHeaders(response, logs, prefix) {
    const limitedLogs = logs.slice(-MAX_LOG_HEADERS);
    limitedLogs.forEach((logMsg, i) => {
        const headerName = `${prefix}-${i}`;
        try {
            const headerValue = String(logMsg || '').replace(/[\r\n]+/g, ' ').substring(0, 200);
             if (headerValue) {
                 response.setHeader(headerName, headerValue);
             }
        } catch (e) {
            console.error(`Error setting header ${headerName}: ${e.message}`);
        }
    });
}

app.get('/', (req, res) => {
    res.send('RyxIDE Terminal Backend (Executor) is running.');
});

app.post('/execute', (req, res) => {
    const nodeLogs = ["Node executor request received."];
    const command = req.body.command;

    if (!command || typeof command !== 'string' || command.trim() === '') {
        nodeLogs.push("ERROR: Invalid command received.");
        addLogHeaders(res, nodeLogs, 'X-Log-Proxy');
        return res.status(400).json({ error: 'Command is required and must be a non-empty string.' });
    }

    nodeLogs.push(`Executing command locally: ${command.substring(0,100)}...`);
    console.log(`Executing command: ${command}`);

    exec(command, { timeout: EXEC_TIMEOUT, maxBuffer: MAX_BUFFER, shell: DEFAULT_SHELL }, (error, stdout, stderr) => {
        addLogHeaders(res, nodeLogs, 'X-Log-Proxy');
        if (error) {
            console.error(`Exec error for command "${command}": ${error.message}`);
            res.status(500).json({
                error: `Command failed locally: ${error.message}`,
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: error.code || 1,
            });
            return;
        }
        console.log(`Command "${command}" finished locally.`);
        res.status(200).json({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: 0,
        });
    });
});

app.listen(port, () => {
    console.log(`Node.js executor server listening on port ${port}`);
});
