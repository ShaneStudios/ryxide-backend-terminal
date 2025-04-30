const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const cors = require('cors');
const os = require('os');
const osTmpdir = require('os-tmpdir');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req, res) => {
  res.send('RyxIDE Terminal Backend Running');
});

wss.on('connection', (ws) => {
  console.log('Terminal client connected');

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  let ptyProcess = null;

  try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: osTmpdir() || process.env.HOME || process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' }
      });

      console.log(`PTY process started (PID: ${ptyProcess.pid})`);

      ptyProcess.onData((data) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        } catch (e) {
           console.error("WS Send Error:", e);
           try { ptyProcess?.kill(); } catch(killErr){}
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`PTY process exited (PID: ${ptyProcess.pid}, Code: ${exitCode}, Signal: ${signal})`);
        ptyProcess = null;
        try { if(ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch (e) {}
      });

      ws.on('message', (message) => {
         if (!ptyProcess) { return; }
         try {
             const msgString = message.toString();
             if (msgString.startsWith('{"type":"resize","cols":')) {
                 const resizeData = JSON.parse(msgString);
                 if (resizeData.cols && resizeData.rows) {
                     ptyProcess.resize(resizeData.cols, resizeData.rows);
                 }
             } else {
                 ptyProcess.write(msgString);
             }
         } catch(e) { console.error("WS Message/PTY Write Error:", e); }
      });

      ws.on('close', () => {
        console.log('Terminal client disconnected');
        try { ptyProcess?.kill(); } catch (e) { console.error("Error killing PTY on ws close:", e); }
        ptyProcess = null;
      });

      ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          try { ptyProcess?.kill(); } catch (e) {}
          ptyProcess = null;
      });

  } catch (e) {
      console.error("Failed to spawn PTY process:", e);
      try { ws.send(`\r\n\x1b[1;31mError creating terminal session: ${e.message}\x1b[0m\r\n`); ws.close(); } catch (wsErr) {}
  }

});

const port = process.env.PORT || 3030;
server.listen(port, '0.0.0.0', () => {
  console.log(`Terminal WebSocket server listening on 0.0.0.0:${port}`);
});