/**
 * Outbound email, used for login codes and invitations. Vestry ships a
 * Resend adapter and a console mailer for development; anything with an HTTP
 * API is a few lines behind the same interface.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

export function resendMailer(opts: {
  apiKey: string;
  from: string;
  apiBase?: string;
}): Mailer {
  const base = (opts.apiBase ?? "https://api.resend.com").replace(/\/$/, "");
  return {
    async send(message) {
      const res = await fetch(`${base}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body.message) detail = `${body.message} (${res.status})`;
        } catch {
          /* ignore */
        }
        throw new MailError(`Resend rejected the email: ${detail}`);
      }
    },
  };
}

/** Prints messages instead of sending them (development). */
export function consoleMailer(
  log: (line: string) => void = (line) => console.log(line),
): Mailer {
  return {
    async send(message) {
      log(
        [
          "",
          `[vestry] Email to ${message.to}: ${message.subject}`,
          ...message.text.split("\n").map((l) => `    ${l}`),
          "",
        ].join("\n"),
      );
    },
  };
}

/** Collects messages for tests. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
