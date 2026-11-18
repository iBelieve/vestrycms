import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authErrorMessage } from "../auth-client.js";
import { Alert, Spinner } from "../components/ui.js";
import { useVestry } from "../context.js";
import { logoSrc } from "../lib/logo.js";

/**
 * Two-step sign-in: an email address, then the six-digit code we emailed.
 * The first step always "succeeds" so the page never reveals who has an
 * account.
 */
export function LoginPage() {
  const { api, authClient, client, name, refresh } = useVestry();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const logo = logoSrc(client.config.logo, api);

  /** Asks for a code; resolves true when the request was accepted. */
  async function requestCode(e?: FormEvent): Promise<boolean> {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
      });
      // oxlint-disable-next-line typescript/only-throw-error -- Better Auth's error; the catch reads its `code`.
      if (result.error) throw result.error;
      setCode("");
      setStep("code");
      return true;
    } catch (err) {
      setError(authErrorMessage(err as { code?: string; message?: string }));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: code,
      });
      // oxlint-disable-next-line typescript/only-throw-error -- Better Auth's error; the catch reads its `code`.
      if (result.error) throw result.error;
      // Once the config reloads with a user, the /login route redirects to `next`.
      await refresh();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(authErrorMessage(e));
      if (e.code === "OTP_EXPIRED" || e.code === "TOO_MANY_ATTEMPTS") {
        setStep("email");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v-login">
      <div className="v-card v-login__card">
        {logo ? (
          <div className="v-login__logo">
            <img src={logo} alt={name} />
          </div>
        ) : (
          <div className="v-login__mark">{name.slice(0, 1)}</div>
        )}
        <h1>{name}</h1>

        {client.setupError ? (
          <>
            <p>Vestry isn't configured yet.</p>
            <Alert kind="error">{client.setupError}</Alert>
          </>
        ) : step === "email" ? (
          <form onSubmit={(e) => void requestCode(e)} className="v-login__form">
            <p>
              Enter your email address and we'll send you a code to sign in.
            </p>
            <label className="v-login__field">
              <span className="v-field__label">Email</span>
              <input
                className="v-input"
                type="email"
                name="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.org"
              />
            </label>
            {error && <Alert kind="error">{error}</Alert>}
            <button
              className="v-btn v-btn--primary"
              type="submit"
              disabled={busy || !email}
            >
              {busy ? <Spinner /> : <Mail />} Email me a code
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void verify(e)} className="v-login__form">
            <p>
              If <strong>{email}</strong> can edit this site, we've emailed it a
              six-digit code. It expires in 10 minutes.
            </p>
            <label className="v-login__field">
              <span className="v-field__label">Code</span>
              <input
                ref={codeRef}
                className="v-input v-login__code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
                }
                placeholder="123456"
              />
            </label>
            {error && <Alert kind="error">{error}</Alert>}
            {notice && <Alert kind="info">{notice}</Alert>}
            <button
              className="v-btn v-btn--primary"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? <Spinner /> : <KeyRound />} Sign in
            </button>
            <div className="v-login__links">
              <button
                type="button"
                className="v-link"
                disabled={busy}
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setNotice(null);
                }}
              >
                <ArrowLeft size={13} /> Use a different email
              </button>
              <button
                type="button"
                className="v-link"
                disabled={busy}
                onClick={() => {
                  void requestCode().then((sent) => {
                    if (sent) setNotice("We sent a new code.");
                  });
                }}
              >
                Send a new code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
