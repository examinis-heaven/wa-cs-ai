import fs from 'node:fs';
import path from 'node:path';

const clientPath = path.resolve('node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (!fs.existsSync(clientPath)) {
  console.log('[patch-wwebjs] Client.js not found, skipping.');
  process.exit(0);
}

let src = fs.readFileSync(clientPath, 'utf8');
let changed = false;

// Patch 1: Detect [data-ref] QR element immediately when WAWebSocketModel.Socket.state is undefined
const target1 = `            const needAuthHandle = await this.pupPage.waitForFunction(
                () => {
                    const state =
                        window.require?.('WAWebSocketModel')?.Socket?.state;`;

const replacement1 = `            const needAuthHandle = await this.pupPage.waitForFunction(
                () => {
                    const qrEl = document.querySelector('[data-ref]');
                    if (qrEl && qrEl.getAttribute('data-ref')) {
                        return { need: true, state: 'UNPAIRED' };
                    }
                    const state =
                        window.require?.('WAWebSocketModel')?.Socket?.state;`;

if (src.includes(target1)) {
  src = src.replace(target1, replacement1);
  changed = true;
}

// Patch 2: Use polling: 500 instead of default RAF (which stalls in headless Chrome on /login/ redirect)
const targetPoll = `                { timeout: authTimeout },`;
const replacementPoll = `                { timeout: authTimeout, polling: 500 },`;
if (src.includes(targetPoll)) {
  src = src.replace(targetPoll, replacementPoll);
  changed = true;
}

// Patch 3: Fallback to [data-ref] attribute if WAWebConnModel.Conn.ref is unavailable
const target2 = `                        window.onQRChangedEvent(
                            getQR(window.require('WAWebConnModel').Conn.ref),
                        ); // initial qr`;

const replacement2 = `                        const connRef = window.require?.('WAWebConnModel')?.Conn?.ref;
                        const domQr = document.querySelector('[data-ref]')?.getAttribute('data-ref');
                        if (connRef) {
                            window.onQRChangedEvent(getQR(connRef));
                        } else if (domQr) {
                            window.onQRChangedEvent(domQr);
                        } // initial qr`;

if (src.includes(target2)) {
  src = src.replace(target2, replacement2);
  changed = true;
}

if (changed) {
  fs.writeFileSync(clientPath, src, 'utf8');
  console.log('[patch-wwebjs] Patched whatsapp-web.js Client.js for WhatsApp Web 2.3000+ QR detection.');
} else {
  console.log('[patch-wwebjs] Already patched or up to date.');
}
