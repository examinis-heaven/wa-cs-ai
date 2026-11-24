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

// Patch 4: Guard WAWebConnModel.Conn and WAWebSocketModel.Socket when null on /login/
const target4 = `                        window
                            .require('WAWebConnModel')
                            .Conn.on('change:ref', onRefChange); // future QR changes

                        // Remove QR listener once authentication succeeds
                        window
                            .require('WAWebSocketModel')
                            .Socket.on('change:hasSynced', () => {
                                window
                                    .require('WAWebConnModel')
                                    .Conn.off('change:ref', onRefChange);
                            });`;

const replacement4 = `                        const conn = window.require?.('WAWebConnModel')?.Conn;
                        const sock = window.require?.('WAWebSocketModel')?.Socket;
                        if (conn?.on) {
                            conn.on('change:ref', onRefChange); // future QR changes
                        } else if (typeof MutationObserver !== 'undefined') {
                            let lastDomQr = domQr || '';
                            const qrObserver = new MutationObserver(() => {
                                const nextQr = document.querySelector('[data-ref]')?.getAttribute('data-ref');
                                if (nextQr && nextQr !== lastDomQr) {
                                    lastDomQr = nextQr;
                                    window.onQRChangedEvent(nextQr);
                                }
                            });
                            qrObserver.observe(document.body, {
                                subtree: true,
                                childList: true,
                                attributes: true,
                                attributeFilter: ['data-ref'],
                            });
                            window._wwjsQrObserver = qrObserver;
                        }

                        // Remove QR listener once authentication succeeds
                        if (sock?.on) {
                            sock.on('change:hasSynced', () => {
                                window.require?.('WAWebConnModel')?.Conn?.off('change:ref', onRefChange);
                                if (window._wwjsQrObserver) {
                                    window._wwjsQrObserver.disconnect();
                                    window._wwjsQrObserver = null;
                                }
                            });
                        }`;

if (src.includes(target4)) {
  src = src.replace(target4, replacement4);
  changed = true;
}

// Patch 5: Guard WAWebSocketModel.Socket & WAWebCmd.Cmd in core listener registration
const target5 = `            await this.pupPage.evaluate(() => {
                const Socket = window.require('WAWebSocketModel').Socket;
                const Cmd = window.require('WAWebCmd').Cmd;

                const listeners = [
                    [
                        Socket,
                        'change:state',
                        (_AppState, state) => {
                            window.onAuthAppStateChangedEvent(state);
                        },
                    ],
                    [
                        Socket,
                        'change:hasSynced',
                        () => {
                            window.onAppStateHasSyncedEvent();
                        },
                    ],
                    [
                        Cmd,
                        'offline_progress_update_from_bridge',
                        () => {
                            window.onOfflineProgressUpdateEvent(
                                window
                                    .require('WAWebOfflineHandler')
                                    .OfflineMessageHandler.getOfflineDeliveryProgress(),
                            );
                        },
                    ],
                    [
                        Cmd,
                        'logout',
                        async () => {
                            await window.onLogoutEvent();
                        },
                    ],
                    [
                        Cmd,
                        'logout_from_bridge',
                        async () => {
                            await window.onLogoutEvent();
                        },
                    ],
                ];

                // Clean up old listeners to prevent accumulation on re-inject
                if (window._wwjsListeners) {
                    for (const [obj, event, handler] of window._wwjsListeners) {
                        obj.off(event, handler);
                    }
                }

                for (const [obj, event, handler] of listeners) {
                    obj.on(event, handler);
                }
                window._wwjsListeners = listeners;

                // Atomic hasSynced check in the same synchronous block as listener registration.
                // If hasSynced is already true, Backbone won't fire change:hasSynced (no transition).
                // If hasSynced is false, the listener above will catch the future transition.
                const storeInjected = typeof window.WWebJS !== 'undefined';
                if (Socket.hasSynced === true && !storeInjected) {
                    window.onAppStateHasSyncedEvent();
                }
            });`;

const replacement5 = `            await this.pupPage.evaluate(() => {
                const attachCoreListeners = () => {
                    const Socket = window.require?.('WAWebSocketModel')?.Socket;
                    const Cmd = window.require?.('WAWebCmd')?.Cmd;
                    if (!Socket || !Cmd) return false;

                    const listeners = [
                        [
                            Socket,
                            'change:state',
                            (_AppState, state) => {
                                window.onAuthAppStateChangedEvent(state);
                            },
                        ],
                        [
                            Socket,
                            'change:hasSynced',
                            () => {
                                window.onAppStateHasSyncedEvent();
                            },
                        ],
                        [
                            Cmd,
                            'offline_progress_update_from_bridge',
                            () => {
                                window.onOfflineProgressUpdateEvent(
                                    window
                                        .require('WAWebOfflineHandler')
                                        .OfflineMessageHandler.getOfflineDeliveryProgress(),
                                );
                            },
                        ],
                        [
                            Cmd,
                            'logout',
                            async () => {
                                await window.onLogoutEvent();
                            },
                        ],
                        [
                            Cmd,
                            'logout_from_bridge',
                            async () => {
                                await window.onLogoutEvent();
                            },
                        ],
                    ];

                    // Clean up old listeners to prevent accumulation on re-inject
                    if (window._wwjsListeners) {
                        for (const [obj, event, handler] of window._wwjsListeners) {
                            obj.off(event, handler);
                        }
                    }

                    for (const [obj, event, handler] of listeners) {
                        obj.on(event, handler);
                    }
                    window._wwjsListeners = listeners;

                    // Atomic hasSynced check in the same synchronous block as listener registration.
                    // If hasSynced is already true, Backbone won't fire change:hasSynced (no transition).
                    // If hasSynced is false, the listener above will catch the future transition.
                    const storeInjected = typeof window.WWebJS !== 'undefined';
                    if (Socket.hasSynced === true && !storeInjected) {
                        window.onAppStateHasSyncedEvent();
                    }
                    return true;
                };

                if (!attachCoreListeners()) {
                    if (window._wwjsCorePoller) clearInterval(window._wwjsCorePoller);
                    window._wwjsCorePoller = setInterval(() => {
                        if (attachCoreListeners()) {
                            clearInterval(window._wwjsCorePoller);
                            window._wwjsCorePoller = null;
                        }
                    }, 1000);
                }
            });`;

if (src.includes(target5)) {
  src = src.replace(target5, replacement5);
  changed = true;
}

if (changed) {
  fs.writeFileSync(clientPath, src, 'utf8');
  console.log('[patch-wwebjs] Patched whatsapp-web.js Client.js for WhatsApp Web 2.3000+ QR detection.');
} else {
  console.log('[patch-wwebjs] Already patched or up to date.');
}
