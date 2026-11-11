import { appendFileSync } from "node:fs";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Email to researchers: password resets, invitations, and, on a hosted Truman, news about a lab's
 * application (ADR 72). Never to participants, whose email Truman doesn't have.
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text. Links are written out in full. */
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Sends through Amazon SES, from an address on a domain verified there. */
export function sesMailer({ region, from }: { region: string; from: string }): Mailer {
  const client = new SESv2Client({ region });
  return {
    send: async ({ to, subject, text }) => {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Text: { Data: text, Charset: "UTF-8" } },
            },
          },
        }),
      );
    },
  };
}

/** For local development: prints each email, links and all, so they can be followed. */
export function consoleMailer(): Mailer {
  return {
    send: async ({ to, subject, text }) => {
      console.log(`\n--- Email to ${to}: ${subject}\n${text}\n---\n`);
    },
  };
}

/** For browser tests: adds each email to a file, one JSON object a line, for the test to read. */
export function fileMailer(path: string): Mailer {
  return {
    send: async (mail) => {
      appendFileSync(path, `${JSON.stringify(mail)}\n`);
    },
  };
}

/**
 * When nothing's set up to send email in production. It doesn't print the email, since a link in
 * it could reset someone's password, so it only says one wasn't sent.
 */
export function unsentMailer(): Mailer {
  return {
    send: async ({ subject }) => {
      console.warn(`An email ("${subject}") wasn't sent, since MAIL_FROM isn't set.`);
    },
  };
}

/** For tests: keeps what was sent. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send: async (mail) => {
      sent.push(mail);
    },
  };
}

/**
 * Sends without letting a failure stop what the person was doing. A failed email is logged, by its
 * subject only.
 */
export async function sendQuietly(mailer: Mailer | undefined, mail: Mail) {
  if (!mailer) {
    return;
  }
  try {
    await mailer.send(mail);
  } catch (error) {
    console.error(
      `An email ("${mail.subject}") couldn't be sent:`,
      error instanceof Error ? error.message : error,
    );
  }
}
