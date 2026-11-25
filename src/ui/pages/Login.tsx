import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authErrorMessage } from "../auth-client.js";
import { Alert, Spinner } from "../components/ui.js";
import { VestryMark } from "../components/VestryMark.js";
import { useVestry } from "../context.js";
import { logoUrls, type LogoUrls } from "../lib/logo.js";

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
        <LoginBrand
          logos={logoUrls(client.config.logo, api)}
          name={name}
          showName={client.config.signIn?.showName === true}
        />
        {client.setupError ? (
          <>
            <p>Vestry isn't configured yet.</p>
            <Alert kind="error">{client.setupError}</Alert>
          </>
        ) : step === "email" ? (
          <EmailStep
            email={email}
            onEmail={setEmail}
            onSubmit={requestCode}
            busy={busy}
            error={error}
          />
        ) : (
          <CodeStep
            email={email}
            code={code}
            onCode={setCode}
            onSubmit={verify}
            onBack={() => {
              setStep("email");
              setError(null);
              setNotice(null);
            }}
            onResend={async () => {
              if (await requestCode()) setNotice("We sent a new code.");
            }}
            busy={busy}
            error={error}
            notice={notice}
          />
        )}
      </div>
      <a
        className="v-login__powered"
        href="https://vestrycms.com"
        target="_blank"
        rel="noreferrer"
      >
        <VestryMark /> Powered by <strong>Vestry CMS</strong>
      </a>
    </div>
  );
}

/**
 * The page's heading: the site's logo, named by its alt text, or with
 * `signIn.showName` the logo above the name. Without a logo, the site's
 * initial above the name.
 */
function LoginBrand({
  logos,
  name,
  showName,
}: {
  logos: LogoUrls;
  name: string;
  showName: boolean;
}) {
  if (!logos.onDark && !logos.onLight) {
    return (
      <>
        <div className="v-login__mark">{name.slice(0, 1)}</div>
        <h1>{name}</h1>
      </>
    );
  }
  if (showName) {
    return (
      <>
        <LoginLogo logos={logos} alt="" />
        <h1>{name}</h1>
      </>
    );
  }
  return (
    <h1 className="v-login__brand">
      <LoginLogo logos={logos} alt={name} />
    </h1>
  );
}

/**
 * The logo for the card's surface, which follows the system's colour
 * scheme: `onLight` on the light card and `onDark` on the dark one. A site
 * with only one of them gets it on a plate where the card doesn't suit it.
 */
function LoginLogo({ logos, alt }: { logos: LogoUrls; alt: string }) {
  const { onDark, onLight } = logos;
  const plate = !onLight
    ? " v-login__logo--dark-plate"
    : !onDark
      ? " v-login__logo--light-plate"
      : "";
  return (
    <picture className={`v-login__logo${plate}`}>
      {onDark && onLight && (
        <source media="(prefers-color-scheme: dark)" srcSet={onDark} />
      )}
      <img src={(onLight ?? onDark)!} alt={alt} />
    </picture>
  );
}

/** Step one: the email address to send a code to. */
function EmailStep({
  email,
  onEmail,
  onSubmit,
  busy,
  error,
}: {
  email: string;
  onEmail: (email: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <form onSubmit={onSubmit} className="v-login__form">
      <p>Enter your email address and we'll send you a code to sign in.</p>
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
          onChange={(e) => onEmail(e.target.value)}
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
  );
}

/** Step two: the six-digit code we emailed. */
function CodeStep({
  email,
  code,
  onCode,
  onSubmit,
  onBack,
  onResend,
  busy,
  error,
  notice,
}: {
  email: string;
  code: string;
  onCode: (code: string) => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
  onResend: () => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
}) {
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    codeRef.current?.focus();
  }, []);
  return (
    <form onSubmit={onSubmit} className="v-login__form">
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
            onCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
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
          onClick={onBack}
        >
          <ArrowLeft size={13} /> Use a different email
        </button>
        <button
          type="button"
          className="v-link"
          disabled={busy}
          onClick={onResend}
        >
          Send a new code
        </button>
      </div>
    </form>
  );
}
