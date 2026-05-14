import nodemailer from "nodemailer";

export function createSmtpTransport(): nodemailer.Transporter | null {
  const url = process.env.SMTP_URL?.trim();
  if (url) {
    try {
      return nodemailer.createTransport(url);
    } catch {
      return null;
    }
  }
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "1" || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}
