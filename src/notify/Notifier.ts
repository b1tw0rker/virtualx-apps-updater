export interface Notifier {
  send(message: string): Promise<void>;
  close(): Promise<void>;
}
