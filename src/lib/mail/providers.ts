export const GOOGLE_WORKSPACE = {
  imap: { host: "imap.gmail.com", port: 993, secure: true },
  smtp: { host: "smtp.gmail.com", port: 465, secure: true },
};

export function isGoogleMailHost(host: string) {
  const name = host.trim().toLowerCase();
  return name === "imap.gmail.com" || name === "smtp.gmail.com" || name.endsWith(".gmail.com");
}

export function isAllMailPath(path: string) {
  return /all mail/i.test(path);
}

/** Google app passwords are often copied with spaces. */
export function normalizeMailPassword(password: string, imapHost: string) {
  return isGoogleMailHost(imapHost) ? password.replace(/\s+/g, "") : password;
}

export function googleConnectHint(message: string) {
  if (!/auth|invalid|login|credentials|application-specific|disabled/i.test(message)) {
    return message;
  }
  return "Google rejected the login. Use a Google Workspace app password (not the account password) and make sure IMAP is enabled for the user.";
}
