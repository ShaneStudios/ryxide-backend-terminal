const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

const corsOptions = {
    origin: '*',
    methods: 'POST',
    exposedHeaders: ['Content-Type', 'Content-Disposition', 'X-Log-Proxy-*', 'X-Log-Python-*'],
};

const EXEC_TIMEOUT = 15000;
const MAX_BUFFER = 1024 * 500;
const DEFAULT_SHELL = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
const PYTHON_BACKEND_URL = 'https://ryxide-backend-terminal-fetch.onrender.com';
const MAX_LOG_HEADERS = 10;

const PYTHON_RETRY_ATTEMPTS = 20;
const PYTHON_RETRY_DELAY_MS = 6000;


console.log("Python backend URL configured:", PYTHON_BACKEND_URL);

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

async function fetchWithRetry(url, options, retries, delay, logs) {
    for (let i = 0; i <= retries; i++) {
        logs.push(`Attempt ${i + 1} to fetch ${url}`);
        try {
            const response = await fetch(url, options);
            logs.push(`Received response status: ${response.status}`);
            return response;
        } catch (error) {
            logs.push(`Fetch attempt ${i + 1} failed: ${error.name} - ${error.message}`);
            const isRetryable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'].includes(error.code);

            if (isRetryable && i < retries) {
                logs.push(`Retryable error detected. Waiting ${delay}ms before retry ${i + 2}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                logs.push(`Non-retryable error or retries exhausted. Rethrowing.`);
                throw error;
            }
        }
    }
     throw new Error("Retry attempts exhausted without success or final error.");
}


function parseDownloadCommand(command) {
    command = command.trim();
    let match;
    const gitRegex = /^git\s+clone(?:\s+--depth(?:=|\s+)\d+)?\s+(['"]?)(.+?)\1(?:\s+(['"]?)(.*?)\3)?$/;
    match = command.match(gitRegex);
    if (match) {
        return { type: 'git', url: match[2], targetDir: match[4] };
    }
    const wgetRegexSimple = /^wget\s+(['"]?)([^ ]+?)\1$/;
    const wgetRegexP = /^wget\s+(?:.+?\s+)?-P\s+(['"]?)(.+?)\1\s+(?:.+?\s+)?(['"]?)(.+?)\3(?:\s+.*)?$/;
    const wgetRegexUrlP = /^wget\s+(?:.+?\s+)?(['"]?)(.+?)\1\s+(?:.+?\s+)?-P\s+(['"]?)(.+?)\3(?:\s+.*)?$/;
    match = command.match(wgetRegexP);
    if (match) {
        return { type: 'wget', url: match[4], targetDir: match[2] };
    }
     match = command.match(wgetRegexUrlP);
    if (match) {
        return { type: 'wget', url: match[2], targetDir: match[4] };
    }
     match = command.match(wgetRegexSimple);
    if (match) {
        return { type: 'wget', url: match[2], targetDir: null };
    }
    return null;
}

app.get('/', (req, res) => {
    res.send('RyxIDE Terminal Backend (HTTP/Proxy) is running.');
});

app.post('/execute', async (req, res) => {
    const nodeLogs = [];
    nodeLogs.push("Node backend request received.");
    const command = req.body.command;

    if (!command || typeof command !== 'string' || command.trim() === '') {
         nodeLogs.push("ERROR: Invalid command received.");
         addLogHeaders(res, nodeLogs, 'X-Log-Proxy');
        return res.status(400).json({ error: 'Command is required and must be a non-empty string.' });
    }

    nodeLogs.push(`Received command: ${command.substring(0, 100)}...`);
    const downloadInfo = parseDownloadCommand(command);

    if (downloadInfo) {
        nodeLogs.push(`Proxying command to Python: ${JSON.stringify(downloadInfo)}`);
        console.log(`Proxying command to Python backend: ${JSON.stringify(downloadInfo)}`);
        try {
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadInfo),
            };

            const pythonResponse = await fetchWithRetry(
                `${PYTHON_BACKEND_URL}/fetch-and-zip`,
                fetchOptions,
                PYTHON_RETRY_ATTEMPTS,
                PYTHON_RETRY_DELAY_MS,
                nodeLogs
            );


            const status = pythonResponse.status;
            const contentType = pythonResponse.headers.get('content-type');
            nodeLogs.push(`Final Python response status: ${status}, Content-Type: ${contentType}`);

            res.status(status);
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }
            const disposition = pythonResponse.headers.get('content-disposition');
            if (disposition) {
                res.setHeader('Content-Disposition', disposition);
            }

            pythonResponse.headers.forEach((value, name) => {
                 if (name.toLowerCase().startsWith('x-log-python-')) {
                     res.setHeader(name, value);
                      nodeLogs.push(`Forwarded Python Log Header: ${name}`);
                 }
             });

             addLogHeaders(res, nodeLogs, 'X-Log-Proxy');
            pythonResponse.body.pipe(res);

        } catch (error) {
             nodeLogs.push(`ERROR: Failed proxying to Python after retries: ${error.name} - ${error.message}`);
            console.error(`Error proxying to Python backend after retries: ${error.message}`);
            addLogHeaders(res, nodeLogs, 'X-Log-Proxy');
            res.status(502).json({
                error: 'Failed to contact the file fetching service after multiple attempts.',
                details: error.message
            });
        }
    } else {
        nodeLogs.push(`Executing command locally: ${command.substring(0,100)}...`);
        console.log(`Executing command locally: ${command}`);
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
    }
});

app.listen(port, () => {
    console.log(`Node.js proxy server listening on port ${port}`);
});
