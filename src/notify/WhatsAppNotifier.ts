import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Notifier } from "./Notifier.js";

/**
 * WhatsApp notifier backed by Baileys. On first run (no saved session in
 * authDir) a QR code is printed to the terminal for pairing; subsequent runs
 * reuse the persisted multi-file auth state without requiring a re-scan.
 */
export class WhatsAppNotifier implements Notifier {
  private sock: WASocket | undefined;
  private readyPromise: Promise<void> | undefined;

  constructor(
    private readonly authDir: string,
    private readonly targetNumber: string,
  ) {
    if (!targetNumber) {
      throw new Error(
        "WHATSAPP_TARGET_NUMBER is not set - configure it in .env before sending notifications.",
      );
    }
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.readyPromise = new Promise((resolve, reject) => {
      this.sock?.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log("[WhatsAppNotifier] Scan this QR code with WhatsApp to pair:");
          qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
          resolve();
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
            ?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          reject(
            new Error(
              loggedOut
                ? "WhatsApp session logged out - delete the auth dir and re-pair."
                : `WhatsApp connection closed unexpectedly (status ${statusCode ?? "unknown"}).`,
            ),
          );
        }
      });
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
