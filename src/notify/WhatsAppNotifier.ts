import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Notifier } from "./Notifier.js";

export interface WhatsAppNotifierOptions {
  /** Called with the raw QR payload every time Baileys emits one. Defaults to printing an ASCII QR to the terminal. */
  onQr?: (qr: string) => void;
}

/**
 * WhatsApp notifier backed by Baileys. On first run (no saved session in
 * authDir) a QR code is emitted for pairing; subsequent runs reuse the
 * persisted multi-file auth state without requiring a re-scan.
 *
 * After a QR is scanned, Baileys closes the socket once with a
 * "restart required" status before it will actually open - this is normal
 * Baileys behaviour, not a failure, so connect() keeps reconnecting on
 * close until either "open" fires or the session is logged out.
 */
export class WhatsAppNotifier implements Notifier {
  private sock: WASocket | undefined;
  private readyPromise: Promise<void> | undefined;

  constructor(
    private readonly authDir: string,
    private readonly targetNumber: string,
    private readonly options: WhatsAppNotifierOptions = {},
  ) {
    if (!targetNumber) {
      throw new Error(
        "WHATSAPP_TARGET_NUMBER is not set - configure it in .env before sending notifications.",
      );
    }
  }

  private async connect(): Promise<void> {
    this.readyPromise = new Promise((resolve, reject) => {
      const start = async (): Promise<void> => {
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        // The version baked into a given Baileys release goes stale as WhatsApp
        // rolls out protocol updates; using an outdated one makes the server
        // reject the connection right after the noise handshake (before a QR
        // is ever emitted). Fetching it at connect time avoids that.
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
          auth: state,
          version,
          logger: pino({ level: "silent" }),
        });

        this.sock.ev.on("creds.update", saveCreds);

        this.sock.ev.on("connection.update", (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            if (this.options.onQr) {
              this.options.onQr(qr);
            } else {
              console.log("[WhatsAppNotifier] Scan this QR code with WhatsApp to pair:");
              qrcode.generate(qr, { small: true });
            }
          }

          if (connection === "open") {
            resolve();
          }

          if (connection === "close") {
            const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
              ?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
              reject(
                new Error("WhatsApp session logged out - delete the auth dir and re-pair."),
              );
              return;
            }

            // Baileys closes with e.g. "restart required" right after a QR
            // scan; reconnecting (reusing the now-updated creds) is expected.
            start().catch(reject);
          }
        });
      };

      start().catch(reject);
    });

    await this.readyPromise;
  }

  private async ensureReady(): Promise<WASocket> {
    if (!this.sock) {
      await this.connect();
    }
    if (!this.sock) throw new Error("WhatsApp socket failed to initialize");
    return this.sock;
  }

  async send(message: string): Promise<void> {
    const sock = await this.ensureReady();
    const jid = `${this.targetNumber.replace(/\D/g, "")}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
  }

  async close(): Promise<void> {
    this.sock?.end(undefined);
  }
}
